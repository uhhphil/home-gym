import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWhoop, projectWhoop, WHOOP_SCOPES } from '../integrations/whoop.js';

const SECRET = 'a'.repeat(64);
const ENV = { WHOOP_CLIENT_ID: 'test-client', WHOOP_CLIENT_SECRET: 'client-secret-private', WHOOP_REDIRECT_URI: 'https://gym.example/api/whoop/callback', ORIGIN: 'https://gym.example' };
const T = Date.parse('2026-11-08T12:00:00Z');
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const timed = { start: '2026-11-07T08:00:00Z', end: '2026-11-07T09:00:00Z', updated_at: '2026-11-07T10:00:00Z', score_state: 'SCORED' };
const records = {
  '/cycle': [{ ...timed, id: 17, step_count: 1234, score: { strain: 7.2, average_heart_rate: 69 } }],
  '/activity/sleep': [{ ...timed, id: 'sleep-uuid', nap: false, score: { sleep_performance_percentage: 80, stage_summary: { total_light_sleep_time_milli: 100, total_slow_wave_sleep_time_milli: 200, total_rem_sleep_time_milli: 300, total_in_bed_time_milli: 2000 } } }],
  '/recovery': [{ ...timed, cycle_id: 17, sleep_id: 'sleep-uuid', created_at: timed.start, score: { recovery_score: 75, hrv_rmssd_milli: 45.2, resting_heart_rate: 52 } }],
  '/activity/workout': [{ ...timed, id: 'workout-uuid', sport_name: 'Running', score: { strain: 8, average_heart_rate: 135, max_heart_rate: 161, distance_meter: 5000, kilojoule: 650 } }],
};

function fixture(t, options = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-whoop-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const h = { dataDir, clock: T, calls: [], tokenCount: 0, account: 101, hook: null, records: structuredClone(records) };
  h.transport = async (url, opts) => {
    const u = new URL(url);
    const call = { url: u, opts, body: new URLSearchParams(opts.body || '') };
    h.calls.push(call);
    const override = await h.hook?.(call);
    if (override !== undefined) return override;
    if (u.pathname === '/oauth/oauth2/token') {
      h.tokenCount++;
      return json({ access_token: 'access-secret-' + h.tokenCount, refresh_token: 'refresh-secret-' + h.tokenCount, expires_in: 3600, token_type: 'Bearer' });
    }
    if (u.pathname === '/developer/v2/user/profile/basic') return json({ user_id: h.account, first_name: 'not-stored', email: 'not-stored@example.com' });
    if (u.pathname === '/developer/v2/user/access') return new Response(null, { status: 204 });
    const data = h.records[u.pathname.replace('/developer/v2', '')];
    assert.ok(data, 'only fixed known provider endpoints: ' + u.pathname);
    return json({ records: data, next_token: null });
  };
  h.make = (extra = {}) => createWhoop({ dataDir, secret: SECRET, env: ENV, now: () => h.clock, transport: h.transport, ...options, ...extra });
  h.hub = h.make();
  h.connect = async (uid = 'user_a') => {
    const start = h.hub.authorize(uid);
    const state = new URL(start.url).searchParams.get('state');
    await h.hub.callback(uid, { state, binding: start.binding, code: 'test-code' });
    return start;
  };
  h.file = uid => path.join(dataDir, 'integrations/whoop/u-' + uid + '.json');
  h.cache = uid => path.join(dataDir, 'integrations/whoop/summary-' + uid + '.json');
  return h;
}

test('disabled or incorrectly routed configuration is inert and does not create files', t => {
  const h = fixture(t, { env: {} });
  assert.deepEqual(h.hub.status('user_a'), { configured: false, connected: false, lastSync: null, error: null, data: null });
  assert.throws(() => h.hub.authorize('user_a'), { code: 'off', status: 503 });
  assert.equal(fs.existsSync(path.join(h.dataDir, 'integrations')), false);
  for (const redirect of ['https://elsewhere.example/api/whoop/callback', 'https://gym.example/wrong', 'https://gym.example/api/whoop/callback?return=https://evil.example', 'http://gym.example/api/whoop/callback']) {
    assert.equal(h.make({ env: { ...ENV, WHOOP_REDIRECT_URI: redirect } }).configured, false);
  }
  assert.equal(h.make({ env: { ...ENV, WHOOP_REDIRECT_URI: 'http://localhost:8080/api/whoop/callback', ORIGIN: 'http://localhost:8080' } }).configured, true);
});

