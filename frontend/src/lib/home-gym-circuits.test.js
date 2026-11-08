import { describe, expect, it } from 'vitest'
import { appendHomeGymCircuit, buildHomeGymCircuit, circuitDurationSeconds } from './home-gym-circuits.js'
import { buildPlannedEntry, buildSessionEntries } from './session-start.js'
import { nextAutoHold } from './auto-holds.js'
import { restSecFor, supersetFlowStep } from './supersetFlow.js'
import { entryExcluded, isBw, supersetUnits } from './history.js'

const options = { id: 'test', name: 'My circuit', exerciseIds: ['0549', '0534', '0662'], rounds: 3, workSec: 30, restSec: 60 }
const state = () => ({ workouts: [], exWeights: {}, routines: [], unit: 'kg', startFrom: 'plan' })

describe('home gym circuit routines', () => {
  it('uses existing stable exercise IDs and does not alter earlier workouts', () => {
    const S = state()
    S.workouts = [{ id: 'old', entries: [{ id: '0549', sets: [{ r: 12, w: 16, done: true }] }] }]
    const before = structuredClone(S.workouts)
    const routine = buildHomeGymCircuit({ ...options, exerciseIds: ['0549', '0534', '0549'], weight: 16 })
    expect(routine.ex.map(e => e.id)).toEqual(['0549', '0534'])
    expect(appendHomeGymCircuit(S, routine)).toBe(true)
    expect(appendHomeGymCircuit(S, routine)).toBe(false)
    expect(S.routines).toHaveLength(1)
    expect(S.workouts).toEqual(before)
  })

  it('runs every station round by round through existing timed holds and rests', () => {
    const routine = buildHomeGymCircuit(options)
    const S = state()
    const entries = routine.ex.map(cfg => ({ id: cfg.id, sg: cfg.sg, ...buildPlannedEntry(S, cfg, routine) }))
    S.active = { id: 'session', cur: 0, entries }
    const timed = idx => entries[idx].target.mode === 'time'
    const unit = supersetUnits(entries)[0]
    expect(unit).toEqual([0, 1, 2])
    const visited = []
    for (let n = 0; n < 9; n++) {
      const hold = nextAutoHold(S, timed)
      expect(hold.plan).toBe(30)
      visited.push([hold.id, hold.i])
      entries[hold.idx].sets[hold.i].done = true
      const step = supersetFlowStep(entries, unit, hold.idx)
      if (step.nextIdx !== null) S.active.cur = step.nextIdx
      expect(step.roundDone).toBe(n === 2 || n === 5)
    }
    expect(visited.map(([id]) => id)).toEqual(['0549', '0534', '0662', '0549', '0534', '0662', '0549', '0534', '0662'])
    expect(nextAutoHold(S, timed)).toBeNull()
    expect(restSecFor(entries, unit, 90)).toBe(60)
    expect(circuitDurationSeconds({ stations: 3, rounds: 3, workSec: 30, restSec: 60 })).toBe(417)
  })

  it('allows no rest without inheriting the global rest timer', () => {
    const routine = buildHomeGymCircuit({ ...options, restSec: 0 })
    const entries = routine.ex.map(cfg => ({ target: cfg }))
    expect(restSecFor(entries, [0, 1, 2], 90)).toBe(0)
    expect(routine.ex.every(cfg => cfg.warmup === 'none')).toBe(true)
  })

  it('keeps circuit times and loads with previous timed history and global settings enabled', () => {
    const routine = buildHomeGymCircuit({ ...options, weight: 16 })
    const S = {
      ...state(), startFrom: 'last', lastFrom: 'any', autoHolds: false,
      warmupAuto: 'all', progDefault: 'triple', volumeBodyweight: true,
      bodyweight: [{ d: '2026-11-07', w: 80 }],
      dbLoad: { '0549': { mode: 'each' } }, exUnit: { '0549': { unit: 'lb' } },
      routines: [routine], workouts: [{
        id: 'previous', d: '2026-11-07', start: 1000, end: 2000, routineId: 'other',
        entries: ['0549', '0534', '0662'].map(id => ({
          id, target: { mode: 'time', sets: 1, sec: 90, weight: 32 },
          sets: [{ sec: 20, w: 8, done: true, warmup: true, phase: 'warmup', edited: true }, { sec: 90, w: 32, done: true }],
        })),
      }],
    }
    const before = structuredClone(S)
    const entries = buildSessionEntries(S, routine)
    for (const entry of entries) {
      expect(entry.target.sec).toBe(30)
      expect(entry.sets).toHaveLength(3)
      expect(entry.sets.every(row => row.sec === 30 && !row.warmup && !row.done)).toBe(true)
      expect(entryExcluded({}, entry)).toBe(false)
      expect(entry.noProg).toBeUndefined()
      for (const row of entry.sets) expect(row.w).toBeCloseTo(entry.id === '0662' ? 0 : 16, 3)
    }
    expect(isBw(entries[2].target)).toBe(true)
    expect(entries[0].target.dbLoad).toBe('each')
    expect(S).toEqual(before)
    S.active = { id: 'new', entries, cur: 0 }
    expect(nextAutoHold(S, idx => entries[idx].target.mode === 'time').plan).toBe(30)
  })

  it('inherits the global start preference when a routine has no valid override', () => {
    const S = { ...state(), startFrom: 'last', workouts: [{
      id: 'previous', d: '2026-11-07', entries: [{ id: '0549', target: { mode: 'time' }, sets: [{ sec: 90, w: 32, done: true }] }],
    }] }
    const original = buildHomeGymCircuit(options)
    for (const startFrom of [undefined, 'invalid', null]) {
      const routine = { ...original, startFrom }
      const entry = buildSessionEntries(S, routine)[0]
      expect(entry.sets[0]).toMatchObject({ sec: 90, w: 32 })
    }
    const routine = { ...original, startFrom: 'last' }
    const entry = buildSessionEntries({ ...S, startFrom: 'plan' }, routine)[0]
    expect(entry.sets[0]).toMatchObject({ sec: 90, w: 32 })
  })

  it('rejects malformed routines rather than guessing or creating empty workouts', () => {
    for (const change of [{ exerciseIds: ['0549'] }, { exerciseIds: ['0549', 'missing'] }, { rounds: 0 }, { rounds: 1.5 }, { workSec: NaN }, { restSec: -1 }, { restSec: 601 }, { name: '' }, { weight: Infinity }]) {
      expect(buildHomeGymCircuit({ ...options, ...change })).toBeNull()
    }
  })
})
