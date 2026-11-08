import { useEffect, useState } from 'react'
import { t } from '../lib/i18n.js'
import { liveHeartRate, onLiveHeartRate } from '../lib/phone-workout.js'
import { bluetoothHeartRateSnapshot, subscribeBluetoothHeartRate } from '../lib/bluetooth-heart-rate.js'

// Prefer the explicitly connected Bluetooth monitor while it has a fresh reading.
// Otherwise retain the iPhone workout session's AirPods/phone source (#818).
const currentReading = phoneEnabled => bluetoothHeartRateSnapshot().reading || (phoneEnabled ? liveHeartRate() : null)
export default function LiveHeartRate({ phoneEnabled = true }) {
  const [hr, setHr] = useState(() => currentReading(phoneEnabled))
  useEffect(() => {
    const refresh = () => setHr(currentReading(phoneEnabled))
    const off = onLiveHeartRate(refresh)
    const offBluetooth = subscribeBluetoothHeartRate(refresh)
    // The phone source expires after a minute; BLE publishes its own 15s expiry.
    const iv = setInterval(refresh, 15000)
    document.addEventListener('visibilitychange', refresh)
    refresh()
    return () => { off(); offBluetooth(); clearInterval(iv); document.removeEventListener('visibilitychange', refresh) }
  }, [phoneEnabled])
  if (!hr) return null
  const source = hr.source === 'bluetooth' ? hr.deviceName : t('Phone workout')
  return <> · <span className="live-hr" title={source} aria-label={t('Heart rate') + ' ' + hr.bpm + ' · ' + source}>♥ {hr.bpm}</span></>
}