test('authorization has eight random state characters, read scopes, user/browser binding and one-use state', async t => {
  const h = fixture(t);
  const start = h.hub.authorize('user_a'), u = new URL(start.url), state = u.searchParams.get('state');
  assert.equal(u.origin + u.pathname, 'https://api.prod.whoop.com/oauth/oauth2/auth');
  assert.match(state, /^[\w-]{8}$/);
  assert.deepEqual(u.searchParams.get('scope').split(' '), WHOOP_SCOPES);
  assert.equal(u.searchParams.get('redirect_uri'), ENV.WHOOP_REDIRECT_URI);
  assert.ok(!start.url.includes(ENV.WHOOP_CLIENT_SECRET));
  const args = { state, binding: start.binding, code: 'test-code' };
  await assert.rejects(h.hub.callback('user_b', args), { code: 'state' });
  await assert.rejects(h.hub.callback('user_a', { ...args, binding: 'wrong' }), { code: 'state' });
  assert.equal(h.calls.length, 0);
  await h.hub.callback('user_a', args);
  await assert.rejects(h.hub.callback('user_a', args), { code: 'state' });
  assert.equal(h.tokenCount, 1);
  const expired = h.hub.authorize('user_b');
  h.clock += 600_001;
  await assert.rejects(h.hub.callback('user_b', { code: 'x', binding: expired.binding, state: new URL(expired.url).searchParams.get('state') }), { code: 'state' });
  assert.equal(h.tokenCount, 1);
});

test('tokens stay encrypted per user and survive restart without entering public status or profile state', async t => {
  const h = fixture(t);
  await h.connect();
  assert.equal(h.hub.status('user_a').connected, true);
  assert.equal(h.hub.status('user_b').connected, false);
  const disk = fs.readFileSync(h.file('user_a'), 'utf8');
  assert.match(disk, /v1\./);
  assert.equal(fs.statSync(h.file('user_a')).mode & 0o777, 0o600);
  for (const secret of ['access-secret-', 'refresh-secret-', ENV.WHOOP_CLIENT_SECRET, 'not-stored']) {
    assert.ok(!disk.includes(secret));
    assert.ok(!JSON.stringify(h.hub.status('user_a')).includes(secret));
  }
  assert.equal(h.make().status('user_a').connected, true);
  assert.equal(h.make({ secret: 'b'.repeat(64) }).status('user_a').connected, false);
  fs.copyFileSync(h.file('user_a'), h.file('user_b'));
  assert.equal(h.make().status('user_b').connected, false, 'copied credentials cannot decrypt for another profile');
  assert.equal(fs.existsSync(path.join(h.dataDir, 'state-user_a.json')), false);
});

test('projections preserve IDs and original units; absent or unscored values stay null', () => {
  const cycle = projectWhoop('cycles', records['/cycle'][0]);
  assert.equal(cycle.id, 17);
  assert.equal(cycle.stepCount, 1234);
  assert.equal(projectWhoop('cycles', { ...records['/cycle'][0], end: null }).end, null);
  const sleep = projectWhoop('sleeps', records['/activity/sleep'][0]);
  assert.equal(sleep.sleepMs, 600, 'sleep stages, not time in bed');
  assert.equal(sleep.nap, false);
  const recovery = projectWhoop('recoveries', records['/recovery'][0]);
  assert.equal(recovery.id, 'sleep-uuid');
  assert.equal(recovery.cycleId, 17);
  assert.equal(recovery.hrv, 45.2);
  const workout = projectWhoop('workouts', records['/activity/workout'][0]);
  assert.equal(workout.distanceMeters, 5000);
  assert.equal(workout.kilojoules, 650);
  assert.equal(workout.sport, 'Running');
  const pending = projectWhoop('workouts', { ...records['/activity/workout'][0], score_state: 'PENDING_SCORE' });
  assert.equal(pending.strain, null);
  assert.equal(pending.distanceMeters, null);
  assert.equal(projectWhoop('sleeps', { ...records['/activity/sleep'][0], score: {} }).sleepMs, null);
});

