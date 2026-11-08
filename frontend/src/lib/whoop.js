// WHOOP observations are read-only provider records. They do not become duplicate
// lifting sessions, nor are summary heart rates turned into per-set measurements.
const at = value => Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0
const newest = (rows, key) => [...(rows || [])].sort((a, b) => at(b[key]) - at(a[key]))[0] || null

export function latestWhoop(data) {
  const recovery = newest(data?.recoveries, 'createdAt')
  const sleep = (data?.sleeps || []).find(s => s.id === recovery?.sleepId)
    || newest((data?.sleeps || []).filter(s => !s.nap), 'end')
  return { recovery, sleep, cycle: newest(data?.cycles, 'start') }
}

export function whoopAuthorizationUrl(raw) {
  try {
    const url = new URL(raw)
    return url.origin === 'https://api.prod.whoop.com' && url.pathname === '/oauth/oauth2/auth'
      && !url.username && !url.password ? url.href : null
  } catch { return null }
}

export function whoopExport(data) {
  if (!data || typeof data.accountId !== 'string') return null
  return JSON.stringify({ version: 1, source: 'WHOOP', exportedAt: new Date().toISOString(), data }, null, 2)
}
