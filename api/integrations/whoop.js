// WHOOP's account API is a server-side, read-only integration. Its summaries are not gym
// workouts: keep them out of profile state, workout totals, the offline queue and HealthKit.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { atomicWrite, syncDir } from '../durable.js';
import { deriveKey } from './crypto.js';
import { createStore } from './store.js';
import { createBuckets } from './outbox.js';

const AUTH = 'https://api.prod.whoop.com/oauth/oauth2/auth';
const TOKEN = 'https://api.prod.whoop.com/oauth/oauth2/token';
const API = 'https://api.prod.whoop.com/developer/v2';
export const WHOOP_SCOPES = ['read:profile', 'read:recovery', 'read:cycles', 'read:sleep', 'read:workout', 'offline'];
export const WHOOP_LIMITS = { stateMs: 10 * 60_000, requestMs: 15_000, syncMs: 90_000, pages: 20, records: 500, responseBytes: 1024 * 1024, cacheBytes: 2 * 1024 * 1024 };
const CONN = 'whoop';
const MESSAGES = {
  off: 'WHOOP is not configured on this server.',
  missing: 'Connect your WHOOP account first.',
  state: 'This WHOOP sign-in has expired or is not from this browser. Try connecting again.',
  reconnect: 'Reconnect your WHOOP account to continue.',
  remote: 'WHOOP is unavailable. Try syncing again later.',
  rate: 'WHOOP requests are limited. Try again later.',
  invalid: 'WHOOP returned an incomplete response. Your saved summary was kept.',
  bounds: 'The WHOOP response exceeded the sync limit. Your saved summary was kept.',
  changed: 'The WHOOP connection changed. Try again.',
  storage: 'The WHOOP connection could not be saved. Try again.',
};
export class WhoopError extends Error {
  constructor(code, status = 502, retryAfter) {
    super(MESSAGES[code] || MESSAGES.remote);
    this.code = code; this.status = status;
    if (retryAfter) this.retryAfter = retryAfter;
  }
}
const fail = (code, status, retryAfter) => { throw new WhoopError(code, status, retryAfter); };
const safeError = e => e instanceof WhoopError ? e : new WhoopError('remote');
const object = v => !!v && typeof v === 'object' && !Array.isArray(v);
const number = v => Number.isFinite(v) && v >= 0 ? v : null;
const time = v => typeof v === 'string' && v.length <= 50 && Number.isFinite(Date.parse(v)) ? v : null;
const ident = v => (typeof v === 'string' && v.length > 0 && v.length <= 128) || (Number.isSafeInteger(v) && v >= 0) ? v : null;
const string = v => typeof v === 'string' && v.length <= 150 ? v.replace(/[\u0000-\u001f\u007f]/g, '') : null;
const userKey = uid => {
  if (typeof uid !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(uid)) fail('missing', 401);
  return uid;
};

function configuration(env) {
  const clientId = env.WHOOP_CLIENT_ID?.trim();
  const clientSecret = env.WHOOP_CLIENT_SECRET?.trim();
  const redirectUri = env.WHOOP_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) return null;
  try {
    const u = new URL(redirectUri);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
    if ((u.protocol !== 'https:' && !(local && u.protocol === 'http:')) || u.username || u.password || u.hash || u.search || u.pathname !== '/api/whoop/callback') return null;
    if (env.ORIGIN && new URL(env.ORIGIN).origin !== u.origin) return null;
    return { clientId, clientSecret, redirectUri, secure: u.protocol === 'https:' };
  } catch { return null; }
}

/** Retain original resource IDs. WHOOP recovery has no id: its sleep_id is its identity. */
export function projectWhoop(type, r) {
  if (!object(r)) fail('invalid');
  const id = ident(type === 'recoveries' ? r.sleep_id : r.id);
  if (id === null) fail('invalid');
  const scoreState = ['SCORED', 'PENDING_SCORE', 'UNSCORABLE'].includes(r.score_state) ? r.score_state : null;
  const score = scoreState === 'SCORED' && object(r.score) ? r.score : {};
  const base = { id, updatedAt: time(r.updated_at), scoreState };
  if (type === 'recoveries') return {
    ...base, cycleId: ident(r.cycle_id), sleepId: ident(r.sleep_id), createdAt: time(r.created_at),
    score: number(score.recovery_score), hrv: number(score.hrv_rmssd_milli), restingHeartRate: number(score.resting_heart_rate),
  };
  const timed = { ...base, start: time(r.start), end: time(r.end) };
  if (!timed.start) fail('invalid');
  if (type === 'cycles') return { ...timed, strain: number(score.strain), averageHeartRate: number(score.average_heart_rate), stepCount: number(r.step_count) };
  if (type === 'sleeps') {
    const stages = score.stage_summary;
    const parts = ['total_light_sleep_time_milli', 'total_slow_wave_sleep_time_milli', 'total_rem_sleep_time_milli'].map(k => number(stages?.[k]));
    return { ...timed, nap: typeof r.nap === 'boolean' ? r.nap : null, performance: number(score.sleep_performance_percentage), sleepMs: parts.every(n => n !== null) ? parts.reduce((a, b) => a + b, 0) : null };
  }
  if (type !== 'workouts') fail('invalid');
  return {
    ...timed, sport: string(r.sport_name), strain: number(score.strain), averageHeartRate: number(score.average_heart_rate),
    maxHeartRate: number(score.max_heart_rate), distanceMeters: number(score.distance_meter), kilojoules: number(score.kilojoule),
  };
}

