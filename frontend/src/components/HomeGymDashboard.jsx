import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { EXIDX } from '../lib/exercises.js'
import { exCount } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { equipmentProfileSheet, starterPlanSheet } from '../sheets.jsx'
import { homeGymSetupSheet } from './HomeGymSetup.jsx'
import { HomeGymCircuitButton } from './HomeGymCircuits.jsx'
import { manualCardioSheet } from './ManualCardio.jsx'
import { Thumb } from './Media.jsx'
import { Button } from './ui.jsx'
import Icon from './Icon.jsx'
import workoutIcon from '../assets/fitbody/workout.svg'
import progressIcon from '../assets/fitbody/progress.svg'
import searchIcon from '../assets/fitbody/search.svg'
import profileIcon from '../assets/fitbody/profile.svg'

// Original Vectorfair kit icons. Keep their intrinsic geometry; only the touch
// target around them grows. The remaining glyphs use openGym's existing library.
const kitIcons = { workout: workoutIcon, progress: progressIcon, search: searchIcon, profile: profileIcon }
export function KitIcon({ name }) {
  return <img className="gym-kit-icon" src={kitIcons[name]} alt="" aria-hidden="true" />
}

export function openHomeEquipment() {
  const S = useStore.getState().S
  const profile = (S.equipProfiles || []).find(p => p.id === S.activeEquipId)
  if (profile) equipmentProfileSheet(profile)
  else homeGymSetupSheet()
}

export function HomeGymLinks() {
  const nav = useNavigate()
  return <nav className="gym-quick-links" aria-label={t('Home gym shortcuts')}>
    <button onClick={() => nav('/workout')}><KitIcon name="workout" /><span>{t('Workout')}</span></button>
    <button onClick={() => nav('/stats')}><KitIcon name="progress" /><span>{t('Progress')}</span></button>
    <button onClick={() => nav('/history')}><Icon name="history" /><span>{t('History')}</span></button>
    <button onClick={openHomeEquipment}><Icon name="dumbbell" /><span>{t('My equipment')}</span></button>
  </nav>
}

// Routine imagery is real catalogue content, not the kit's stock photos. The
// existing thumbnail component retains custom-media and offline fallbacks.
export function RoutinePreview({ routine, S }) {
  const entry = routine.ex?.[0]
  const ex = entry && ((S.customEx || []).find(e => e.id === entry.id) || EXIDX[entry.id])
  return <div className="gym-routine-media" aria-hidden="true">
    {ex ? <Thumb ex={ex} /> : <Icon name="dumbbell" />}
  </div>
}

export function HomeGymRoutines() {
  const S = useStore(s => s.S)
  const nav = useNavigate()
  return <section className="gym-routine-section" aria-label={t('Your routines')}>
    <div className="gym-section-heading"><h2>{t('Your routines')}</h2>
      <Button size="sm" variant="ghost" trailingIcon="chevronRight" onClick={() => nav('/plan')}>{t('See all')}</Button>
    </div>
    {S.routines.length ? <div className="gym-routine-grid">{S.routines.slice(0, 2).map(r =>
      <button className="gym-routine-tile" key={r.id} onClick={() => nav('/plan/r/' + r.id)}>
        <RoutinePreview routine={r} S={S} />
        <span className="gym-routine-caption"><strong>{r.name}</strong><span><Icon name="dumbbell" />{exCount(r.ex?.length || 0)}</span></span>
        <span className="gym-routine-open"><Icon name="chevronRight" /></span>
      </button>)}</div>
      : <div className="gym-routine-empty"><div><h3>{t('Make room for your next workout.')}</h3>
        <p>{t('Build a routine around the equipment you own.')}</p></div>
        <Button variant="primary" icon="plus" onClick={() => nav('/plan')}>{t('Build my own plan')}</Button>
        <Button variant="ghost" onClick={starterPlanSheet}>{t('Load starter plan')}</Button>
      </div>}
  </section>
}

export function HomeGymActions() {
  const nav = useNavigate()
  return <section className="gym-log-section" aria-label={t('Home gym')}>
    <div className="gym-section-heading"><h2>{t('Move your way')}</h2></div>
    <div className="gym-log-grid">
      <div className="gym-log-card"><span className="gym-log-glyph"><Icon name="figureRun" /></span>
        <h3>{t('Walks & runs')}</h3><p>{t('Time, distance, and pace.')}</p>
        <Button variant="tinted" icon="plus" onClick={manualCardioSheet}>{t('Log a walk or run')}</Button>
      </div>
      <div className="gym-log-card"><span className="gym-log-glyph"><Icon name="timer" /></span>
        <h3>{t('Timed training')}</h3><p>{t('Your moves. Your intervals.')}</p>
        <HomeGymCircuitButton onSaved={id => nav('/plan/r/' + id)} />
      </div>
    </div>
  </section>
}
