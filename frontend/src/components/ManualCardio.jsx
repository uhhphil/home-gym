import { useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { Button, NumberField, Segmented, TextField } from './ui.jsx'
import { t } from '../lib/i18n.js'
import { fmtNum, uid } from '../lib/format.js'
import { appendManualCardio, buildManualCardio, cardioMetrics, distanceFromKm, distanceToKm, distanceUnitOf, formatPace, walkRunHistory } from '../lib/manual-cardio.js'
import { workoutDetailSheet } from '../sheets.jsx'

const localTime = () => {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

export function ManualCardioSheet({ close }) {
  const S = useStore(s => s.S)
  const [id] = useState(() => 'cardio-' + uid())
  const [kind, setKind] = useState('walk')
  const [minutes, setMinutes] = useState(null)
  const [distance, setDistance] = useState(null)
  const [unit, setUnit] = useState(() => distanceUnitOf(S))
  const [endedAt, setEndedAt] = useState(localTime)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const saving = useRef(false)
  const metrics = cardioMetrics(minutes, distance, unit)
  const end = new Date(endedAt).getTime()
  const valid = !!metrics && Number.isFinite(end) && end <= Date.now() && end - metrics.min * 60000 >= 0
  const save = () => {
    if (saving.current) return
    const workout = buildManualCardio({ id, kind, minutes, distance, unit, end, note })
    if (!workout) { setError(t('Enter a positive duration and distance, and a finish time in the past.')); return }
    saving.current = true
    let added = false
    useStore.getState().update(s => { added = appendManualCardio(s, workout) })
    // An account switch can refuse a stale tab's update. Keep the form open then.
    if (!useStore.getState().S.workouts.some(w => w.id === id)) {
      saving.current = false
      setError(t('The activity could not be added. Keep these numbers and try again.'))
      return
    }
    close()
    if (added) {
      useStore.getState().autoBackupNow()
      useUI.getState().toast(t('Activity added to history'))
    }
  }
  return <div className="manual-cardio">
    <h3>{t('Log a walk or run')}</h3>
    <p className="small dim">{t('Enter the activity you completed. Pace is calculated from your time and distance.')}</p>
    <Segmented value={kind} onChange={setKind} options={[{ value: 'walk', label: t('Walk') }, { value: 'run', label: t('Run') }]} />
    <div className="cardio-fields">
      <label>{t('Duration (minutes)')}<NumberField className="field" aria-label={t('Duration (minutes)')} value={minutes} onChange={setMinutes} nullable /></label>
      <label>{t('Distance')} ({unit})<NumberField className="field" aria-label={t('Distance')} value={distance} onChange={setDistance} nullable /></label>
    </div>
    <Segmented value={unit} onChange={next => {
      // A unit change preserves the entered distance instead of relabelling it.
      if (distance != null && Number.isFinite(Number(distance))) setDistance(distanceFromKm(distanceToKm(Number(distance), unit), next))
      setUnit(next)
    }} options={[{ value: 'mi', label: t('Miles') }, { value: 'km', label: t('Kilometers') }]} />
    <div className="cardio-pace" role="status"><span className="dim">{t('Average pace')}</span><strong>{metrics ? formatPace(metrics.paceSeconds) : '–'} <small>min/{unit}</small></strong></div>
    <label className="cardio-label">{t('Finished at')}<TextField type="datetime-local" value={endedAt} max={localTime()} onChange={e => setEndedAt(e.target.value)} /></label>
    <label className="cardio-label">{t('Note (optional)')}<TextField value={note} maxLength={2000} onChange={e => setNote(e.target.value)} placeholder={t('Route, terrain, or how it felt')} /></label>
    {error && <p role="alert">{error}</p>}
    <Button variant="primary" onClick={save} disabled={!valid}>{t('Save activity')}</Button>
  </div>
}

export function manualCardioSheet() {
  useUI.getState().openSheet(close => <ManualCardioSheet close={close} />)
}

export function CardioHistory() {
  const S = useStore(s => s.S)
  const history = walkRunHistory(S)
  if (!history.length) return null
  const unit = distanceUnitOf(S)
  return <section className="card cardio-history" aria-label={t('Walking and running')}>
    <h3>{t('Walking and running')}</h3>
    <p className="small dim">{t('Recent activities · distance and average pace')}</p>
    {history.slice(0, 5).map(({ workout, min, km }) => {
      const distance = distanceFromKm(km, unit)
      return <button key={workout.id} className="cardio-history-row" onClick={() => workoutDetailSheet(workout)}>
        <span><strong>{workout.name || t('Activity')}</strong><span className="small dim">{workout.d} · {fmtNum(min)} {t('min')}</span></span>
        <span><strong>{fmtNum(Math.round(distance * 100) / 100)} {unit}</strong><span className="small dim">{formatPace(min * 60 / distance)} min/{unit}</span></span>
      </button>
    })}
  </section>
}