test('sync follows bounded pagination, deduplicates by stable ID and keeps the newest provider update', async t => {
  const h = fixture(t);
  await h.connect();
  h.hook = ({ url }) => {
    if (url.pathname !== '/developer/v2/cycle') return;
    if (!url.searchParams.has('nextToken')) return json({ records: [records['/cycle'][0]], next_token: 'cursor-two' });
    assert.equal(url.searchParams.get('nextToken'), 'cursor-two');
    return json({ records: [{ ...records['/cycle'][0], updated_at: '2026-11-08T10:00:00Z', score: { strain: 9 } }, { ...records['/cycle'][0], updated_at: '2026-11-06T10:00:00Z', score: { strain: 2 } }], next_token: null });
  };
  const result = await h.hub.sync('user_a');
  assert.equal(result.lastSync, T);
  assert.equal(result.data.accountId, '101');
  assert.equal(result.data.cycles.length, 1);
  assert.equal(result.data.cycles[0].strain, 9);
  assert.equal(result.data.sleeps[0].sleepMs, 600);
  assert.deepEqual(JSON.parse(fs.readFileSync(h.cache('user_a'), 'utf8')), result.data);
  assert.equal(fs.statSync(h.cache('user_a')).mode & 0o777, 0o600);
  for (const { url, opts } of h.calls.filter(c => c.url.searchParams.has('start'))) {
    assert.equal(url.searchParams.get('start'), '2026-10-09T12:00:00.000Z');
    assert.equal(url.searchParams.get('end'), '2026-11-08T12:00:00.000Z');
    assert.equal(url.searchParams.get('limit'), '25');
    assert.equal(opts.redirect, 'error');
  }
  assert.equal(h.hub.status('user_b').data, null);
  assert.equal(h.make().status('user_a').data.workouts[0].id, 'workout-uuid');
  assert.equal(fs.existsSync(path.join(h.dataDir, 'state-user_a.json')), false);
});

test('a failed partial fetch preserves the entire prior snapshot and returns only a safe error', async t => {
  const h = fixture(t);
  await h.connect();
  const first = await h.hub.sync('user_a');
  const bytes = fs.readFileSync(h.cache('user_a'), 'utf8');
  h.clock += 60_000;
  h.records['/cycle'][0].score.strain = 20;
  h.hook = ({ url }) => url.pathname === '/developer/v2/activity/sleep' ? json({ error: 'access-secret-1 private provider diagnostics' }, 500) : undefined;
  await assert.rejects(h.hub.sync('user_a'), e => e.code === 'remote' && !e.message.includes('secret'));
  assert.equal(fs.readFileSync(h.cache('user_a'), 'utf8'), bytes);
  assert.deepEqual(h.hub.status('user_a').data, first.data);
  assert.equal(h.hub.status('user_a').connected, true);
  assert.match(h.hub.status('user_a').error, /unavailable/);
  h.clock += 60_000;
  h.hook = null;
  for (const key of Object.keys(h.records)) h.records[key] = [];
  const next = await h.hub.sync('user_a');
  assert.equal(next.error, null);
  assert.deepEqual(next.data.workouts, [], 'the completed window replaces removed/older provider records');
});

test('concurrent syncs and four expired-token collections perform exactly one refresh and persist rotation', async t => {
  const h = fixture(t);
  await h.connect();
  h.clock += 3600_001;
  const [a, b] = await Promise.all([h.hub.sync('user_a'), h.hub.sync('user_a')]);
  assert.deepEqual(a, b);
  assert.equal(h.tokenCount, 2, 'one original exchange, one refresh');
  const refreshes = h.calls.filter(c => c.body.get('grant_type') === 'refresh_token');
  assert.equal(refreshes.length, 1);
  assert.equal(refreshes[0].body.get('refresh_token'), 'refresh-secret-1');
  assert.equal(refreshes[0].body.get('scope'), 'offline', 'WHOOP must issue the replacement refresh token');
  const reads = h.calls.filter(c => c.url.searchParams.has('start'));
  assert.equal(reads.length, 4);
  assert.ok(reads.every(c => c.opts.headers.Authorization === 'Bearer access-secret-2'));
  h.hub = h.make();
  h.clock += 3600_001;
  await h.hub.sync('user_a');
  assert.equal(h.calls.filter(c => c.body.get('grant_type') === 'refresh_token').at(-1).body.get('refresh_token'), 'refresh-secret-2');
});

test('provider 401 retries with one rotated token; failed refresh retains cache and requests reconnect', async t => {
  const h = fixture(t);
  await h.connect();
  const first = await h.hub.sync('user_a');
  h.clock += 60_000;
  h.hook = ({ url, opts }) => url.searchParams.has('start') && opts.headers.Authorization === 'Bearer access-secret-1' ? json({}, 401) : undefined;
  await h.hub.sync('user_a');
  assert.equal(h.tokenCount, 2);
  h.clock += 3600_001;
  h.hook = ({ url }) => url.pathname === '/oauth/oauth2/token' ? json({ error: 'invalid_grant', error_description: 'refresh-secret-2' }, 400) : undefined;
  await assert.rejects(h.hub.sync('user_a'), { code: 'reconnect' });
  const status = h.hub.status('user_a');
  assert.equal(status.connected, false);
  assert.equal(status.data.workouts[0].id, first.data.workouts[0].id);
  assert.ok(!JSON.stringify(status).includes('refresh-secret'));
});

