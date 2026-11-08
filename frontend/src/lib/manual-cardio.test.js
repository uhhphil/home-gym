import { describe, expect, it } from 'vitest'
import { appendManualCardio, buildManualCardio, cardioMetrics, distanceFromKm, formatPace, walkRunHistory } from './manual-cardio.js'
import { mergeStates } from './sync-merge.js'
import { EXIDX } from './exercises.js'

const end = new Date('2026-11-08T15:00:00Z').getTime()
const input = { id: 'walk-unique', kind: 'walk', minutes: 30, distance: 2, unit: 'mi', end, now: end }
const state = workouts => ({ unit: 'lb', workouts, routines: [], customEx: [], bodyweight: [], _ts: end })

describe('manual walking and running', () => {
  it('keeps existing exercise IDs and canonical units through JSON backup', () => {
    const w = buildManualCardio(input)
    expect(EXIDX[w.entries[0].id].n).toBe('walking')
    expect(w.end - w.start).toBe(30 * 60000)
    expect(w.entries[0].sets[0].speed).toBeCloseTo(6.437376, 8)
    const [saved] = walkRunHistory(JSON.parse(JSON.stringify(state([w]))))
    expect(distanceFromKm(saved.km, 'mi')).toBeCloseTo(2, 10)
    expect(formatPace(saved.min * 60 / distanceFromKm(saved.km, 'mi'))).toBe('15:00')
  })

  it('rejects empty, negative, nonfinite, unsupported and future input', () => {
    for (const bad of [{ minutes: '' }, { distance: -1 }, { minutes: Infinity }, { unit: 'feet' }, { kind: 'bike' }, { end: NaN }, { end: end + 1 }, { minutes: 1e20 }]) {
      expect(buildManualCardio({ ...input, ...bad })).toBeNull()
    }
    expect(cardioMetrics(0, 2)).toBeNull()
    expect(formatPace(599.6)).toBe('10:00')
  })

  it('is idempotent on a retry and preserves a lifting session in progress', () => {
    const active = { id: 'lifting-in-progress' }
    const S = { ...state([]), active }
    const w = buildManualCardio(input)
    expect(appendManualCardio(S, w)).toBe(true)
    expect(appendManualCardio(S, w)).toBe(false)
    expect(S.workouts).toHaveLength(1)
    expect(S.active).toBe(active)
  })

  it('keeps independent offline activities once through repeated two-device merges', () => {
    const a = buildManualCardio(input)
    const b = buildManualCardio({ ...input, id: 'run-unique', kind: 'run' })
    const merged = mergeStates(state([a]), state([b]))
    const retried = mergeStates(merged, state([a]))
    expect(retried.workouts.map(w => w.id).sort()).toEqual(['run-unique', 'walk-unique'])
    expect(walkRunHistory(retried)).toHaveLength(2)
  })

  it('reflects later workout edits and excludes incomplete and unrelated sets', () => {
    const w = buildManualCardio(input)
    w.entries[0].sets[0].min = 60
    w.entries[0].sets.push({ min: 50, speed: 30, done: false })
    w.entries.push({ id: '0025', sets: [{ min: 50, speed: 30, done: true }] })
    const [row] = walkRunHistory(state([w]))
    expect(row.min).toBe(60)
    expect(distanceFromKm(row.km, 'mi')).toBeCloseTo(4, 10)
  })

  it('uses the shared warm-up classification including explicit work overrides', () => {
    const w = buildManualCardio(input)
    w.entries[0].sets[0].phase = 'work'
    w.entries[0].sets[0].warmup = true
    w.entries[0].sets.push({ min: 20, speed: 10, done: true, phase: 'warm-up' })
    expect(walkRunHistory(state([w]))[0].min).toBe(30)
  })
})
