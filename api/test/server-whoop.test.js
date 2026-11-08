/* WHOOP's browser boundary through the real API. The child replaces fetch before loading the
 * server: none of these negative OAuth cases may reach WHOOP, even if validation regresses. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://gym.example.test';
const REDIRECT = `${ORIGIN}/api/whoop/callback`;
const CLIENT_SECRET = 'test-only-whoop-client-secret';
const CONFIGURED = {
  WHOOP_CLIENT_ID: 'test-whoop-client',
  WHOOP_CLIENT_SECRET: CLIENT_SECRET,
  WHOOP_REDIRECT_URI: REDIRECT,
};
const CALLBACK_ERROR = '/#/settings/integrations?whoop=error';
const SCOPES = ['offline', 'read:profile', 'read:recovery', 'read:cycles', 'read:sleep', 'read:workout'];

async function startServer(t, env = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-whoop-routes-'));
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(path.join(dataDir, 'secret'), secret, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: ['u_a', 'u_b'].map(id => ({ id, name: id, created: new Date().toISOString() })),
    creds: [], subs: [], invites: [],
  }));
  const attempts = path.join(dataDir, 'unexpected-provider-fetches');
  const guard = path.join(dataDir, 'no-network.mjs');
  fs.writeFileSync(guard, `import fs from 'node:fs';
globalThis.fetch = async () => {
  fs.appendFileSync(${JSON.stringify(attempts)}, 'fetch\\n');
  throw new Error('WHOOP route test forbids external network');
};\n`);
  const child = spawn(process.execPath, ['--import', guard, 'server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN, RP_ID: 'gym.example.test',
      INTEGRATIONS: '', WHOOP_CLIENT_ID: '', WHOOP_CLIENT_SECRET: '', WHOOP_REDIRECT_URI: '',
      ...env,
    },
  });
  const h = { log: '', dataDir };
  child.stdout.on('data', d => { h.log += d; });
  child.stderr.on('data', d => { h.log += d; });
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const api = `http://127.0.0.1:${await boundPort(child, () => h.log)}`;
  const session = uid => {
    const payload = `${uid}:${Date.now() + 86400000}:0`;
    return payload + '.' + crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  };
  h.call = async (method, route, { uid = 'u_a', cookie = '', headers = {}, body } = {}) => {
    const cookies = [...(uid ? [`gymsid=${session(uid)}`] : []), ...(cookie ? [cookie] : [])];
    const response = await fetch(api + route, {
      method, redirect: 'manual',
      headers: { 'Content-Type': 'application/json', ...(cookies.length ? { Cookie: cookies.join('; ') } : {}), ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* redirects have no JSON body */ }
    return { status: response.status, headers: response.headers, body: parsed, text };
  };
  h.assertNoProviderCalls = () => assert.equal(fs.existsSync(attempts), false, 'invalid OAuth must fail before a provider request');
  return h;
}

const bindingCookie = response => {
  const cookie = response.headers.get('set-cookie');
  assert.ok(cookie, 'authorization sets a browser-binding cookie');
  return cookie.split(';')[0];
};
const stateOf = response => new URL(response.body.url).searchParams.get('state');
const callback = (state, extra = '') => `/api/whoop/callback?state=${encodeURIComponent(state)}${extra}`;
const assertCallbackError = response => {
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), CALLBACK_ERROR);
  assert.equal(response.headers.get('cache-control'), 'no-store');
};

test('every WHOOP route requires a Home Gym account, even when the provider is unconfigured', async t => {
  const h = await startServer(t);
  for (const [method, route] of [
    ['GET', '/api/whoop/status'], ['POST', '/api/whoop/authorize'],
    ['GET', '/api/whoop/callback?state=12345678&code=fake'],
    ['POST', '/api/whoop/sync'], ['POST', '/api/whoop/disconnect'],
  ]) {
    const r = await h.call(method, route, { uid: null });
    assert.equal(r.status, 401, `${method} ${route}`);
    assert.equal(r.headers.get('location'), null);
  }
  h.assertNoProviderCalls();
});

test('missing or incomplete WHOOP credentials report unavailable without creating a connection', async t => {
  for (const env of [{}, { WHOOP_CLIENT_ID: CONFIGURED.WHOOP_CLIENT_ID, WHOOP_REDIRECT_URI: REDIRECT }]) {
    const h = await startServer(t, env);
    const status = await h.call('GET', '/api/whoop/status');
    assert.equal(status.status, 200);
    assert.deepEqual(status.body, { configured: false, connected: false, lastSync: null, error: null, data: null });
    for (const route of ['/api/whoop/authorize', '/api/whoop/sync']) {
      const r = await h.call('POST', route);
      assert.ok(r.status >= 400 && r.status < 500 || r.status === 503, `${route}: ${r.status}`);
      assert.equal(r.body?.url, undefined);
      assert.equal(r.headers.get('set-cookie'), null);
    }
    const other = await h.call('GET', '/api/whoop/status', { uid: 'u_b' });
    assert.deepEqual(other.body, status.body);
    h.assertNoProviderCalls();
  }
});