test('pagination cycles, oversized bodies and rate limits do not commit incomplete cache', async t => {
  const h = fixture(t, { limits: { responseBytes: 1500 } });
  await h.connect();
  await h.hub.sync('user_a');
  const before = fs.readFileSync(h.cache('user_a'), 'utf8');
  h.clock += 60_000;
  h.hook = ({ url }) => url.pathname === '/developer/v2/cycle' ? json({ records: [], next_token: 'repeated' }) : undefined;
  await assert.rejects(h.hub.sync('user_a'), { code: 'bounds' });
  h.clock += 60_000;
  h.hook = ({ url }) => url.pathname === '/developer/v2/cycle' ? json({ records: [], padding: 'x'.repeat(2000) }) : undefined;
  await assert.rejects(h.hub.sync('user_a'), { code: 'bounds' });
  h.clock += 60_000;
  h.hook = ({ url }) => url.pathname === '/developer/v2/cycle' ? json({}, 429, { 'Retry-After': '37' }) : undefined;
  await assert.rejects(h.hub.sync('user_a'), { code: 'rate', retryAfter: 37 });
  assert.equal(fs.readFileSync(h.cache('user_a'), 'utf8'), before);
});

test('disconnect revokes remotely, removes local secrets and cache, and leaves other users alone', async t => {
  const h = fixture(t);
  await h.connect(); await h.connect('user_b');
  await h.hub.sync('user_a'); await h.hub.sync('user_b');
  assert.deepEqual(await h.hub.disconnect('user_a'), { ok: true, revokeRequired: false });
  assert.equal(h.hub.status('user_a').connected, false);
  assert.equal(h.hub.status('user_a').data, null);
  assert.equal(fs.existsSync(h.file('user_a')), false);
  assert.equal(fs.existsSync(h.cache('user_a')), false);
  assert.equal(h.hub.status('user_b').connected, true);
  const revocation = h.calls.find(c => c.url.pathname.endsWith('/user/access'));
  assert.equal(revocation.opts.method, 'DELETE');
  h.hook = ({ url }) => url.pathname.endsWith('/user/access') ? json({}, 503) : undefined;
  assert.deepEqual(await h.hub.disconnect('user_b'), { ok: true, revokeRequired: true });
  assert.equal(fs.existsSync(h.file('user_b')), false);
  assert.equal(fs.existsSync(h.cache('user_b')), false);
});

test('an in-flight sync cannot recreate data after local account deletion', async t => {
  const h = fixture(t);
  await h.connect();
  const gate = deferred(), entered = deferred();
  h.hook = async ({ url }) => {
    if (url.pathname !== '/developer/v2/cycle') return;
    entered.resolve(); await gate.promise;
    return json({ records: records['/cycle'], next_token: null });
  };
  const syncing = h.hub.sync('user_a');
  await entered.promise;
  h.hub.removeUser('user_a');
  gate.resolve();
  await assert.rejects(syncing, { code: 'changed' });
  assert.equal(fs.existsSync(h.file('user_a')), false);
  assert.equal(fs.existsSync(h.cache('user_a')), false);
});

test('an in-flight authorization cannot restore a deleted account; switching accounts clears old summary', async t => {
  const h = fixture(t);
  await h.connect();
  await h.hub.sync('user_a');
  h.account = 202;
  await h.connect();
  assert.equal(h.hub.status('user_a').data, null);
  const gate = deferred(), entered = deferred();
  h.hook = async ({ url }) => {
    if (!url.pathname.endsWith('/user/profile/basic')) return;
    entered.resolve(); await gate.promise;
    return json({ user_id: 303 });
  };
  const start = h.hub.authorize('user_a');
  const connecting = h.hub.callback('user_a', { code: 'x', state: new URL(start.url).searchParams.get('state'), binding: start.binding });
  await entered.promise;
  h.hub.removeUser('user_a'); gate.resolve();
  await assert.rejects(connecting, { code: 'changed' });
  assert.equal(fs.existsSync(h.file('user_a')), false);
});
