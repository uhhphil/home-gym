import { useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { Button, NumberField, TextField } from './ui.jsx'
import { exercisePicker } from '../sheets.jsx'
import { EXIDX } from '../lib/exercises.js'
import { exerciseNameText, uid } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { appendHomeGymCircuit, buildHomeGymCircuit, canTimeCircuitExercise, circuitDurationSeconds, MAX_CIRCUIT_STATIONS } from '../lib/home-gym-circuits.js'

export function HomeGymCircuitSheet({ close, onSaved }) {
  const [id] = useState(() => 'circuit-' + uid())
  const [name, setName] = useState(t('Timed circuit'))
  const [exerciseIds, setExerciseIds] = useState([])
  const [rounds, setRounds] = useState(3)
  const [workSec, setWorkSec] = useState(30)
  const [restSec, setRestSec] = useState(60)
  const [error, setError] = useState('')
  const saving = useRef(false)
  const routine = buildHomeGymCircuit({ id, name, exerciseIds, rounds, workSec, restSec })
  const add = () => {
    const picker = exercisePicker(ex => {
      if (!canTimeCircuitExercise(ex)) {
        useUI.getState().toast(t('Choose a free-weight, kettlebell, or bodyweight exercise.'))
        return
      }
      setExerciseIds(ids => ids.includes(ex.id) ? ids : [...ids, ex.id].slice(0, MAX_CIRCUIT_STATIONS))
      picker.close()
    }, { title: t('Add a circuit station') })
  }
  const save = () => {
    if (!routine || saving.current) return
    saving.current = true
    useStore.getState().update(s => appendHomeGymCircuit(s, routine))
    if (!useStore.getState().S.routines.some(r => r.id === id)) {
      saving.current = false
      setError(t('The circuit could not be saved. Please try again.'))
      return
    }
    useStore.getState().autoBackupNow()
    close()
    useUI.getState().toast(t('Circuit saved to your routines'))
    onSaved?.(id)
  }
  const seconds = circuitDurationSeconds({ stations: exerciseIds.length, rounds, workSec, restSec })
  return <div className="home-gym-circuit">
    <h3>{t('Build a timed circuit')}</h3>
    <p className="small dim">{t('Choose 2–8 stations. Complete each station once per round, then rest between rounds.')}</p>
    <label style={{ display: 'block', marginBottom: 16 }}>{t('Circuit name')}<TextField aria-label={t('Circuit name')} value={name} maxLength={80} onChange={e => setName(e.target.value)} /></label>
    <div className="list" style={{ marginBottom: 12 }}>{exerciseIds.map((key, i) => <div className="item" key={key}>
      <span className="grow">{i + 1}. {exerciseNameText(EXIDX[key])}</span>
      <Button size="sm" aria-label={t('Remove {0}', exerciseNameText(EXIDX[key]))} onClick={() => setExerciseIds(ids => ids.filter(x => x !== key))}>{t('Remove')}</Button>
    </div>)}</div>
    <Button icon="plus" onClick={add} disabled={exerciseIds.length >= MAX_CIRCUIT_STATIONS}>{t('Add station')}</Button>
    <div className="circuit-fields">
      <label>{t('Rounds')}<NumberField className="field" aria-label={t('Rounds')} decimal={false} value={rounds} onChange={setRounds} /></label>
      <label>{t('Work (sec)')}<NumberField className="field" aria-label={t('Work (sec)')} decimal={false} value={workSec} onChange={setWorkSec} /></label>
      <label>{t('Round rest (sec)')}<NumberField className="field" aria-label={t('Round rest (sec)')} decimal={false} value={restSec} onChange={setRestSec} /></label>
    </div>
    <p className="small dim">{t('Use 1–20 rounds, 5–600 seconds of work, and 0–600 seconds of rest. A 3-second count-in precedes every station.')}</p>
    {routine && <p role="status">{t('Estimated duration')}: {Math.ceil(seconds / 60)} {t('min')}</p>}
    <p className="small dim">{t('Save to Plan, set each exercise’s weight, and start when ready. Keep the app open for circuit cues.')}</p>
    {error && <p role="alert">{error}</p>}
    <Button variant="primary" disabled={!routine} onClick={save}>{t('Save circuit')}</Button>
  </div>
}

export function homeGymCircuitSheet(onSaved) {
  useUI.getState().openSheet(close => <HomeGymCircuitSheet close={close} onSaved={onSaved} />)
}

export function HomeGymCircuitButton({ onSaved }) {
  return <Button icon="timer" onClick={() => homeGymCircuitSheet(onSaved)}>{t('Timed circuit')}</Button>
}
