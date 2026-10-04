import { newId, now, iso, deepClone } from '../../server/utils.js';
import { toPublicUser } from './models.js';
import createLogger from '../../server/logger.js';

const log = createLogger('memory-store');

/**
 * MemoryStore — implementation mac dinh cua StorageAdapter.
 * Toan bo du lieu nam trong RAM cua process: Map/Set.
 *
 * LUU Y QUAN TRONG:
 * - Du lieu TAM THOI, mat khi restart/redeploy (dung nhu README da ghi).
 * - registerLock dam bao tai khoan admin dau tien duoc xac dinh atomic
 *   (khong co 2 request cung luc cung thanh admin).
 * - Session cleanup chay moi lan getSession/ countActiveSessions de don dep.
 */

/** Loc ket qua cua diagram cho API (khong lo data lon khi list). */
function diagramSummary(d) {
  return { id: d.id, name: d.name, ownerId: d.ownerId, createdAt: d.createdAt, updatedAt: d.updatedAt };
}

function publicDiagram(d) {
  return { ...d, data: deepClone(d.data) };
}

export class MemoryStore {
  constructor() {
    this.users = new Map();        // userId -> User
    this.sessions = new Map();     // sessionId -> Session
    this.diagrams = new Map();     // diagramId -> Diagram
    this.shares = new Map();       // shareId -> Share
    this.sharesByToken = new Map();// token -> shareId
    this.sharesByDiagram = new Map(); // diagramId -> shareId

    /** Mutex cho register — dam bao chi MOT admin dau tien. */
    this._registerLock = Promise.resolve();
    this._hasAdmin = false;
  }

  // ---------------------------------------------------------------- user ---
  async createUser({ username, email, passwordHash, role = 'user' }) {
    // Race-condition guard: chay tung register mot, kiem tra hasAdmin ben trong.
    const user = await this._registerLock.then(async () => {
      const emailTaken = [...this.users.values()].some((u) => u.email === email);
      const nameTaken = [...this.users.values()].some((u) => u.username === username);
      if (emailTaken) {
        const err = new Error('EMAIL_TAKEN'); err.code = 'CONFLICT_EMAIL'; throw err;
      }
      if (nameTaken) {
        const err = new Error('USERNAME_TAKEN'); err.code = 'CONFLICT_USERNAME'; throw err;
      }
      const finalRole = this._hasAdmin ? 'user' : 'admin';
      this._hasAdmin = true;
      const u = {
        id: newId(),
        username,
        email: email.toLowerCase(),
        passwordHash,
        role: role === 'admin' && finalRole === 'admin' ? 'admin' : finalRole,
        status: 'active',
        createdAt: iso(now()),
        updatedAt: iso(now()),
      };
      this.users.set(u.id, u);
      log.info('user created', { id: u.id, role: u.role });
      return u;
    });
    return toPublicUser(user);
  }

  async getUserById(id) {
    const u = this.users.get(id);
    return u ? toPublicUser(u) : null;
  }

  /**
   * Chỉ dùng nội bộ cho xác thực (đăng nhập / đổi mật khẩu): trả về user KÈM passwordHash.
   * Không bao giờ trả giá trị này ra API.
   */
  async getUserWithHashById(id) {
    const u = this.users.get(id);
    return u ? { ...u } : null;
  }

  async getUserByEmail(email) {
    const e = String(email).toLowerCase();
    for (const u of this.users.values()) {
      if (u.email === e) return toPublicUser(u);
    }
    return null;
  }

  async getUserByUsername(username) {
    for (const u of this.users.values()) {
      if (u.username === username) return toPublicUser(u);
    }
    return null;
  }

  async countUsers() {
    return this.users.size;
  }

