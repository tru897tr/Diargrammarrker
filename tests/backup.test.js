import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getStore } from '../src/services/storage/index.js';
import {
  buildBackup, importBackup, BackupError, BACKUP_FORMAT,
} from '../src/services/admin/backupService.js';

const store = getStore();
const HASH = (c) => `$2b$12$${c.repeat(53)}`; // đúng định dạng bcrypt; service không kiểm tra giá trị băm
const DATA = { version: 1, viewport: { x: 0, y: 0, zoom: 1 }, elements: [{ id: 'a1', type: 'text', x: 1, y: 2, width: 40, height: 20, text: 'Xin chào', style: { fontFamily: 'Be Vietnam Pro', fontSize: 20 } }] };

async function wipe() {
  await store.backup.applySnapshot({ replace: { users: true, diagrams: true, shares: true } });
}

/** Dựng dữ liệu mẫu: admin A, user B, user C; sơ đồ của A và B; B có share. */
async function seed() {
  const a = await store.user.createUser({ username: 'alice', email: 'alice@example.com', passwordHash: HASH('a') });
  const b = await store.user.createUser({ username: 'bob', email: 'bob@example.com', passwordHash: HASH('b') });
  const c = await store.user.createUser({ username: 'carol', email: 'carol@example.com', passwordHash: HASH('c') });
  const d1 = await store.diagram.createDiagram({ ownerId: a.id, name: 'Sơ đồ của Alice', data: DATA });
  const d2 = await store.diagram.createDiagram({ ownerId: b.id, name: 'Sơ đồ của Bob', data: DATA });
  const sh = await store.share.createShare({ diagramId: d2.id, ownerId: b.id, token: 'T'.repeat(32) });
  return { a, b, c, d1, d2, sh };
}

beforeEach(wipe);

test('xuất: phong bì hợp lệ, có checksum, có mã băm mật khẩu, không có session', async () => {
  const { a } = await seed();
  await store.session.createSession({ userId: a.id, csrfToken: 'x', ttlMs: 60000 });
  const out = await buildBackup({ by: a });
  assert.equal(out.format, BACKUP_FORMAT);
  assert.deepEqual(out.counts, { users: 3, diagrams: 2, shares: 1 });
  assert.match(out.checksum, /^sha256:[0-9a-f]{64}$/);
  assert.ok(out.data.users.every((u) => u.passwordHash.startsWith('$2b$')));
  assert.equal(out.data.sessions, undefined);
  // JSON hóa rồi đọc lại vẫn nhập được (checksum ổn định qua stringify/parse)
  const again = JSON.parse(JSON.stringify(out));
  const r = await importBackup({ backup: again, mode: 'merge', dryRun: true, actor: a });
  assert.equal(r.errorCount, 0);
});

test('xuất: chỉ chọn một mục; không chọn gì thì báo lỗi', async () => {
  const { a } = await seed();
  const out = await buildBackup({ by: a, sections: { users: false, diagrams: true, shares: false } });
  assert.deepEqual(out.includes, ['diagrams']);
  await assert.rejects(buildBackup({ by: a, sections: { users: false, diagrams: false, shares: false } }), BackupError);
});

test('khôi phục lên máy chủ trống (merge): tài khoản trùng email được gộp, sơ đồ chuyển về tài khoản đó', async () => {
  const { a } = await seed();
  const backup = JSON.parse(JSON.stringify(await buildBackup({ by: a })));
  await wipe();
  // Máy chủ mới: admin đăng ký lại với CÙNG email nhưng mật khẩu mới
  const fresh = await store.user.createUser({ username: 'alice_new', email: 'alice@example.com', passwordHash: HASH('z') });
  assert.equal(fresh.role, 'admin');

  const r = await importBackup({ backup, mode: 'merge', actor: fresh });
  assert.equal(r.summary.users.merged, 1);
  assert.equal(r.summary.users.added, 2);
  assert.equal(r.summary.diagrams.added, 2);
  assert.equal(r.summary.shares.added, 1);

  const users = await store.user.listUsers();
  assert.equal(users.length, 3);
  const me = users.find((u) => u.id === fresh.id);
  assert.equal(me.username, 'alice_new'); // không bị ghi đè
  const mine = await store.diagram.listDiagramsByOwner(fresh.id);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].name, 'Sơ đồ của Alice');
  const share = await store.share.getShareByToken('T'.repeat(32));
  assert.ok(share, 'token chia sẻ cũ vẫn dùng được');
});