test('authorization uses fixed provider URLs, read scopes and a secure browser-binding cookie', async t => {
  const h = await startServer(t, CONFIGURED);
  const status = await h.call('GET', '/api/whoop/status');
  assert.deepEqual(status.body, { configured: true, connected: false, lastSync: null, error: null, data: null });
  const r = await h.call('POST', '/api/whoop/authorize', {
    body: { redirect_uri: 'https://attacker.example/callback', returnTo: 'https://attacker.example/', uid: 'u_b' },
  });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(Object.keys(r.body), ['url']);
  const url = new URL(r.body.url);
  assert.equal(url.origin, 'https://api.prod.whoop.com');
  assert.equal(url.pathname, '/oauth/oauth2/auth');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('client_id'), CONFIGURED.WHOOP_CLIENT_ID);
  assert.equal(url.searchParams.get('redirect_uri'), REDIRECT);
  assert.deepEqual(url.searchParams.get('scope').split(/\s+/).sort(), [...SCOPES].sort());
  assert.match(url.searchParams.get('state'), /^[A-Za-z0-9_-]{8}$/);
  assert.equal(url.searchParams.has('client_secret'), false);
  assert.equal(r.text.includes(CLIENT_SECRET), false);
  const setCookie = r.headers.get('set-cookie');
  bindingCookie(r);
  assert.match(setCookie, /;\s*HttpOnly(?:;|$)/i);
  assert.match(setCookie, /;\s*Secure(?:;|$)/i);
  assert.match(setCookie, /;\s*SameSite=Lax(?:;|$)/i);
  const cookiePath = /(?:^|;)\s*Path=([^;]+)/i.exec(setCookie)?.[1];
  assert.ok(cookiePath && '/api/whoop/callback'.startsWith(cookiePath), 'the callback receives the binding cookie');
  assert.doesNotMatch(setCookie, /;\s*Domain=/i);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  h.assertNoProviderCalls();
});

test('cross-site mutations are refused before authorization, synchronization, or disconnection', async t => {
  const h = await startServer(t, CONFIGURED);
  for (const route of ['/api/whoop/authorize', '/api/whoop/sync', '/api/whoop/disconnect']) {
    for (const headers of [
      { Origin: 'https://attacker.example' },
      { Origin: ORIGIN, 'Sec-Fetch-Site': 'cross-site' },
      { Origin: 'https://other.example.test', 'Sec-Fetch-Site': 'same-site' },
    ]) {
      const r = await h.call('POST', route, { headers });
      assert.equal(r.status, 403, `${route}: ${JSON.stringify(headers)}`);
      assert.equal(r.headers.get('set-cookie'), null);
      assert.equal(r.body?.url, undefined);
    }
  }
  h.assertNoProviderCalls();
});

test('callbacks reject missing state, another profile, or another browser and use one fixed redirect', async t => {
  const h = await startServer(t, CONFIGURED);
  const invalid = await h.call('GET', '/api/whoop/callback?code=fake&returnTo=https://attacker.example/');
  assertCallbackError(invalid);
  for (const mismatch of ['profile', 'browser', 'missing-cookie']) {
    const auth = await h.call('POST', '/api/whoop/authorize');
    const cookie = bindingCookie(auth);
    const request = mismatch === 'profile' ? { uid: 'u_b', cookie }
      : mismatch === 'browser' ? { cookie: cookie.replace(/=.*/, '=different-browser-binding') } : {};
    const r = await h.call('GET', callback(stateOf(auth), '&code=fake&redirect_uri=https://attacker.example/'), request);
    assertCallbackError(r);
  }
  assert.equal((await h.call('GET', '/api/whoop/status')).body.connected, false);
  assert.equal((await h.call('GET', '/api/whoop/status', { uid: 'u_b' })).body.connected, false);
  h.assertNoProviderCalls();
});

test('denied authorization consumes the state; replay cannot exchange a code or reflect provider text', async t => {
  const h = await startServer(t, CONFIGURED);
  const auth = await h.call('POST', '/api/whoop/authorize');
  const options = { cookie: bindingCookie(auth) };
  const denied = await h.call('GET', callback(stateOf(auth), '&error=access_denied&error_description=untrusted-secret-text'), options);
  assertCallbackError(denied);
  assert.equal(denied.text.includes('untrusted-secret-text'), false);
  const replay = await h.call('GET', callback(stateOf(auth), '&code=fake'), options);
  assertCallbackError(replay);
  h.assertNoProviderCalls();
});

test('disconnect cancels a pending OAuth flow before any provider token exists', async t => {
  const h = await startServer(t, CONFIGURED);
  const auth = await h.call('POST', '/api/whoop/authorize');
  const disconnected = await h.call('POST', '/api/whoop/disconnect');
  assert.equal(disconnected.status, 200);
  assert.deepEqual(disconnected.body, { ok: true, revokeRequired: false });
  const late = await h.call('GET', callback(stateOf(auth), '&code=fake'), { cookie: bindingCookie(auth) });
  assertCallbackError(late);
  assert.equal((await h.call('GET', '/api/whoop/status')).body.connected, false);
  h.assertNoProviderCalls();
});