  async listUsers() {
    return [...this.users.values()].map(toPublicUser)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /** Patch cho phep: username, email, passwordHash, role, status. */
  async updateUser(id, patch) {
    const u = this.users.get(id);
    if (!u) return null;
    if (patch.username !== undefined) {
      const taken = [...this.users.values()].some((o) => o.id !== id && o.username === patch.username);
      if (taken) { const err = new Error('USERNAME_TAKEN'); err.code = 'CONFLICT_USERNAME'; throw err; }
      u.username = patch.username;
    }
    if (patch.email !== undefined) {
      const taken = [...this.users.values()].some((o) => o.id !== id && o.email === patch.email.toLowerCase());
      if (taken) { const err = new Error('EMAIL_TAKEN'); err.code = 'CONFLICT_EMAIL'; throw err; }
      u.email = patch.email.toLowerCase();
    }
    if (patch.passwordHash !== undefined) u.passwordHash = patch.passwordHash;
    if (patch.role !== undefined) u.role = patch.role;
    if (patch.status !== undefined) u.status = patch.status;
    u.updatedAt = iso(now());
    return toPublicUser(u);
  }

  // ------------------------------------------------------------ session ---
  async createSession({ userId, csrfToken, ttlMs }) {
    const s = {
      id: crypto.randomUUID(),
      userId,
      csrfToken,
      createdAt: iso(now()),
      expiresAt: iso(now() + ttlMs),
      lastSeenAt: iso(now()),
    };
    this.sessions.set(s.id, s);
    return { ...s };
  }

  async getSession(id) {
    const s = this.sessions.get(id);
    if (!s) return null;
    if (Date.parse(s.expiresAt) < now()) {
      this.sessions.delete(id);
      return null;
    }
    return { ...s };
  }

  async touchSession(id) {
    const s = this.sessions.get(id);
    if (!s) return;
    s.lastSeenAt = iso(now());
  }

  async deleteSession(id) {
    return this.sessions.delete(id);
  }

  /** Xóa mọi session của user, trừ `exceptSessionId` (nếu có). Trả về số session đã xóa. */
  async deleteSessionsForUser(userId, exceptSessionId = null) {
    let n = 0;
    for (const [id, s] of this.sessions) {
      if (s.userId === userId && id !== exceptSessionId) { this.sessions.delete(id); n++; }
    }
    return n;
  }

  async countActiveSessions() {
    const t = now();
    let n = 0;
    for (const s of this.sessions.values()) {
      if (Date.parse(s.expiresAt) >= t) n++;
    }
    return n;
  }

  /** Session rotation: tao id moi, giu userId, csrf moi. */
  async rotateSession(id, { csrfToken, ttlMs }) {
    const old = this.sessions.get(id);
    if (!old) return null;
    this.sessions.delete(id);
    const s = {
      id: crypto.randomUUID(),
      userId: old.userId,
      csrfToken,
      createdAt: iso(now()),
      expiresAt: iso(now() + ttlMs),
      lastSeenAt: iso(now()),
    };
    this.sessions.set(s.id, s);
    return { ...s };
  }

  // ------------------------------------------------------------ diagram ---
  async createDiagram({ ownerId, name, data }) {
    const d = {
      id: newId(),
      ownerId,
      name,
      data: deepClone(data),
      createdAt: iso(now()),
      updatedAt: iso(now()),
    };
    this.diagrams.set(d.id, d);
    return publicDiagram(d);
  }

  async getDiagram(id) {
    const d = this.diagrams.get(id);
    return d ? publicDiagram(d) : null;
  }

  async listDiagramsByOwner(ownerId) {
    return [...this.diagrams.values()]
      .filter((d) => d.ownerId === ownerId)
      .map(diagramSummary)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async updateDiagram(id, patch) {
    const d = this.diagrams.get(id);
    if (!d) return null;
    if (patch.name !== undefined) d.name = patch.name;
    if (patch.data !== undefined) d.data = deepClone(patch.data);
    d.updatedAt = iso(now());
    return publicDiagram(d);
  }

  async deleteDiagram(id) {
    const d = this.diagrams.get(id);
    if (!d) return null;
    this.diagrams.delete(id);
    // Xoa share lien quan
    const shareId = this.sharesByDiagram.get(id);
    if (shareId) {
      const sh = this.shares.get(shareId);
      if (sh) this.sharesByToken.delete(sh.token);
      this.shares.delete(shareId);
      this.sharesByDiagram.delete(id);
    }
    return publicDiagram(d);
  }

  async countDiagrams() {
    return this.diagrams.size;
  }

  async listAllDiagrams() {
    return [...this.diagrams.values()].map(diagramSummary)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  // -------------------------------------------------------------- share ---
  async createShare({ diagramId, ownerId, token }) {
    // Mot diagram chi co mot active share
    const existing = this.sharesByDiagram.get(diagramId);
    if (existing) {
      const sh = this.shares.get(existing);
      if (sh && !sh.revokedAt) return { ...sh };
    }
    const s = {
      id: newId(),
      token,
      diagramId,
      ownerId,
      createdAt: iso(now()),
      revokedAt: null,
    };
    this.shares.set(s.id, s);
    this.sharesByToken.set(token, s.id);
    this.sharesByDiagram.set(diagramId, s.id);
    return { ...s };
  }

  async getShareByToken(token) {
    const id = this.sharesByToken.get(token);
    if (!id) return null;
    const s = this.shares.get(id);
    if (!s || s.revokedAt) return null;
    return { ...s };
  }

  async getShareByDiagram(diagramId) {
    const id = this.sharesByDiagram.get(diagramId);
    if (!id) return null;
    const s = this.shares.get(id);
    if (!s || s.revokedAt) return null;
    return { ...s };
  }

  async revokeShare(diagramId) {
    const id = this.sharesByDiagram.get(diagramId);
    if (!id) return null;
    const s = this.shares.get(id);
    if (!s) return null;
    s.revokedAt = iso(now());
    this.sharesByToken.delete(s.token);
    this.sharesByDiagram.delete(diagramId);
    return { ...s };
  }

  async countActiveShares() {
    let n = 0;
    for (const s of this.shares.values()) if (!s.revokedAt) n++;
    return n;
  }

  // ------------------------------------------------------- backup/restore ---

  /**
   * Chụp toàn bộ dữ liệu để sao lưu (bản sao sâu). Có passwordHash của user — CHỈ dùng cho
   * tính năng xuất dữ liệu của admin. Không gồm session (phiên đăng nhập là tạm thời).
   */
  async exportAll() {
    return {
      users: [...this.users.values()].map((u) => ({ ...u })),
      diagrams: [...this.diagrams.values()].map(publicDiagram),
      shares: [...this.shares.values()].filter((s) => !s.revokedAt).map((s) => ({ ...s })),
    };
  }

  /**
   * Áp dụng dữ liệu đã được service kiểm tra/chuẩn hóa. Toàn bộ thân hàm chạy đồng bộ
   * (không có await) nên không request nào chen vào giữa chừng.
   * - replace.<mục> = true: xóa sạch mục đó trước khi ghi.
   * - Sau khi ghi: dọn share mồ côi, dựng lại chỉ mục share, hủy session của user không còn tồn tại / bị khóa.
   */
  async applySnapshot({ replace = {}, users = [], diagrams = [], shares = [] } = {}) {
    if (replace.users) this.users.clear();
    for (const u of users) this.users.set(u.id, { ...u });

    if (replace.diagrams) this.diagrams.clear();
    for (const d of diagrams) this.diagrams.set(d.id, { ...d, data: deepClone(d.data) });

    if (replace.shares) this.shares.clear();
    for (const sh of shares) this.shares.set(sh.id, { ...sh, revokedAt: null });

    // Dọn dẹp + dựng lại chỉ mục
    this.sharesByToken.clear();
    this.sharesByDiagram.clear();
    for (const [id, sh] of [...this.shares]) {
      if (sh.revokedAt || !this.diagrams.has(sh.diagramId)) { this.shares.delete(id); continue; }
      this.sharesByToken.set(sh.token, id);
      this.sharesByDiagram.set(sh.diagramId, id);
    }
    for (const [id, session] of [...this.sessions]) {
      const owner = this.users.get(session.userId);
      if (!owner || owner.status !== 'active') this.sessions.delete(id);
    }
    // Chưa có admin nào → người đăng ký kế tiếp sẽ thành admin (giống lúc mới khởi động).
    this._hasAdmin = [...this.users.values()].some((u) => u.role === 'admin');
    log.info('snapshot applied', { users: this.users.size, diagrams: this.diagrams.size, shares: this.shares.size });
    return { users: this.users.size, diagrams: this.diagrams.size, shares: this.shares.size };
  }
}

export default MemoryStore;
