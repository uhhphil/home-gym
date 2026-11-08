import { useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { newProfile } from '../lib/equipment.js'
import { t } from '../lib/i18n.js'
import { Button, Segmented } from './ui.jsx'

const OPTIONS = ['barbell', 'dumbbell', 'kettlebell', 'bench', 'squat rack', 'pull-up bar', 'band', 'resistance band', 'rope']
const SELECTED = ['barbell', 'dumbbell', 'bench', 'squat rack', 'pull-up bar']

function Setup({ close }) {
  const [profile] = useState(() => newProfile('Home gym'))
  const saving = useRef(false)
  const [equipment, setEquipment] = useState(SELECTED)
  const [unit, setUnit] = useState('lb')
  const toggle = value => setEquipment(xs => xs.includes(value) ? xs.filter(x => x !== value) : [...xs, value])
  const save = () => {
    if (saving.current) return
    saving.current = true
    const store = useStore.getState()
    store.setUnit(unit)
    store.update(s => {
      if (s.equipProfiles.some(p => p.id === profile.id)) return
      s.equipProfiles.push({ ...profile, equipment, benchType: equipment.includes('bench') ? 'adjustable' : null })
      s.activeEquipId = profile.id
      s.equipFilterOn = true
      s.speedUnit = unit === 'lb' ? 'mph' : 'kmh'
      // Gym entry passes have no use in a home-only setup.
      s.checkIn = false
    })
    close()
  }
  return <>
    <h3>{t('Set up your home gym')}</h3>
    <p className="small dim">{t('Choose the equipment you own. Bodyweight exercises are always included.')}</p>
    <div className="chips wrap" style={{ marginBottom: 18 }}>{OPTIONS.map(value => <button type="button" key={value} className={'chip' + (equipment.includes(value) ? ' on' : '')} aria-pressed={equipment.includes(value)} onClick={() => toggle(value)}>{t(value)}</button>)}</div>
    <Segmented value={unit} onChange={setUnit} options={[{ value: 'lb', label: t('Pounds and miles') }, { value: 'kg', label: t('Kilograms and kilometers') }]} />
    <p className="small dim">{t('This adds a Home gym profile and filters exercises to your equipment. Existing weights are converted if you change units. Add exact plate and dumbbell weights in Settings → Equipment.')}</p>
    <Button variant="primary" onClick={save}>{t('Use this setup')}</Button>
  </>
}

export function homeGymSetupSheet() {
  useUI.getState().openSheet(close => <Setup close={close} />)
}
