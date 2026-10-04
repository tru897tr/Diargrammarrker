import crypto from 'node:crypto';
import { z } from 'zod';
import { getStore } from '../storage/index.js';
import createLogger from '../../server/logger.js';
import { config } from '../../server/config.js';
import { newId, iso, now } from '../../server/utils.js';
import {
  usernameSchema, emailSchema, diagramDataSchema, shareTokenSchema,
} from '../../validation/schema.js';

const log = createLogger('backup-service');
const store = getStore();

/**
 * Sao lưu / khôi phục toàn bộ dữ liệu trang web (dành cho admin).
 *
 * Tệp sao lưu là JSON:
 * {
 *   format: "diagram-backup", version: 1, exportedAt, exportedBy, app, includes, counts,
 *   checksum: "sha256:<hex của JSON.stringify(data)>",
 *   data: { users: [...có passwordHash], diagrams: [...], shares: [...] }
 * }
 * Không gồm session (phiên đăng nhập là tạm thời, người dùng chỉ cần đăng nhập lại).
 */

export const BACKUP_FORMAT = 'diagram-backup';
export const BACKUP_VERSION = 1;
export const SECTIONS = ['users', 'diagrams', 'shares'];
const MAX_RECORDS_PER_SECTION = 50000;
const MAX_REPORTED_ERRORS = 50;
const ID_RE = /^[0-9a-fA-F-]{8,64}$/;

/** Lỗi nghiệp vụ của sao lưu: message tiếng Việt, hiển thị thẳng cho admin. */
export class BackupError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'BackupError';
    this.code = code;
    this.status = 400;
    this.expose = true;
    this.details = details;
  }
}

// -------------------------------------------------------------- schemas ---

const idSchema = z.string().regex(ID_RE, 'ID không hợp lệ.');
const dateSchema = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Ngày giờ không hợp lệ.')
  .transform((v) => new Date(v).toISOString());
const bcryptHash = z.string().regex(/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/, 'Mã băm mật khẩu không hợp lệ.');

const userRecordSchema = z
  .object({
    id: idSchema,
    username: usernameSchema,
    email: emailSchema,
    passwordHash: bcryptHash,
    role: z.enum(['admin', 'user']),
    status: z.enum(['active', 'locked']),
    createdAt: dateSchema,
    updatedAt: dateSchema.optional(),
  })
  .strip();

const diagramRecordSchema = z
  .object({
    id: idSchema,
    ownerId: idSchema,
    name: z.string().trim().min(1).max(config.limits.diagramNameLength),
    data: diagramDataSchema,
    createdAt: dateSchema,
    updatedAt: dateSchema.optional(),
  })
  .strip();

const shareRecordSchema = z
  .object({
    id: idSchema,
    token: shareTokenSchema,
    diagramId: idSchema,
    ownerId: idSchema,
    createdAt: dateSchema,
  })
  .strip();

const RECORD_SCHEMAS = { users: userRecordSchema, diagrams: diagramRecordSchema, shares: shareRecordSchema };

/** Tùy chọn của API nhập (không gồm bản sao lưu). */
export const importOptionsSchema = z.object({
  mode: z.enum(['merge', 'replace']).default('merge'),
  dryRun: z.boolean().default(false),
  sections: z
    .object({ users: z.boolean().optional(), diagrams: z.boolean().optional(), shares: z.boolean().optional() })
    .default({}),
});

// --------------------------------------------------------------- helpers ---

const sha256 = (text) => `sha256:${crypto.createHash('sha256').update(text).digest('hex')}`;

function pickUser(u) {
  return {
    id: u.id, username: u.username, email: u.email, passwordHash: u.passwordHash,
    role: u.role, status: u.status, createdAt: u.createdAt, updatedAt: u.updatedAt,
  };
}

function issueText(error) {
  const first = error.issues?.[0];
  if (!first) return 'Dữ liệu không hợp lệ.';
  const where = first.path.length ? `${first.path.join('.')}: ` : '';
  return `${where}${first.message}`;
}

