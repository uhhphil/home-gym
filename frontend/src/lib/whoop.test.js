import { describe, expect, it, vi, afterEach } from 'vitest'
import { latestWhoop, whoopAuthorizationUrl, whoopExport } from './whoop.js'

const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}
afterEach(() => vi.useRealTimers())

describe('WHOOP authorization destination', () => {
  it('accepts only the official HTTPS authorization endpoint without credentials', () => {
    const valid = 'https://api.prod.whoop.com/oauth/oauth2/auth?client_id=fixture&state=test1234&scope=read%3Arecovery'
    expect(whoopAuthorizationUrl(valid)).toBe(valid)
    for (const input of [null, '', '/oauth/oauth2/auth', 'javascript:alert(1)', 'data:text/html,hello',
      'http://api.prod.whoop.com/oauth/oauth2/auth', 'https://api.prod.whoop.com.evil.test/oauth/oauth2/auth',
      'https://evil.test/oauth/oauth2/auth', 'https://api.prod.whoop.com:8443/oauth/oauth2/auth',
      'https://user@api.prod.whoop.com/oauth/oauth2/auth', 'https://user:secret@api.prod.whoop.com/oauth/oauth2/auth',
      'https://api.prod.whoop.com/oauth/oauth2/token', 'https://api.prod.whoop.com/oauth/oauth2/auth/']) {
      expect(whoopAuthorizationUrl(input), String(input)).toBeNull()
    }
  })
})

describe('latest linked observations', () => {
  it('uses the newest recovery and its linked sleep even when a newer unrelated sleep exists', () => {
    const data = freeze({
      recoveries: [
        { id: 'old', createdAt: '2026-11-06T08:00:00Z', sleepId: 'old-sleep' },
        { id: 'new', createdAt: '2026-11-07T08:00:00Z', sleepId: 'linked-sleep', score: null },
      ],
      sleeps: [
        { id: 'newer-unrelated', end: '2026-11-08T08:00:00Z', nap: false },
        { id: 'linked-sleep', end: '2026-11-07T08:00:00Z', nap: false },
      ],
      cycles: [{ id: 'older-cycle', start: '2026-11-06T08:00:00Z' }, { id: 'newer-cycle', start: '2026-11-07T08:00:00Z' }],
    })
    const before = JSON.stringify(data)
    expect(latestWhoop(data)).toEqual({ recovery: data.recoveries[1], sleep: data.sleeps[1], cycle: data.cycles[1] })
    expect(JSON.stringify(data)).toBe(before)
  })
  it('falls back to the newest non-nap sleep and tolerates absent observations', () => {
    expect(latestWhoop(null)).toEqual({ recovery: null, sleep: null, cycle: null })
    const data = freeze({ recoveries: [{ createdAt: '2026-11-07T08:00:00Z', sleepId: 'missing' }],
      sleeps: [{ id: 'nap', nap: true, end: '2026-11-08T13:00:00Z' },
        { id: 'night', nap: false, end: '2026-11-08T08:00:00Z' },
        { id: 'older', nap: false, end: '2026-11-07T08:00:00Z' }] })
    expect(latestWhoop(data).sleep.id).toBe('night')
  })
})

describe('WHOOP export', () => {
  it('retains provider IDs and links without creating or mutating workout records', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-08T12:00:00Z'))
    const data = freeze({ accountId: '10129',
      workouts: [{ id: 'ecfc6a15-4661-442f-a9a4-f160dd7afae8', sport: 'running', averageHeartRate: null }],
      sleeps: [{ id: 'e5fca452-701f-4a14-978d-19e0cab7dc68', cycleId: '93845' }],
      recoveries: [{ id: '93845', sleepId: 'e5fca452-701f-4a14-978d-19e0cab7dc68', score: null }], cycles: [] })
    const before = JSON.stringify(data), result = JSON.parse(whoopExport(data))
    expect(result).toEqual({ version: 1, source: 'WHOOP', exportedAt: '2026-11-08T12:00:00.000Z', data })
    expect(result.data.workouts[0].id).toBe(data.workouts[0].id)
    expect(JSON.stringify(data)).toBe(before)
    expect(whoopExport(null)).toBeNull()
    expect(whoopExport({ workouts: [] })).toBeNull()
    expect(whoopExport({ accountId: 10129 })).toBeNull()
  })
})
