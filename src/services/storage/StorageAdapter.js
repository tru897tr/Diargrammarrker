/**
 * StorageAdapter — hop dong cua tang luu tru.
 *
 * Toan bo logic nghiep khong biet MemoryStore hay FirebaseStore dang dung.
 * Moi store phai cung cap cac repository theo interface duoi day.
 *
 * Cac ham deu la async de dong bo voi Firestore sau nay (MemoryStore chi la Promise.resolve).
 */

export const StorageAdapter = {
  user: {
    // createUser({ username, email, passwordHash, role }) -> User
    createUser: 'async',
    // getUserById(id) -> User | null
    getUserById: 'async',
    // getUserWithHashById(id) -> User & { passwordHash } | null  (chỉ dùng nội bộ cho xác thực)
    getUserWithHashById: 'async',
    // getUserByEmail(email) -> User | null
    getUserByEmail: 'async',
    // getUserByUsername(username) -> User | null
    getUserByUsername: 'async',
    // countUsers() -> number
    countUsers: 'async',
    // listUsers() -> User[] (cho admin)
    listUsers: 'async',
    // updateUser(id, patch) -> User | null  (role, status, email, username)
    updateUser: 'async',
  },
  session: {
    // createSession({ userId, csrfToken, ttlMs }) -> Session
    createSession: 'async',
    // getSession(id) -> Session | null (chua het han, chua revoke)
    getSession: 'async',
    // touchSession(id) -> void (cap nhat lastSeenAt)
    touchSession: 'async',
    // deleteSession(id) -> void
    deleteSession: 'async',
    // deleteSessionsForUser(userId, exceptSessionId?) -> number so session bi xoa (tru exceptSessionId)
    deleteSessionsForUser: 'async',
    // countActiveSessions() -> number
    countActiveSessions: 'async',
    // rotateSession(id, { csrfToken }) -> Session | null
    rotateSession: 'async',
  },
  diagram: {
    // createDiagram({ ownerId, name, data }) -> Diagram
    createDiagram: 'async',
    // getDiagram(id) -> Diagram | null
    getDiagram: 'async',
    // listDiagramsByOwner(ownerId) -> Diagram[] (moi nhat truoc)
    listDiagramsByOwner: 'async',
    // updateDiagram(id, patch {name?, data?}) -> Diagram | null
    updateDiagram: 'async',
    // deleteDiagram(id) -> Diagram | null (tra ve ban ghi vua xoa)
    deleteDiagram: 'async',
    // countDiagrams() -> number
    countDiagrams: 'async',
    // listAllDiagrams() -> Diagram[] (chi dung cho stats admin)
    listAllDiagrams: 'async',
  },
  share: {
    // createShare({ diagramId, ownerId, token }) -> Share
    createShare: 'async',
    // getShareByToken(token) -> Share | null (active only)
    getShareByToken: 'async',
    // getShareByDiagram(diagramId) -> Share | null (active only)
    getShareByDiagram: 'async',
    // revokeShare(diagramId) -> Share | null
    revokeShare: 'async',
    // countActiveShares() -> number
    countActiveShares: 'async',
  },
};

export default StorageAdapter;