/** Hàng đợi 1 việc tại một thời điểm: tránh hai lần nhập chạy chồng lên nhau. */
let queue = Promise.resolve();
function exclusive(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

// ---------------------------------------------------------------- export ---

/**
 * Dựng đối tượng sao lưu.
 * @param {{ by: {id:string, username:string}, sections?: {users?:boolean, diagrams?:boolean, shares?:boolean} }} opts
 */
export async function buildBackup({ by, sections } = {}) {
  const want = { users: true, diagrams: true, shares: true, ...(sections || {}) };
  const snap = await store.backup.exportAll();

  const data = {};
  if (want.users) data.users = snap.users.map(pickUser);
  if (want.diagrams) data.diagrams = snap.diagrams;
  if (want.shares) data.shares = snap.shares;
  if (Object.keys(data).length === 0) {
    throw new BackupError('NOTHING_TO_EXPORT', 'Hãy chọn ít nhất một loại dữ liệu để xuất.');
  }

  const includes = Object.keys(data);
  const counts = Object.fromEntries(includes.map((k) => [k, data[k].length]));
  const payload = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: iso(now()),
    exportedBy: by ? { id: by.id, username: by.username } : null,
    app: { name: 'diagram' },
    includes,
    counts,
    checksum: sha256(JSON.stringify(data)),
    data,
  };
  log.info('backup exported', { by: by?.id, counts });
  return payload;
}

/** Tên tệp gợi ý: diagram-backup-20261003-101530.json */
export function backupFilename(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const d = `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}`;
  const t = `${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}`;
  return `diagram-backup-${d}-${t}.json`;
}

// ---------------------------------------------------------------- import ---

/** Kiểm tra phong bì của tệp sao lưu (định dạng, phiên bản, checksum). */
function readEnvelope(backup) {
  if (!backup || typeof backup !== 'object' || Array.isArray(backup)) {
    throw new BackupError('INVALID_BACKUP', 'Tệp không phải là tệp sao lưu hợp lệ.');
  }
  if (backup.format !== BACKUP_FORMAT) {
    throw new BackupError('INVALID_BACKUP', 'Đây không phải tệp sao lưu của Diagram (sai "format").');
  }
  if (!Number.isInteger(backup.version) || backup.version < 1) {
    throw new BackupError('INVALID_BACKUP', 'Tệp sao lưu thiếu số phiên bản.');
  }
  if (backup.version > BACKUP_VERSION) {
    throw new BackupError('UNSUPPORTED_VERSION', `Tệp được tạo bởi phiên bản mới hơn (v${backup.version}). Hãy cập nhật ứng dụng trước khi nhập.`);
  }
  const data = backup.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new BackupError('INVALID_BACKUP', 'Tệp sao lưu thiếu phần "data".');
  }
  const warnings = [];
  if (typeof backup.checksum === 'string' && backup.checksum) {
    if (sha256(JSON.stringify(data)) !== backup.checksum) {
      throw new BackupError('CHECKSUM_MISMATCH', 'Tệp bị sửa đổi hoặc hỏng (checksum không khớp). Hãy xuất lại tệp sao lưu.');
    }
  } else {
    warnings.push('Tệp không có checksum nên không kiểm tra được tính toàn vẹn.');
  }
  for (const key of SECTIONS) {
    if (data[key] !== undefined) {
      if (!Array.isArray(data[key])) throw new BackupError('INVALID_BACKUP', `Phần "${key}" phải là một danh sách.`);
      if (data[key].length > MAX_RECORDS_PER_SECTION) {
        throw new BackupError('TOO_MANY_RECORDS', `Phần "${key}" có quá nhiều bản ghi (tối đa ${MAX_RECORDS_PER_SECTION}).`);
      }
    }
  }
  return {
    data,
    warnings,
    meta: {
      version: backup.version,
      exportedAt: typeof backup.exportedAt === 'string' ? backup.exportedAt : null,
      exportedBy: backup.exportedBy?.username ? String(backup.exportedBy.username).slice(0, 64) : null,
      includes: SECTIONS.filter((k) => Array.isArray(data[k])),
      counts: Object.fromEntries(SECTIONS.filter((k) => Array.isArray(data[k])).map((k) => [k, data[k].length])),
    },
  };
}