test('merge: tài khoản của người đang thao tác không bao giờ bị ghi đè (kể cả cùng ID)', async () => {
  const { a } = await seed();
  const backup = JSON.parse(JSON.stringify(await buildBackup({ by: a })));
  await store.user.updateUser(a.id, { status: 'active' });
  // Sửa tệp: hạ quyền A trong tệp (checksum phải tính lại)
  backup.data.users.find((u) => u.id === a.id).role = 'user';
  delete backup.checksum;
  const r = await importBackup({ backup, mode: 'merge', actor: a });
  assert.equal(r.summary.users.kept, 1);
  assert.equal(r.impact.loseAdmin, false);
  assert.ok(r.warnings.some((w) => w.includes('checksum')));
  const still = await store.user.getUserById(a.id);
  assert.equal(still.role, 'admin');
});

test('checksum sai bị từ chối', async () => {
  const { a } = await seed();
  const backup = JSON.parse(JSON.stringify(await buildBackup({ by: a })));
  backup.data.users[0].username = 'hacker';
  await assert.rejects(importBackup({ backup, mode: 'merge', actor: a }), (e) => e instanceof BackupError && e.code === 'CHECKSUM_MISMATCH');
});

test('định dạng/phiên bản không hợp lệ bị từ chối', async () => {
  const { a } = await seed();
  await assert.rejects(importBackup({ backup: { foo: 1 }, mode: 'merge', actor: a }), (e) => e.code === 'INVALID_BACKUP');
  await assert.rejects(importBackup({ backup: { format: BACKUP_FORMAT, version: 99, data: {} }, mode: 'merge', actor: a }), (e) => e.code === 'UNSUPPORTED_VERSION');
  await assert.rejects(importBackup({ backup: { format: BACKUP_FORMAT, version: 1, data: { users: 'x' } }, mode: 'merge', actor: a }), (e) => e.code === 'INVALID_BACKUP');
});

test('bản ghi lỗi bị bỏ qua và được báo lại; bản ghi tốt vẫn nhập', async () => {
  const { a } = await seed();
  const backup = JSON.parse(JSON.stringify(await buildBackup({ by: a })));
  backup.data.users[1].passwordHash = 'not-a-hash';
  backup.data.diagrams[0].data.elements[0].style.fontFamily = 'x"; background:url(//evil)';
  delete backup.checksum;
  await wipe();
  const admin = await store.user.createUser({ username: 'root', email: 'root@example.com', passwordHash: HASH('r') });
  const r = await importBackup({ backup, mode: 'merge', actor: admin });
  assert.equal(r.errorCount, 2);
  assert.ok(r.errors.some((e) => e.section === 'users'));
  assert.ok(r.errors.some((e) => e.section === 'diagrams'));
  assert.equal((await store.user.listUsers()).length, 1 + 2); // root + 2 user hợp lệ
});

test('dryRun không ghi gì', async () => {
  const { a } = await seed();
  const backup = JSON.parse(JSON.stringify(await buildBackup({ by: a })));
  await wipe();
  const admin = await store.user.createUser({ username: 'root', email: 'root@example.com', passwordHash: HASH('r') });
  const r = await importBackup({ backup, mode: 'merge', dryRun: true, actor: admin });
  assert.equal(r.applied, null);
  assert.equal(r.after.users, 4);
  assert.equal((await store.user.listUsers()).length, 1);
  assert.equal(await store.diagram.countDiagrams(), 0);
});

