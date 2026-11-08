// Authorization codes, cookies and tokens are never included in audit/log messages.
import { WhoopError } from './whoop.js';

export function whoopRoutes({ json, readSession, hub }) {
  const cookieName = hub.secureCookie ? '__Secure-whoop_oauth' : 'whoop_oauth';
  const cookie = (value = '') => `${cookieName}=${value}; HttpOnly; SameSite=Lax; Path=/api/whoop/callback; Max-Age=${value ? Math.floor(hub.stateMs / 1000) : 0}${hub.secureCookie ? '; Secure' : ''}`;
  const binding = req => {
    const entries = String(req.headers.cookie || '').split(';').map(s => s.trim()).filter(s => s.startsWith(cookieName + '='));
    return entries.length === 1 ? entries[0].slice(cookieName.length + 1) : '';
  };
  const guard = fn => async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    try { await fn(req, res, user.id); }
    catch (error) {
      const e = error instanceof WhoopError ? error : new WhoopError('remote');
      json(res, e.status, { error: e.message, code: e.code, ...(e.retryAfter ? { retryAfter: e.retryAfter } : {}) }, e.retryAfter ? { 'Retry-After': String(e.retryAfter) } : undefined);
    }
  };
  return {
    'GET /api/whoop/status': guard(async (req, res, uid) => json(res, 200, hub.status(uid))),
    'POST /api/whoop/authorize': guard(async (req, res, uid) => {
      const out = hub.authorize(uid);
      json(res, 200, { url: out.url }, { 'Set-Cookie': cookie(out.binding) });
    }),
    'GET /api/whoop/callback': guard(async (req, res, uid) => {
      const q = new URL(req.url, 'http://local').searchParams;
      let outcome = 'error';
      try {
        if (q.getAll('state').length !== 1 || q.getAll('code').length > 1) throw new WhoopError('state', 400);
        await hub.callback(uid, { state: q.get('state'), code: q.get('code'), error: q.get('error'), binding: binding(req) });
        outcome = 'connected';
      } catch { /* The fixed result reveals neither the provider's error nor authorization data. */ }
      res.writeHead(303, { Location: `/#/settings/integrations?whoop=${outcome}`, 'Set-Cookie': cookie(), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
      res.end();
    }),
    'POST /api/whoop/sync': guard(async (req, res, uid) => json(res, 200, await hub.sync(uid))),
    'POST /api/whoop/disconnect': guard(async (req, res, uid) => json(res, 200, await hub.disconnect(uid))),
  };
}