export function createWhoop({ dataDir, secret, env = process.env, now = Date.now, transport = globalThis.fetch, limits = {} }) {
  const cfg = configuration(env);
  const bounds = { ...WHOOP_LIMITS, ...limits };
  const dir = path.join(dataDir, 'integrations', 'whoop');
  let store;
  const ensure = () => store ||= createStore({ dir, key: deriveKey(secret), now });
  const existing = uid => (store || fs.existsSync(dir)) ? ensure().get(userKey(uid), CONN) : null;
  const cacheFile = uid => path.join(dir, 'summary-' + userKey(uid) + '.json');
  const pending = new Map(), epochs = new Map(), refreshes = new Map(), syncs = new Map();
  const buckets = createBuckets({ now });
  const epoch = uid => epochs.get(uid) || 0;
  const check = (uid, generation) => { if (epoch(uid) !== generation) fail('changed', 409); };
  const enabled = () => { if (!cfg) fail('off', 503); };
  const limit = (uid, action) => {
    const wait = buckets.take(`${action}:${uid}`, action === 'sync' ? { capacity: 2, refillMs: 60_000 } : { capacity: 5, refillMs: 60_000 });
    if (wait) fail('rate', 429, Math.ceil(wait / 1000));
  };
  const forgetStates = uid => { for (const [k, p] of pending) if (p.uid === uid || p.expires <= now()) pending.delete(k); };
  const clearCache = uid => { try { fs.unlinkSync(cacheFile(uid)); syncDir(dir); } catch (e) { if (e.code !== 'ENOENT') fail('storage', 500); } };
  const saved = uid => {
    try {
      const f = cacheFile(uid);
      if (fs.statSync(f).size > bounds.cacheBytes) fail('bounds');
      const data = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (!object(data) || typeof data.accountId !== 'string' || !Number.isFinite(data.syncedAt) || !['cycles', 'sleeps', 'recoveries', 'workouts'].every(k => Array.isArray(data[k]) && data[k].length <= bounds.records)) fail('invalid');
      return data;
    } catch (e) { if (e.code === 'ENOENT') return null; throw safeError(e); }
  };

  function status(uid) {
    userKey(uid);
    const rec = existing(uid);
    let error = rec?.lastError?.msg || null, data = null;
    if (rec) {
      try { data = saved(uid); } catch { error = 'The saved WHOOP summary could not be read. Sync again to replace it.'; }
      if (data && data.accountId !== rec.info.accountId) { data = null; error = MESSAGES.reconnect; }
    }
    const readable = rec && ensure().reveal(uid, rec, 'accessToken') && ensure().reveal(uid, rec, 'refreshToken');
    if (rec && !readable) error = MESSAGES.reconnect;
    return { configured: !!cfg, connected: !!readable && rec.status !== 'attention', lastSync: data?.syncedAt ?? null, error, data };
  }

  async function request(url, options = {}, signal) {
    // All callers supply constants or paths assembled below; redirects must never forward a token.
    const timed = AbortSignal.timeout(bounds.requestMs);
    const combined = signal ? AbortSignal.any([timed, signal]) : timed;
    let response;
    try {
      response = await transport(url, { ...options, redirect: 'error', signal: combined });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        if (response.status === 401 || (url === TOKEN && response.status === 400)) fail('reconnect', 401);
        if (response.status === 429) {
          const retry = Number(response.headers.get('retry-after'));
          fail('rate', 429, Number.isFinite(retry) && retry > 0 ? Math.min(Math.ceil(retry), 86400) : 60);
        }
        fail('remote');
      }
      if (response.status === 204) return null;
      if (Number(response.headers.get('content-length')) > bounds.responseBytes) { await response.body?.cancel(); fail('bounds'); }
      let size = 0;
      const chunks = [];
      if (!response.body) fail('invalid');
      for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > bounds.responseBytes) fail('bounds');
        chunks.push(Buffer.from(chunk));
      }
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!object(value)) fail('invalid');
      return value;
    } catch (e) { throw safeError(e); }
  }

  async function exchange(fields, signal) {
    const token = await request(TOKEN, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, ...fields }).toString(),
    }, signal);
    const valid = v => typeof v === 'string' && v.length > 0 && v.length <= 2000 && !/[\r\n]/.test(v);
    if (!valid(token.access_token) || !valid(token.refresh_token) || !Number.isFinite(token.expires_in) || token.expires_in <= 0 || token.expires_in > 366 * 86400 || (token.token_type && token.token_type.toLowerCase() !== 'bearer')) fail('invalid');
    return { access: token.access_token, refresh: token.refresh_token, expires: now() + token.expires_in * 1000 };
  }
  const tokenFields = (uid, token) => ({
    accessToken: ensure().seal(uid, CONN, 'accessToken', token.access),
    refreshToken: ensure().seal(uid, CONN, 'refreshToken', token.refresh),
  });
  const write = (uid, fn) => {
    try { return fn(); }
    catch { ensure().forget(uid); fail('storage', 500); }
  };

  async function access(uid, generation, signal, rejectedToken = null) {
    check(uid, generation);
    const rec = existing(uid);
    if (!rec || rec.status === 'attention') fail('missing', 409);
    const token = ensure().reveal(uid, rec, 'accessToken');
    if (!token) fail('reconnect', 401);
    // Another request may already have replaced a rejected token while this one was in flight.
    if ((rejectedToken && token !== rejectedToken) || (!rejectedToken && Number(rec.info.expiresAt) > now() + 60_000)) return token;
    if (refreshes.has(uid)) return refreshes.get(uid);
    const run = (async () => {
      const refresh = ensure().reveal(uid, rec, 'refreshToken');
      if (!refresh) fail('reconnect', 401);
      const next = await exchange({ grant_type: 'refresh_token', refresh_token: refresh, scope: 'offline' }, signal);
      check(uid, generation);
      write(uid, () => ensure().update(uid, CONN, r => {
        r.secrets = tokenFields(uid, next); r.info.expiresAt = String(next.expires);
      }));
      return next.access;
    })();
    refreshes.set(uid, run);
    try { return await run; } finally { if (refreshes.get(uid) === run) refreshes.delete(uid); }
  }

  async function get(uid, generation, route, signal) {
    let token = await access(uid, generation, signal);
    try { return await request(API + route, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }, signal); }
    catch (e) {
      if (e.code !== 'reconnect') throw e;
      token = await access(uid, generation, signal, token);
      return request(API + route, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }, signal);
    }
  }

  function authorize(uid) {
    userKey(uid); enabled(); limit(uid, 'authorize'); forgetStates(uid);
    // Starting a replacement authorization also invalidates an older exchange still in flight.
    epochs.set(uid, epoch(uid) + 1);
    while (pending.size >= 1000) pending.delete(pending.keys().next().value);
    let state;
    do { state = crypto.randomBytes(6).toString('base64url'); } while (pending.has(state));
    const binding = crypto.randomBytes(32).toString('base64url');
    pending.set(state, { uid, binding, expires: now() + bounds.stateMs, generation: epoch(uid) });
    const url = new URL(AUTH);
    url.search = new URLSearchParams({ client_id: cfg.clientId, redirect_uri: cfg.redirectUri, response_type: 'code', scope: WHOOP_SCOPES.join(' '), state }).toString();
    return { url: url.toString(), binding };
  }

  async function callback(uid, { state, code, binding, error }) {
    userKey(uid); enabled();
    const p = typeof state === 'string' && state.length === 8 ? pending.get(state) : null;
    // A different profile/browser cannot consume the owner's pending authorization.
    if (!p || p.uid !== uid || typeof binding !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(binding) || !crypto.timingSafeEqual(Buffer.from(binding), Buffer.from(p.binding)) || p.expires <= now()) fail('state', 400);
    pending.delete(state);
    check(uid, p.generation);
    if (error || typeof code !== 'string' || !code || code.length > 2048) fail('state', 400);
    const signal = AbortSignal.timeout(bounds.syncMs);
    const token = await exchange({ grant_type: 'authorization_code', code, redirect_uri: cfg.redirectUri }, signal);
    const profile = await request(API + '/user/profile/basic', { headers: { Authorization: `Bearer ${token.access}`, Accept: 'application/json' } }, signal);
    check(uid, p.generation);
    if (ident(profile.user_id) === null) fail('invalid');
    const accountId = String(profile.user_id);
    const old = existing(uid);
    if (old?.info.accountId !== accountId) clearCache(uid);
    epochs.set(uid, epoch(uid) + 1); // A sync begun during authorization cannot publish the old account.
    write(uid, () => {
      const patch = r => { r.secrets = tokenFields(uid, token); r.info = { accountId, expiresAt: String(token.expires) }; r.status = 'ok'; r.lastError = null; };
      if (old) ensure().update(uid, CONN, patch);
      else { const rec = { id: CONN, provider: 'whoop', label: 'WHOOP', events: [] }; patch(rec); ensure().add(uid, rec); }
    });
  }

  async function collection(uid, generation, type, route, start, end, signal) {
    const found = new Map(), cursors = new Set();
    let cursor = null, count = 0;
    for (let page = 0; page < bounds.pages; page++) {
      check(uid, generation);
      const query = new URLSearchParams({ start, end, limit: '25' });
      if (cursor) query.set('nextToken', cursor);
      const result = await get(uid, generation, route + '?' + query, signal);
      if (!Array.isArray(result.records)) fail('invalid');
      count += result.records.length;
      if (count > bounds.records) fail('bounds');
      for (const r of result.records) {
        const value = projectWhoop(type, r);
        const old = found.get(value.id);
        if (!old || (Date.parse(value.updatedAt) || 0) >= (Date.parse(old.updatedAt) || 0)) found.set(value.id, value);
      }
      cursor = result.next_token;
      if (cursor == null || cursor === '') return [...found.values()];
      if (typeof cursor !== 'string' || cursor.length > 2048 || cursors.has(cursor)) fail('bounds');
      cursors.add(cursor);
    }
    fail('bounds');
  }

  function sync(uid) {
    userKey(uid); enabled();
    if (syncs.has(uid)) return syncs.get(uid);
    limit(uid, 'sync');
    const generation = epoch(uid);
    const run = (async () => {
      try {
        if (!existing(uid)) fail('missing', 409);
        const controller = new AbortController();
        const signal = AbortSignal.any([AbortSignal.timeout(bounds.syncMs), controller.signal]);
        const end = new Date(now()).toISOString(), start = new Date(now() - 30 * 86400_000).toISOString();
        const pairs = [['cycles', '/cycle'], ['sleeps', '/activity/sleep'], ['recoveries', '/recovery'], ['workouts', '/activity/workout']];
        let firstError;
        const results = await Promise.allSettled(pairs.map(([type, route]) =>
          collection(uid, generation, type, route, start, end, signal).catch(e => {
            if (!firstError) firstError = e;
            controller.abort();
            throw e;
          })
        ));
        if (firstError) throw firstError;
        const values = results.map(r => r.value);
        check(uid, generation);
        const rec = existing(uid);
        if (!rec) fail('changed', 409);
        const snapshot = { syncedAt: now(), accountId: rec.info.accountId, ...Object.fromEntries(pairs.map(([type], i) => [type, values[i]])) };
        const text = JSON.stringify(snapshot);
        if (Buffer.byteLength(text) > bounds.cacheBytes) fail('bounds');
        write(uid, () => atomicWrite(cacheFile(uid), text, 0o600));
        write(uid, () => ensure().update(uid, CONN, r => { r.status = 'ok'; r.lastError = null; r.lastOk = snapshot.syncedAt; }));
        return status(uid);
      } catch (error) {
        const e = safeError(error);
        if (epoch(uid) === generation && existing(uid)) write(uid, () => ensure().update(uid, CONN, r => {
          r.lastError = { at: now(), msg: e.message, code: e.code };
          if (e.code === 'reconnect') r.status = 'attention';
        }));
        throw e;
      }
    })();
    syncs.set(uid, run);
    run.finally(() => { if (syncs.get(uid) === run) syncs.delete(uid); }).catch(() => {});
    return run;
  }

  function removeUser(uid) {
    userKey(uid);
    epochs.set(uid, epoch(uid) + 1); forgetStates(uid);
    refreshes.delete(uid); syncs.delete(uid);
    if (store || fs.existsSync(dir)) {
      // createStore.removeUser ignores unlink errors; explicitly verify deletion for this path.
      ensure().removeUser(uid);
      if (fs.existsSync(path.join(dir, 'u-' + uid + '.json'))) fail('storage', 500);
      syncDir(dir);
      clearCache(uid);
    }
  }

  async function disconnect(uid) {
    const rec = existing(uid);
    const token = rec && ensure().reveal(uid, rec, 'accessToken');
    removeUser(uid); // Stop pending sync/callback writes before awaiting the network.
    let revokeRequired = !!rec;
    if (token) {
      try { await request(API + '/user/access', { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }); revokeRequired = false; }
      catch { /* Local deletion still succeeds; the app explains how to revoke in WHOOP. */ }
    }
    return { ok: true, revokeRequired };
  }

  return { configured: !!cfg, secureCookie: !!cfg?.secure, stateMs: bounds.stateMs, status, authorize, callback, sync, disconnect, removeUser };
}
