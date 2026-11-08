// Manual walks/runs are ordinary openGym workouts. Canonical km/h and minutes keep
// existing history, export, edits and revision-based sync working without a second log.
import { KMH_PER_MPH, speedUnitOf } from './speed.js'
import { buildCompletedWorkout } from './finish-workout.js'
import { canonicalExId } from './exercises.js'
import { isoOf } from './format.js'
import { isWarmupRow } from './workout-model.js'

export const WALK_RUN_IDS = { walk: '2258', run: '0685' }
export const distanceUnitOf = S => speedUnitOf(S) === 'mph' ? 'mi' : 'km'
export const distanceFromKm = (km, unit) => unit === 'mi' ? km / KMH_PER_MPH : km
export const distanceToKm = (distance, unit) => unit === 'mi' ? distance * KMH_PER_MPH : distance

export function cardioMetrics(minutes, distance, unit = 'km') {
  const min = Number(minutes), dist = Number(distance)
  if (!['km', 'mi'].includes(unit) || !Number.isFinite(min) || !Number.isFinite(dist) || min <= 0 || dist <= 0) return null
  const km = distanceToKm(dist, unit)
  const speed = km * 60 / min
  if (!Number.isFinite(speed) || !Number.isFinite(km)) return null
  return { min, km, speed, paceSeconds: min * 60 / dist }
}

export function formatPace(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '–'
  const whole = Math.round(seconds)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

export function buildManualCardio({ id, kind, minutes, distance, unit, end, note = '', now = Date.now() }) {
  const metrics = cardioMetrics(minutes, distance, unit)
  if (!id || !Object.hasOwn(WALK_RUN_IDS, kind) || !metrics || !Number.isFinite(end) || end > now) return null
  const start = end - metrics.min * 60000
  if (start < 0 || !Number.isFinite(start)) return null
  const active = {
    id, d: isoOf(new Date(start)), start,
    name: kind === 'walk' ? 'Walk' : 'Run', note: String(note).trim(),
    entries: [{
      id: WALK_RUN_IDS[kind],
      target: { mode: 'cardio', sets: 1, min: metrics.min, speed: metrics.speed },
      sets: [{ min: metrics.min, speed: metrics.speed, done: true, at: end }],
    }],
  }
  return { ...buildCompletedWorkout(active, { end }), vol: 0 }
}

// A retry with the same sheet/session ID is a no-op. Never replace an existing
// workout or the active lifting session while adding an activity after the fact.
export function appendManualCardio(S, workout) {
  if (!workout || S.workouts.some(w => w.id === workout.id)) return false
  S.workouts.push(workout)
  S.workouts.sort((a, b) => String(a.d).localeCompare(String(b.d)) || (a.start || 0) - (b.start || 0))
  return true
}

// Derive distance from the canonical fields every time, so edits in the existing
// workout editor cannot leave a stale duplicate distance or pace behind.
export function walkRunHistory(S) {
  return (S.workouts || []).flatMap(workout => {
    let min = 0, km = 0
    for (const entry of workout.entries || []) {
      if (!Object.values(WALK_RUN_IDS).includes(canonicalExId(entry.id))) continue
      for (const row of entry.sets || []) {
        if (!row.done || isWarmupRow(row)) continue
        const duration = Number(row.min), speed = Number(row.speed)
        if (!Number.isFinite(duration) || !Number.isFinite(speed) || duration <= 0 || speed <= 0) continue
        min += duration
        km += duration * speed / 60
      }
    }
    return min > 0 ? [{ workout, min, km }] : []
  }).sort((a, b) => (b.workout.start || 0) - (a.workout.start || 0))
}
