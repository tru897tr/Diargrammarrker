/**
 * Models — dinh nghia kieu du lieu dung chung giua MemoryStore va FirebaseStore.
 * Cac field trung khop voi mapping Firestore (xem docs/FIREBASE.md).
 */

/** @typedef {{ role: 'admin'|'user', status: 'active'|'locked' }} UserFlags */

/**
 * @typedef {object} User
 * @property {string} id            - crypto.randomUUID()
 * @property {string} username      - 3..32 ky tu
 * @property {string} email         - lowercase
 * @property {string} passwordHash  - bcrypt
 * @property {'admin'|'user'} role
 * @property {'active'|'locked'} status
 * @property {string} createdAt     - ISO
 * @property {string} updatedAt     - ISO
 */

/**
 * @typedef {object} Session
 * @property {string} id            - random 32 bytes base64url
 * @property {string} userId
 * @property {string} csrfToken     - random secret per session
 * @property {string} createdAt     - ISO
 * @property {string} expiresAt     - ISO
 * @property {string} lastSeenAt    - ISO
 * @property {string} [revokedAt]   - ISO khi bi revoke
 */

/**
 * @typedef {object} Diagram
 * @property {string} id
 * @property {string} ownerId
 * @property {string} name          - max 120 ky tu
 * @property {object} data          - diagram JSON (version, viewport, elements)
 * @property {string} createdAt     - ISO
 * @property {string} updatedAt     - ISO
 */

/**
 * @typedef {object} Share
 * @property {string} id            - UUID (khong phai token)
 * @property {string} token         - random 32 bytes base64url (khong doan duoc)
 * @property {string} diagramId
 * @property {string} ownerId
 * @property {string} createdAt     - ISO
 * @property {string|null} revokedAt - ISO khi revoke
 */

/** Fields cong khai cua User khi tra ve API (khong co passwordHash). */
export const PUBLIC_USER_FIELDS = ['id', 'username', 'email', 'role', 'status', 'createdAt', 'updatedAt'];

/** Chuyen User thanh PublicUser — loc passwordHash truoc khi ra khoi server. */
export function toPublicUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

/** Diagram doc vao: co it nhat version/viewport/elements. */
export const EMPTY_DIAGRAM_DATA = Object.freeze({
  version: 1,
  viewport: { x: 0, y: 0, zoom: 1 },
  elements: [],
});