test('trùng tên đăng nhập (khác email) thì tự đổi tên', async () => {
  const { a } = await seed();
  const backup = JSON.parse(JSON.stringify(await buildBackup({ by: a, sections: { users: true, diagrams: false, shares: false } })));
  await wipe();
  const admin = await store.user.createUser({ username: 'bob', email: 'root@example.com', passwordHash: HASH('r') });
  const r = await importBackup({ backup, mode: 'merge', actor: admin });
  assert.equal(r.summary.users.renamed, 1);
  const names = (await store.user.listUsers()).map((u) => u.username).sort();
  assert.deepEqual(names, ['alice', 'bob', 'bob_2', 'carol']);
});

test('replace: thay toàn bộ; người thao tác không có trong tệp → cảnh báo bị đăng xuất, session bị hủy', async () => {
  const { a } = await seed();
  const backup = JSON.parse(JSON.stringify(await buildBackup({ by: a })));
  await wipe();
  const admin = await store.user.createUser({ username: 'root', email: 'root@example.com', passwordHash: HASH('r') });
  await store.diagram.createDiagram({ ownerId: admin.id, name: 'Sẽ bị xóa', data: DATA });
  const session = await store.session.createSession({ userId: admin.id, csrfToken: 'x', ttlMs: 60000 });

  const preview = await importBackup({ backup, mode: 'replace', dryRun: true, actor: admin });
  assert.equal(preview.impact.logout, true);
  assert.equal(preview.removed.users, 1);
  assert.equal(preview.removed.diagrams, 1);

  await importBackup({ backup, mode: 'replace', actor: admin });
  const names = (await store.user.listUsers()).map((u) => u.username).sort();
  assert.deepEqual(names, ['alice', 'bob', 'carol']);
  assert.equal(await store.diagram.countDiagrams(), 2);
  assert.equal(await store.session.getSession(session.id), null);
});

test('replace: tệp không còn admin hoạt động → bị chặn', async () => {
  const { a } = await seed();
  const backup = JSON.parse(JSON.stringify(await buildBackup({ by: a })));
  backup.data.users.forEach((u) => { u.role = 'user'; });
  delete backup.checksum;
  await assert.rejects(importBackup({ backup, mode: 'replace', actor: a }), (e) => e.code === 'NO_ADMIN');
  assert.equal((await store.user.listUsers()).length, 3); // không bị thay đổi
});

test('sơ đồ có chủ sở hữu không tồn tại được gán cho admin; share trỏ sơ đồ không tồn tại bị bỏ qua', async () => {
  const { a } = await seed();
  const backup = JSON.parse(JSON.stringify(await buildBackup({ by: a, sections: { users: false, diagrams: true, shares: true } })));
  await wipe();
  const admin = await store.user.createUser({ username: 'root', email: 'root@example.com', passwordHash: HASH('r') });
  backup.data.shares.push({ id: backup.data.shares[0].id.replace(/.$/, 'f'), token: 'Q'.repeat(32), diagramId: '00000000-0000-4000-8000-000000000000', ownerId: admin.id, createdAt: new Date().toISOString() });
  delete backup.checksum;
  const r = await importBackup({ backup, mode: 'merge', actor: admin });
  assert.equal(r.summary.diagrams.reassigned, 2);
  assert.equal(r.summary.shares.skipped, 1);
  assert.equal((await store.diagram.listDiagramsByOwner(admin.id)).length, 2);
});

test('import lặp lại (idempotent): lần 2 không tạo bản sao', async () => {
  const { a } = await seed();
  const backup = JSON.parse(JSON.stringify(await buildBackup({ by: a })));
  const r = await importBackup({ backup, mode: 'merge', actor: a });
  assert.equal(r.summary.diagrams.added, 0);
  assert.equal(r.summary.diagrams.updated, 2);
  assert.equal(r.summary.shares.unchanged, 1);
  assert.equal(await store.diagram.countDiagrams(), 2);
  assert.equal(await store.share.countActiveShares(), 1);
});
