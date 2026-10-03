import { config } from '../../server/config.js';
import createLogger from '../../server/logger.js';
import { MemoryStore } from './MemoryStore.js';
import { FirebaseStore } from './FirebaseStore.js';

const log = createLogger('storage');

/**
 * Factory chon store theo STORAGE_PROVIDER.
 *
 * - memory (mac dinh): RAM store, du lieu tam thoi.
 * - firebase: skeleton — chi kich hoat khi du credentials, neu thieu
 *   thi fallback ve memory va canh bao (khong lam crash server).
 *
 * Logic nghiep (routes/controllers) chi import store tu day,
 * khong bao gio import MemoryStore/FirebaseStore truc tiep.
 */

let store = null;

/**
 * MemoryStore duoc boc lai thanh API co repository (store.user, store.session,
 * store.diagram, store.share) — dung hinh dang cho tat ca store (memory/firebase),
 * de logic nghiep goi giong nhau khi doi provider.
 */
function withRepositories(base) {
  return {
    user: base.user ?? {
      createUser: (...a) => base.createUser(...a),
      getUserById: (...a) => base.getUserById(...a),
      getUserByEmail: (...a) => base.getUserByEmail(...a),
      getUserByUsername: (...a) => base.getUserByUsername(...a),
      countUsers: (...a) => base.countUsers(...a),
      listUsers: (...a) => base.listUsers(...a),
      updateUser: (...a) => base.updateUser(...a),
    },
    session: base.session ?? {
      createSession: (...a) => base.createSession(...a),
      getSession: (...a) => base.getSession(...a),
      touchSession: (...a) => base.touchSession(...a),
      deleteSession: (...a) => base.deleteSession(...a),
      deleteSessionsForUser: (...a) => base.deleteSessionsForUser(...a),
      countActiveSessions: (...a) => base.countActiveSessions(...a),
      rotateSession: (...a) => base.rotateSession(...a),
    },
    diagram: base.diagram ?? {
      createDiagram: (...a) => base.createDiagram(...a),
      getDiagram: (...a) => base.getDiagram(...a),
      listDiagramsByOwner: (...a) => base.listDiagramsByOwner(...a),
      updateDiagram: (...a) => base.updateDiagram(...a),
      deleteDiagram: (...a) => base.deleteDiagram(...a),
      countDiagrams: (...a) => base.countDiagrams(...a),
      listAllDiagrams: (...a) => base.listAllDiagrams(...a),
    },
    share: base.share ?? {
      createShare: (...a) => base.createShare(...a),
      getShareByToken: (...a) => base.getShareByToken(...a),
      getShareByDiagram: (...a) => base.getShareByDiagram(...a),
      revokeShare: (...a) => base.revokeShare(...a),
      countActiveShares: (...a) => base.countActiveShares(...a),
    },
    // Giu tham chieu truc tiep cho cac back-compat call base.method(...)
    ...proxyAll(base),
  };
}

/** Proxy moi phuong thuc truc tiep cua base len store (back-compat). */
function proxyAll(base) {
  const out = {};
  for (const key of Object.getOwnPropertyNames(Object.getPrototypeOf(base))) {
    if (key === 'constructor' || typeof base[key] !== 'function') continue;
    if (!(key in out)) out[key] = (...a) => base[key](...a);
  }
  return out;
}

export function getStore() {
  if (store) return store;

  const provider = config.storageProvider.toLowerCase();

  if (provider === 'firebase') {
    if (FirebaseStore.isConfigured()) {
      log.warn('STORAGE_PROVIDER=firebase duoc chon nhung FirebaseStore chua trien khai — fallback sang memory.');
    } else {
      log.warn('STORAGE_PROVIDER=firebase nhung thieu FIREBASE_* env — fallback sang memory.');
    }
  }

  store = withRepositories(new MemoryStore());
  log.info(`storage provider: memory${provider === 'firebase' ? ' (fallback)' : ''}`);
  return store;
}

/** Chi dung cho test — reset singleton. */
export function _resetStore() {
  store = null;
}

export default getStore;
