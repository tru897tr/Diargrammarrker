import crypto from 'node:crypto';

/**
 * Sinh ID an toan, kho doan (khong dung ID tuan tu).
 * Dung cho user, diagram, session, share token.
 */
export function newId() {
  return crypto.randomUUID();
}

/** Token share dai va ngau nhien, base64url (khong kem / +). */
export function newShareToken() {
  return crypto.randomBytes(32).toString('base64url');
}

/** Session ID dai, ngau nhien. */
export function newSessionId() {
  return crypto.randomBytes(32).toString('base64url');
}

/** CSRF secret per-token, HMAC-able. */
export function newSecret(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function now() {
  return Date.now();
}

/** Timestamp dang ISO 8601. */
export function iso(ts = Date.now()) {
  return new Date(ts).toISOString();
}

/** Deep clone JSON-safe data (dung cho duplicate diagram). */
export function deepClone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

/** Doi tuong read-only de tra ve tu API/lay tu store, tranh mutate tu ben ngoai. */
export function readonlyClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}
