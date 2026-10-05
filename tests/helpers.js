// Máy khách HTTP tối giản cho test tích hợp: giữ cookie, tự gắn CSRF.
export function createClient(base) {
  const jar = new Map();
  let csrf = null;
  const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const store = (res) => {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim(), value = pair.slice(i + 1).trim();
      if (/expires=Thu, 01 Jan 1970/i.test(c) || value === '') jar.delete(name); else jar.set(name, value);
    }
  };
  async function req(method, path, body) {
    const headers = { Cookie: cookieHeader(), Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET' && csrf) headers['X-CSRF-Token'] = csrf;
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    store(res);
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* HTML */ }
    return { status: res.status, headers: res.headers, json, text };
  }
  /** Đăng ký tài khoản và lấy CSRF token từ phản hồi. */
  async function register(username, password = 'Mat-khau-Rat-Dai-123!') {
    const r = await req('POST', '/api/v1/auth/register', { username, email: `${username}@example.com`, password, confirmPassword: password });
    csrf = r.json?.data?.csrfToken ?? null;
    return r;
  }
  return { req, register, get: (p) => req('GET', p), post: (p, b) => req('POST', p, b ?? {}), patch: (p, b) => req('PATCH', p, b), del: (p) => req('DELETE', p) };
}
