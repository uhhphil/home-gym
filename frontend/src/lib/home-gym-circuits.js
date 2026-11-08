// Circuits are ordinary openGym routines. The existing superset flow controls rounds,
// and auto-holds owns the timer, completion, rest, persistence and recovery.
import { EXIDX, canonicalExId } from './exercises.js'
import { COUNT_IN_SEC } from './auto-holds.js'

export const MAX_CIRCUIT_STATIONS = 8
export const CIRCUIT_EQUIPMENT = new Set(['kettlebell', 'dumbbell', 'barbell', 'body weight', 'weighted'])

export function canTimeCircuitExercise(ex) {
  return !!ex && ex.cat !== 'cardio' && CIRCUIT_EQUIPMENT.has(ex.eq)
}

export function circuitDurationSeconds({ stations, rounds, workSec, restSec }) {
  return stations * rounds * (workSec + COUNT_IN_SEC) + Math.max(0, rounds - 1) * restSec
}

export function buildHomeGymCircuit({ id, name, exerciseIds, rounds, workSec, restSec, weight = 0 }) {
  if (typeof id !== 'string' || !id || typeof name !== 'string' || !name.trim()) return null
  if (!Array.isArray(exerciseIds)) return null
  // Canonicalize only this new routine, never any saved exercise or workout history.
  const ids = [...new Set(exerciseIds.map(canonicalExId))]
  if (ids.length < 2 || ids.length > MAX_CIRCUIT_STATIONS || ids.some(key => !canTimeCircuitExercise(EXIDX[key]))) return null
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 20) return null
  if (!Number.isInteger(workSec) || workSec < 5 || workSec > 600) return null
  if (!Number.isInteger(restSec) || restSec < 0 || restSec > 600) return null
  if (!Number.isFinite(weight) || weight < 0 || weight > 1000) return null
  return {
    id, name: name.trim().slice(0, 80), emoji: 'timer', startFrom: 'plan',
    ex: ids.map(key => ({
      id: key, sets: rounds, mode: 'time', sec: workSec,
      weight: EXIDX[key].eq === 'body weight' ? 0 : weight,
      prog: 'off', warmup: 'none', autoHold: true,
      sg: 'circuit-' + id, sgName: 'Timed circuit',
      ...(restSec ? { sgRest: restSec, restSec } : { restOff: true }),
    })),
  }
}

export function appendHomeGymCircuit(S, routine) {
  if (!routine || !Array.isArray(S.routines) || S.routines.some(r => r.id === routine.id)) return false
  S.routines.push(routine)
  return true
}