/** Kiểm tra từng bản ghi; bản ghi lỗi bị bỏ qua và được báo lại. Trùng ID trong tệp → giữ bản cuối. */
function validateRecords(data, use) {
  const valid = { users: [], diagrams: [], shares: [] };
  const errors = [];
  let errorCount = 0;
  const warnings = [];
  for (const section of SECTIONS) {
    if (!use[section]) continue;
    const seen = new Map();
    let dup = 0;
    data[section].forEach((raw, index) => {
      const r = RECORD_SCHEMAS[section].safeParse(raw);
      if (!r.success) {
        errorCount++;
        if (errors.length < MAX_REPORTED_ERRORS) {
          errors.push({ section, index, id: typeof raw?.id === 'string' ? raw.id.slice(0, 64) : null, message: issueText(r.error) });
        }
        return;
      }
      const rec = r.data;
      if (rec.updatedAt === undefined) rec.updatedAt = rec.createdAt;
      if (seen.has(rec.id)) dup++;
      seen.set(rec.id, rec);
    });
    valid[section] = [...seen.values()];
    if (dup) warnings.push(`Phần "${section}" có ${dup} bản ghi trùng ID — đã giữ bản xuất hiện sau cùng.`);
  }
  return { valid, errors, errorCount, warnings };
}

const emptyStats = () => ({
  users: { added: 0, updated: 0, merged: 0, renamed: 0, kept: 0, skipped: 0 },
  diagrams: { added: 0, updated: 0, reassigned: 0, skipped: 0 },
  shares: { added: 0, unchanged: 0, skipped: 0 },
});

