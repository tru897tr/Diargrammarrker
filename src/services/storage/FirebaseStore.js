import createLogger from '../../server/logger.js';
import { config } from '../../server/config.js';

const log = createLogger('firebase-store');

/**
 * FirebaseStore — SKELETON tuong thich voi StorageAdapter.
 *
 * Trang thai hien tai: KHONG ket noi Firebase.
 * Moi phuong thuc throw STORAGE_NOT_IMPLEMENTED tru khi provider khong duoc
 * kich hoat — app chi dung store nay khi STORAGE_PROVIDER=firebase VA
 * co day du credentials; neu thieu, server tu dong fallback sang memory
 * va canh bao (xem index.js).
 *
 * Chi tiet mapping collection + migration: docs/FIREBASE.md
 */

const NOT_IMPL = (method) => {
  const err = new Error(`FirebaseStore.${method} chưa được triển khai. Xem docs/FIREBASE.md.`);
  err.code = 'STORAGE_NOT_IMPLEMENTED';
  return err;
};

export class FirebaseStore {
  constructor(firebaseConfig = config.firebase) {
    this.config = firebaseConfig;
    this.db = null; // Firestore instance — TODO: firebase-admin
  }

  /** Kiem tra du credentials de bat dau ket noi Firestore. */
  static isConfigured(cfg = config.firebase) {
    return Boolean(cfg.projectId && cfg.clientEmail && cfg.privateKey);
  }

  /** TODO(FIREBASE): init firebase-admin va gán this.db = admin.firestore(). */
  async connect() {
    if (!FirebaseStore.isConfigured(this.config)) {
      const err = new Error('Thiếu các biến môi trường FIREBASE_*.');
      err.code = 'FIREBASE_NOT_CONFIGURED';
      throw err;
    }
    // TODO: const admin = (await import('firebase-admin')).default;
    // admin.initializeApp({ credential: admin.credential.cert({...}) });
    // this.db = admin.firestore();
    throw NOT_IMPL('connect');
  }

  // ---------------------------------------------------------------- user ---
  async createUser() { throw NOT_IMPL('createUser'); }
  async getUserById() { throw NOT_IMPL('getUserById'); }
  async getUserWithHashById() { throw NOT_IMPL('getUserWithHashById'); }
  async getUserByEmail() { throw NOT_IMPL('getUserByEmail'); }
  async getUserByUsername() { throw NOT_IMPL('getUserByUsername'); }
  async countUsers() { throw NOT_IMPL('countUsers'); }
  async listUsers() { throw NOT_IMPL('listUsers'); }
  async updateUser() { throw NOT_IMPL('updateUser'); }

  // ------------------------------------------------------------ session ---
  async createSession() { throw NOT_IMPL('createSession'); }
  async getSession() { throw NOT_IMPL('getSession'); }
  async touchSession() { throw NOT_IMPL('touchSession'); }
  async deleteSession() { throw NOT_IMPL('deleteSession'); }
  async deleteSessionsForUser() { throw NOT_IMPL('deleteSessionsForUser'); }
  async countActiveSessions() { throw NOT_IMPL('countActiveSessions'); }
  async rotateSession() { throw NOT_IMPL('rotateSession'); }

  // ------------------------------------------------------------ diagram ---
  async createDiagram() { throw NOT_IMPL('createDiagram'); }
  async getDiagram() { throw NOT_IMPL('getDiagram'); }
  async listDiagramsByOwner() { throw NOT_IMPL('listDiagramsByOwner'); }
  async updateDiagram() { throw NOT_IMPL('updateDiagram'); }
  async deleteDiagram() { throw NOT_IMPL('deleteDiagram'); }
  async countDiagrams() { throw NOT_IMPL('countDiagrams'); }
  async listAllDiagrams() { throw NOT_IMPL('listAllDiagrams'); }

  // -------------------------------------------------------------- share ---
  async createShare() { throw NOT_IMPL('createShare'); }
  async getShareByToken() { throw NOT_IMPL('getShareByToken'); }
  async getShareByDiagram() { throw NOT_IMPL('getShareByDiagram'); }
  async revokeShare() { throw NOT_IMPL('revokeShare'); }
  async countActiveShares() { throw NOT_IMPL('countActiveShares'); }
}

log.debug('FirebaseStore skeleton loaded');

export default FirebaseStore;
