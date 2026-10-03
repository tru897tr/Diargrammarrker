import { getStore } from '../storage/index.js';
import { newShareToken, deepClone } from '../../server/utils.js';
import createLogger from '../../server/logger.js';

const log = createLogger('diagram-service');
const store = getStore();

/**
 * Diagram service — toan bo nghiep vu ve so do.
 * Authorization (owner check) thuc hien TAI DAY, khong phai o frontend.
 */

async function requireOwnedDiagram(diagramId, userId) {
  const diagram = await store.diagram.getDiagram(diagramId);
  if (!diagram) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    err.status = 404;
    throw err;
  }
  if (diagram.ownerId !== userId) {
    // Tra 404 de khong phoi lo su ton tai cua diagram nguoi khac
    const err = new Error('FORBIDDEN');
    err.code = 'NOT_FOUND';
    err.status = 404;
    throw err;
  }
  return diagram;
}

export async function createDiagram(userId, { name, data }) {
  return store.diagram.createDiagram({ ownerId: userId, name, data });
}

export async function getDiagramForUser(userId, diagramId) {
  return requireOwnedDiagram(diagramId, userId);
}

export async function listUserDiagrams(userId) {
  return store.diagram.listDiagramsByOwner(userId);
}

export async function updateDiagram(userId, diagramId, patch) {
  await requireOwnedDiagram(diagramId, userId);
  return store.diagram.updateDiagram(diagramId, patch);
}

export async function deleteDiagram(userId, diagramId) {
  await requireOwnedDiagram(diagramId, userId);
  // Xoa share truoc khi xoa diagram (store.deleteDiagram cung don share)
  await store.share.revokeShare(diagramId);
  return store.diagram.deleteDiagram(diagramId);
}

/** Duplicate: clone sau, ID moi, owner = nguoi yeu cau, ten + " (ban sao)". */
export async function duplicateDiagram(userId, diagramId) {
  await requireOwnedDiagram(diagramId, userId);
  const original = await store.diagram.getDiagram(diagramId);
  const copy = await store.diagram.createDiagram({
    ownerId: userId,
    name: `${original.name} (bản sao)`,
    data: deepClone(original.data),
  });
  log.info('diagram duplicated', { from: diagramId, to: copy.id });
  return copy;
}

// ---------------------------------------------------------------- share ---

export async function createShare(userId, diagramId) {
  await requireOwnedDiagram(diagramId, userId);
  const existing = await store.share.getShareByDiagram(diagramId);
  if (existing) return existing;
  const share = await store.share.createShare({
    diagramId,
    ownerId: userId,
    token: newShareToken(),
  });
  return share;
}

export async function revokeShare(userId, diagramId) {
  await requireOwnedDiagram(diagramId, userId);
  return store.share.revokeShare(diagramId);
}

/**
 * Doc diagram qua share token (public, khong can login).
 * Chi tra du lieu can render: ten + data. Khong tra owner ID/session.
 */
export async function getSharedDiagram(token) {
  const share = await store.share.getShareByToken(token);
  if (!share) {
    const err = new Error('SHARE_NOT_FOUND');
    err.code = 'SHARE_NOT_FOUND';
    err.status = 404;
    throw err;
  }
  const diagram = await store.diagram.getDiagram(share.diagramId);
  if (!diagram) {
    const err = new Error('SHARE_NOT_FOUND');
    err.code = 'SHARE_NOT_FOUND';
    err.status = 404;
    throw err;
  }
  return {
    share: { token: share.token, createdAt: share.createdAt },
    diagram: { name: diagram.name, data: deepClone(diagram.data) },
  };
}

export { requireOwnedDiagram };
