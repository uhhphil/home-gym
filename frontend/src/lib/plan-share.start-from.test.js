import { describe, expect, it } from 'vitest'
import { buildPlanBundle, mergePlan, parsePlan } from './plan-share.js'

const sourceWith = extra => ({
  unit: 'lb', week: {}, customEx: [],
  routines: [{ id: 'circuit-source', name: 'Timed circuit', ...extra, ex: [
    { id: '0549', sets: 3, mode: 'time', sec: 30, weight: 20, prog: 'off', autoHold: true, sg: 'circuit', sgRest: 60 },
    { id: '0534', sets: 3, mode: 'time', sec: 30, weight: 20, prog: 'off', autoHold: true, sg: 'circuit', sgRest: 60 },
  ] }],
})
const destination = () => ({ unit: 'lb', startFrom: 'last', routines: [], customEx: [], week: {} })

describe('shared routine starting prescriptions', () => {
  it.each(['plan', 'last'])('preserves %s through export, parse and merge without changing the profile', startFrom => {
    const source = sourceWith({ startFrom })
    const exported = buildPlanBundle(source, 'Circuit plan')
    const parsed = parsePlan(JSON.stringify(exported), 'lb')
    const target = destination()
    mergePlan(target, parsed)
    expect(exported.routines[0].startFrom).toBe(startFrom)
    expect(parsed.routines[0].startFrom).toBe(startFrom)
    expect(target.routines[0].startFrom).toBe(startFrom)
    expect(target.routines[0].id).not.toBe(source.routines[0].id)
    expect(target.routines[0].ex.map(e => e.id)).toEqual(['0549', '0534'])
    expect(target.routines[0].ex[0]).toMatchObject({ sec: 30, autoHold: true, sg: 'circuit', sgRest: 60 })
    expect(target.startFrom).toBe('last')
  })

  it('keeps legacy routines without an override following the destination profile', () => {
    const exported = buildPlanBundle(sourceWith({}), 'Legacy')
    const parsed = parsePlan(exported, 'lb')
    const target = destination()
    mergePlan(target, parsed)
    expect(exported.routines[0]).not.toHaveProperty('startFrom')
    expect(parsed.routines[0]).not.toHaveProperty('startFrom')
    expect(target.routines[0]).not.toHaveProperty('startFrom')
    expect(target.startFrom).toBe('last')
  })

  it.each([null, true, 1, 'PLAN', ' plan ', '', ['plan'], { value: 'plan' }])('ignores an invalid override at every entry point: %j', value => {
    expect(buildPlanBundle(sourceWith({ startFrom: value }), 'Invalid').routines[0]).not.toHaveProperty('startFrom')
    const raw = { ...buildPlanBundle(sourceWith({}), 'Hand-edited'), routines: sourceWith({ startFrom: value }).routines }
    expect(parsePlan(raw, 'lb').routines[0]).not.toHaveProperty('startFrom')
    const target = destination()
    // mergePlan can be called with an already-parsed bundle, so it also validates independently.
    mergePlan(target, raw)
    expect(target.routines[0]).not.toHaveProperty('startFrom')
  })

  it.each([true, false])('preserves an explicit timed auto-hold choice: %s', autoHold => {
    const source = sourceWith({ startFrom: 'plan' })
    source.routines[0].ex[0].autoHold = autoHold
    const target = destination()
    mergePlan(target, parsePlan(buildPlanBundle(source, 'Circuit plan'), 'lb'))
    expect(target.routines[0].ex[0].autoHold).toBe(autoHold)
  })

  it('drops invalid and non-timed auto-hold choices on all entry paths', () => {
    for (const extra of [{ autoHold: 'true' }, { autoHold: 1 }, { autoHold: null }, { mode: 'reps', autoHold: true }, { mode: 'cardio', autoHold: false }]) {
      const source = sourceWith({})
      Object.assign(source.routines[0].ex[0], extra)
      expect(buildPlanBundle(source, 'Invalid').routines[0].ex[0]).not.toHaveProperty('autoHold')
      const raw = { opengym_plan: 1, ...source }
      expect(parsePlan(raw, 'lb').routines[0].ex[0]).not.toHaveProperty('autoHold')
      const target = destination()
      mergePlan(target, raw)
      expect(target.routines[0].ex[0]).not.toHaveProperty('autoHold')
    }
  })
})