function uniqueUsername(base, taken) {
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; i < 10000; i++) {
    const suffix = `_${i}`;
    const candidate = base.slice(0, Math.max(1, 32 - suffix.length)) + suffix;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${base.slice(0, 20)}_${newId().slice(0, 8)}`;
}

/**
 * Lập kế hoạch nhập (chưa ghi gì). Trả về bản ghi cuối cùng cần ghi + thống kê.
 * - merge  : thêm bản ghi mới, cập nhật bản ghi trùng ID, gộp tài khoản trùng email; KHÔNG xóa gì.
 * - replace: thay toàn bộ các mục được chọn bằng nội dung tệp.
 */
function buildPlan({ mode, use, valid, current, actor }) {
  const stats = emptyStats();
  const warnings = [];
  const replace = {};
  if (mode === 'replace') for (const k of SECTIONS) if (use[k]) replace[k] = true;

  const curUsers = new Map(current.users.map((u) => [u.id, u]));
  const curDiagrams = new Map(current.diagrams.map((d) => [d.id, d]));
  const curShareByToken = new Map(current.shares.map((s) => [s.token, s]));
  const curShareIds = new Set(current.shares.map((s) => s.id));

  /* ---- users ---- */
  const plan = { users: [], diagrams: [], shares: [] };
  const userIdMap = new Map();          // id trong tệp → id cuối cùng
  let finalUsers = new Map(curUsers);   // trạng thái user sau khi nhập

  if (use.users) {
    if (mode === 'replace') finalUsers = new Map();
    const emailOwner = new Map([...finalUsers.values()].map((u) => [u.email, u.id]));
    const nameOwner = new Map([...finalUsers.values()].map((u) => [u.username.toLowerCase(), u.id]));
    const takenNames = () => new Set(nameOwner.keys());

    for (const u of valid.users) {
      const existing = mode === 'merge' ? curUsers.get(u.id) : null;

      if (existing && existing.id === actor.id) {
        // Không bao giờ ghi đè tài khoản admin đang thực hiện thao tác (tránh tự khóa mình).
        stats.users.kept++;
        userIdMap.set(u.id, u.id);
        continue;
      }

      const emailHolder = emailOwner.get(u.email);
      if (emailHolder && emailHolder !== u.id) {
        if (mode === 'merge') {
          // Cùng email với tài khoản khác đang có → coi là cùng một người, chuyển sơ đồ về tài khoản đó.
          userIdMap.set(u.id, emailHolder);
          stats.users.merged++;
        } else {
          stats.users.skipped++;
          warnings.push(`Bỏ qua tài khoản "${u.username}": trùng email với tài khoản khác trong tệp.`);
        }
        continue;
      }

      let username = u.username;
      const nameHolder = nameOwner.get(username.toLowerCase());
      if (nameHolder && nameHolder !== u.id) {
        username = uniqueUsername(username, takenNames());
        stats.users.renamed++;
        warnings.push(`Tài khoản "${u.username}" trùng tên đăng nhập, đã đổi thành "${username}".`);
      }

      const rec = { ...u, username, updatedAt: u.updatedAt || u.createdAt };
      plan.users.push(rec);
      finalUsers.set(rec.id, rec);
      emailOwner.set(rec.email, rec.id);
      nameOwner.set(username.toLowerCase(), rec.id);
      userIdMap.set(u.id, rec.id);
      if (existing) stats.users.updated++; else stats.users.added++;
    }
  }

  const activeAdmins = [...finalUsers.values()].filter((u) => u.role === 'admin' && u.status === 'active');
  if (activeAdmins.length === 0) {
    throw new BackupError('NO_ADMIN', 'Sau khi nhập sẽ không còn quản trị viên nào đang hoạt động. Hãy nhập kèm tài khoản admin hoặc chọn chế độ "Gộp".');
  }
  const fallbackOwner = finalUsers.get(actor.id)?.status === 'active' ? actor.id : activeAdmins[0].id;

  /* ---- diagrams ---- */
  const diagramIdMap = new Map();
  let finalDiagrams = new Map(curDiagrams);
  if (use.diagrams) {
    if (mode === 'replace') finalDiagrams = new Map();
    for (const d of valid.diagrams) {
      let ownerId = userIdMap.get(d.ownerId) ?? d.ownerId;
      if (!finalUsers.has(ownerId)) {
        ownerId = fallbackOwner;
        stats.diagrams.reassigned++;
      }
      let id = d.id;
      const existing = mode === 'merge' ? curDiagrams.get(id) : null;
      if (existing && existing.ownerId !== ownerId) {
        id = newId(); // trùng ID nhưng khác chủ sở hữu → giữ cả hai, không ghi đè sơ đồ của người khác
        diagramIdMap.set(d.id, id);
      }
      const rec = { id, ownerId, name: d.name, data: d.data, createdAt: d.createdAt, updatedAt: d.updatedAt || d.createdAt };
      plan.diagrams.push(rec);
      finalDiagrams.set(id, rec);
      if (existing && id === d.id) stats.diagrams.updated++; else stats.diagrams.added++;
    }
  } else if (use.users && mode === 'replace') {
    // Thay tài khoản nhưng giữ sơ đồ: sơ đồ của tài khoản không còn tồn tại sẽ được gán cho admin.
    const reassigned = [];
    for (const d of current.diagrams) {
      if (!finalUsers.has(d.ownerId)) {
        const rec = { ...d, ownerId: fallbackOwner };
        reassigned.push(rec);
        finalDiagrams.set(rec.id, rec);
        stats.diagrams.reassigned++;
      }
    }
    plan.diagrams.push(...reassigned);
  }

  /* ---- shares ---- */
  const planShares = () => plan.shares.length;
  const survivingShares = current.shares.filter((sh) => finalDiagrams.has(sh.diagramId)).length;
  if (use.shares) {
    const takenTokens = new Map();      // token → diagramId
    const takenDiagrams = new Set();
    if (mode === 'merge') {
      for (const sh of current.shares) { takenTokens.set(sh.token, sh.diagramId); takenDiagrams.add(sh.diagramId); }
    }
    for (const s of valid.shares) {
      const diagramId = diagramIdMap.get(s.diagramId) ?? s.diagramId;
      const diagram = finalDiagrams.get(diagramId);
      if (!diagram) {
        stats.shares.skipped++;
        continue;
      }
      if (mode === 'merge' && curShareByToken.get(s.token)?.diagramId === diagramId) {
        stats.shares.unchanged++;
        continue;
      }
      if (takenTokens.has(s.token) || takenDiagrams.has(diagramId)) {
        stats.shares.skipped++;
        warnings.push('Bỏ qua một liên kết chia sẻ vì trùng token hoặc sơ đồ đã có liên kết khác.');
        continue;
      }
      let id = s.id;
      if (curShareIds.has(id) && mode === 'merge') id = newId();
      plan.shares.push({ id, token: s.token, diagramId, ownerId: diagram.ownerId, createdAt: s.createdAt, revokedAt: null });
      takenTokens.set(s.token, diagramId);
      takenDiagrams.add(diagramId);
      stats.shares.added++;
    }
  }
  const finalShareCount = use.shares && mode === 'replace' ? planShares() : survivingShares + planShares();

  // Bản thân admin đang thao tác sau khi nhập
  const me = finalUsers.get(actor.id);
  const impact = {
    logout: !me || me.status !== 'active',
    loseAdmin: Boolean(me) && me.status === 'active' && me.role !== 'admin',
  };

  const removed = { users: 0, diagrams: 0, shares: 0 };
  if (mode === 'replace') {
    if (use.users) removed.users = [...curUsers.keys()].filter((id) => !finalUsers.has(id)).length;
    if (use.diagrams) removed.diagrams = [...curDiagrams.keys()].filter((id) => !finalDiagrams.has(id)).length;
    if (use.shares) removed.shares = current.shares.length;
    else removed.shares = current.shares.length - survivingShares; // share của sơ đồ đã bị thay thế
  }

  return {
    plan, replace, stats, warnings, impact, removed,
    after: {
      users: finalUsers.size,
      diagrams: finalDiagrams.size,
      shares: finalShareCount,
    },
  };
}

/**
 * Nhập dữ liệu từ tệp sao lưu.
 * @param {{ backup:object, mode:'merge'|'replace', dryRun:boolean, sections:object, actor:{id:string} }} opts
 */
export async function importBackup({ backup, mode = 'merge', dryRun = false, sections = {}, actor }) {
  const { data, warnings: envWarnings, meta } = readEnvelope(backup);

  const wantAll = Object.keys(sections).length === 0;
  const use = {};
  for (const k of SECTIONS) use[k] = Array.isArray(data[k]) && (wantAll || sections[k] === true);
  if (!SECTIONS.some((k) => use[k])) {
    throw new BackupError('NOTHING_TO_IMPORT', 'Không có loại dữ liệu nào để nhập. Hãy chọn ít nhất một mục có trong tệp.');
  }
  if (use.shares && !use.diagrams && mode === 'replace') {
    // Share phải trỏ vào sơ đồ đang có; thay riêng share vẫn hợp lệ nên chỉ cảnh báo nhẹ.
    envWarnings.push('Chỉ thay liên kết chia sẻ: những liên kết trỏ tới sơ đồ không tồn tại sẽ bị bỏ qua.');
  }

  const { valid, errors, errorCount, warnings: recWarnings } = validateRecords(data, use);

  const run = async () => {
    const current = await store.backup.exportAll();
    const result = buildPlan({ mode, use, valid, current, actor });
    const warnings = [...envWarnings, ...recWarnings, ...result.warnings];

    let applied = null;
    if (!dryRun) {
      applied = await store.backup.applySnapshot({
        replace: result.replace,
        users: result.plan.users,
        diagrams: result.plan.diagrams,
        shares: result.plan.shares,
      });
      log.info('backup imported', { by: actor.id, mode, stats: result.stats, skippedRecords: errorCount });
    }
    return {
      dryRun,
      mode,
      meta,
      use,
      summary: result.stats,
      removed: result.removed,
      impact: result.impact,
      warnings: warnings.slice(0, 100),
      errors,
      errorCount,
      after: result.after,
      applied,
    };
  };

  // Xem trước chỉ đọc; ghi thật thì xếp hàng để không chạy chồng.
  return dryRun ? run() : exclusive(run);
}
