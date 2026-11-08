import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { MOBILE, shareExport } from '../lib/mobile.js'
import { DEMO } from '../lib/demo.js'
import { t, dateLocale } from '../lib/i18n.js'
import { fmtNum, fmtAgo } from '../lib/format.js'
import { distanceFromKm, distanceUnitOf } from '../lib/manual-cardio.js'
import { latestWhoop, whoopAuthorizationUrl, whoopExport } from '../lib/whoop.js'
import { bluetoothHeartRateSnapshot, subscribeBluetoothHeartRate, connectBluetoothHeartRate, disconnectBluetoothHeartRate } from '../lib/bluetooth-heart-rate.js'
import { confirmSheet } from '../sheets.jsx'
import { Button } from './ui.jsx'
import Icon from './Icon.jsx'
import './Whoop.css'

const empty = { configured: false, connected: false, lastSync: null, error: null, data: null }
const RECHECK_MS = 15 * 60 * 1000
const date = value => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString(dateLocale(), { month: 'short', day: 'numeric' }) : '–'
const number = (value, digits = 0) => typeof value === 'number' && Number.isFinite(value) ? fmtNum(Number(value.toFixed(digits))) : '–'

// Each response stays with the profile that asked for it. Switching accounts or
// unmounting invalidates in-flight work; no health observations live in a global cache.
export function useWhoopAccount({ autoSync = false } = {}) {
  const uid = useStore(s => s.user?.id) || null
  const [state, setState] = useState({ uid: null, ...empty })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const sequence = useRef(0)
  const mounted = useRef(false)
  const instance = useRef({})
  const request = useCallback(async (action = 'status', refresh = false) => {
    if (!uid || DEMO) return null
    const ticket = ++sequence.current
    const current = () => mounted.current && ticket === sequence.current && useStore.getState().user?.id === uid
    setBusy(true); setError(null)
    try {
      let result = await api('/api/whoop/' + action, action === 'status' ? undefined : { method: 'POST', body: '{}', ...(action === 'sync' ? { timeout: 100000 } : {}) })
      if (!current()) return null
      // Show the server's saved observations even if the following refresh fails.
      if (action === 'status') setState({ uid, ...result })
      if (refresh && result.connected && (!result.lastSync || Date.now() - result.lastSync >= RECHECK_MS)) {
        result = await api('/api/whoop/sync', { method: 'POST', body: '{}', timeout: 100000 })
        if (!current()) return null
      }
      if (action === 'status' || action === 'sync') setState({ uid, ...result })
      if (action === 'disconnect') setState(s => ({ uid, ...empty, configured: s.configured }))
      if (action === 'disconnect' || action === 'sync') window.dispatchEvent(new CustomEvent('whoop-account-change', { detail: instance.current }))
      return result
    } catch (e) {
      if (current()) {
        const reconnect = e.data?.code === 'reconnect'
        if (reconnect) setState(s => ({ ...s, connected: false }))
        setError(reconnect ? t('Reconnect your WHOOP account to continue.') : e.status === 401 ? t('Sign in again to access WHOOP.') : t('Could not reach WHOOP. Your saved workouts are unchanged.'))
      }
      return null
    } finally { if (current()) setBusy(false) }
  }, [uid])
  useEffect(() => {
    mounted.current = true
    setState({ uid, ...empty }); setError(null); setBusy(false)
    request('status', autoSync)
    const refresh = () => { if (!document.hidden) request('status', autoSync) }
    const changed = event => { if (event.detail !== instance.current) request('status') }
    const interval = setInterval(refresh, RECHECK_MS)
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('whoop-account-change', changed)
    return () => { mounted.current = false; sequence.current++; clearInterval(interval); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('whoop-account-change', changed) }
  }, [uid, request, autoSync])
  return { ...(state.uid === uid ? state : empty), uid, busy, request, requestError: error }
}

export function BluetoothHeartRatePanel() {
  const sensor = useSyncExternalStore(subscribeBluetoothHeartRate, bluetoothHeartRateSnapshot, bluetoothHeartRateSnapshot)
  const working = ['connecting', 'scanning'].includes(sensor.status)
  const connected = sensor.status === 'connected'
  return <section className="whoop-section" aria-label={t('Live heart rate')}>
    <h3><Icon name="heart" /> {t('Live heart rate')}</h3>
    <p>{t('Turn on Heart Rate Broadcast in the WHOOP app, then choose your band here.')}</p>
    {sensor.supported ? <>
      <div className="whoop-live" role="status" aria-live="polite">
        <strong>{sensor.reading ? sensor.reading.bpm : '–'} <small>bpm</small></strong>
        <span>{sensor.reading ? t('Live') : connected ? sensor.contact === 'not-detected' ? t('Check the fit of your band') : t('Waiting for a fresh reading')
          : working ? t('Finding your sensor…') : sensor.status === 'selecting' ? t('Choose your sensor') : t('Not connected')}</span>
        {sensor.deviceName && <span className="small dim">{sensor.deviceName}</span>}
      </div>
      {!!sensor.devices?.length && ['scanning', 'selecting'].includes(sensor.status) && <div className="whoop-sensors">{sensor.devices.map(d =>
        <Button key={d.id} variant="tinted" onClick={() => connectBluetoothHeartRate(d.id)}>{d.name || t('Heart rate sensor')}</Button>)}</div>}
      {connected || working || sensor.status === 'selecting'
        ? <Button onClick={disconnectBluetoothHeartRate}>{working || sensor.status === 'selecting' ? t('Cancel') : t('Disconnect sensor')}</Button>
        : <Button variant="tinted" icon="heart" onClick={() => connectBluetoothHeartRate()}>{t('Find heart rate sensor')}</Button>}
      {sensor.error && <p role="alert">{t(sensor.error)}</p>}
      <p className="small dim">{t('Keep this app open during training. Readings disappear when the signal becomes stale.')}</p>
    </> : <p className="whoop-note">{MOBILE
      ? t('This app build does not include Bluetooth heart-rate support. Install an updated native build to pair your band.')
      : t('This browser cannot connect directly to your band. On iPhone, use the native app with Bluetooth support. Account sync still works here.')}</p>}
  </section>
}

function Metrics({ data }) {
  const { recovery, sleep, cycle } = latestWhoop(data)
  return <>
    <div className="whoop-metrics">
      <div><span>{t('Recovery')}</span><strong>{number(recovery?.score)}<small>%</small></strong><small>{date(recovery?.createdAt)}</small></div>
      <div><span>{t('Sleep')}</span><strong>{number(sleep?.sleepMs == null ? null : sleep.sleepMs / 3600000, 1)}<small> {t('hr')}</small></strong><small>{date(sleep?.end)}</small></div>
      <div><span>{t('Strain')}</span><strong>{number(cycle?.strain, 1)}<small> / 21</small></strong><small>{date(cycle?.start)}</small></div>
    </div>
    <div className="whoop-secondary"><span>HRV: {number(recovery?.hrv, 1)} ms</span><span>{t('Resting HR')}: {number(recovery?.restingHeartRate)} bpm</span></div>
  </>
}

async function exportData(data) {
  const text = whoopExport(data)
  if (!text) return
  const filename = 'whoop-' + new Date().toISOString().slice(0, 10) + '.json'
  if (MOBILE) return shareExport(text, filename)
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}

export function WhoopPanel() {
  const account = useWhoopAccount({ autoSync: true })
  const S = useStore(s => s.S)
  const [notice, setNotice] = useState(null)
  const unit = distanceUnitOf(S)
  const connect = async () => {
    const response = await account.request('authorize')
    if (!response) return
    const url = whoopAuthorizationUrl(response.url)
    if (url) window.location.assign(url)
    else setNotice(t('WHOOP authorization could not be opened. Try again.'))
  }
  const disconnect = () => confirmSheet({
    title: t('Disconnect WHOOP?'), message: t('Remove the WHOOP connection and its cached summaries. Your logged workouts stay here.'),
    confirmText: t('Disconnect'), danger: true,
    onConfirm: async () => {
      const result = await account.request('disconnect')
      if (result?.revokeRequired) setNotice(t('The local connection was removed. Also revoke this app in WHOOP settings; WHOOP could not be reached.'))
    },
  })
  return <div className="whoop-panel">
    <h3>WHOOP</h3>
    <section className="whoop-section" aria-label={t('WHOOP account sync')}>
      <h3>{t('Account sync')}</h3>
      <p>{t('Recovery, sleep, strain, and activity summaries from your WHOOP account.')}</p>
      {account.data && <>
        <p className="small dim">{t('Last synced {0}', fmtAgo(account.lastSync))}</p>
        <Metrics data={account.data} />
        <Button onClick={() => exportData(account.data).catch(() => setNotice(t('Export could not be saved. Try again.')))}>{t('Export WHOOP data')}</Button>
      </>}
      {!account.uid || DEMO ? <p className="whoop-note">{t('Sign in to your Home Gym profile to connect WHOOP. Bluetooth pairing works separately.')}</p>
        : !account.configured && !account.busy ? <p className="whoop-note">{t('WHOOP account sync needs to be set up on this server before you can connect.')}</p>
        : <>
          {account.connected ? <>
            {!account.data && <p className="small dim">{t('Connected · waiting for the first sync')}</p>}
            <div className="whoop-actions"><Button variant="tinted" onClick={() => account.request('sync')} disabled={account.busy}>{account.busy ? t('Syncing…') : t('Sync now')}</Button></div>
          </> : MOBILE ? <p className="whoop-note">{t('Open your Home Gym web app in Safari and connect WHOOP there, then return here and refresh.')}</p>
            : <Button variant="primary" onClick={connect} disabled={account.busy}>{account.busy ? t('Loading…') : t('Connect WHOOP account')}</Button>}
        </>}
      {(account.connected || account.data || account.error) && <Button variant="ghost" onClick={disconnect} disabled={account.busy}>{t('Disconnect WHOOP')}</Button>}
      {(account.requestError || account.error) && <p role="alert">{account.requestError || account.error}</p>}
      {notice && <p role="status">{notice}</p>}
      <p className="small dim">{t('Account summaries update when you open this screen and every 15 minutes while it is visible. They are separate from the live sensor.')}</p>
    </section>
    <BluetoothHeartRatePanel />
    {!!account.data?.workouts?.length && <section className="whoop-section" aria-label={t('WHOOP activities')}>
      <h3>{t('WHOOP activities')}</h3>
      <p className="small dim">{t('Last 30 days. These are WHOOP observations, not extra copies of your logged workouts.')}</p>
      <div className="whoop-activities">{account.data.workouts.map(w => <div className="whoop-activity" key={w.id}>
        <div><strong>{w.sport || t('Activity')}</strong><span>{date(w.start)} · {number((Date.parse(w.end) - Date.parse(w.start)) / 60000)} {t('min')}</span></div>
        <div><strong>{number(w.strain, 1)} {t('strain')}</strong><span>{number(w.averageHeartRate)} bpm{w.distanceMeters > 0 ? ' · ' + number(distanceFromKm(w.distanceMeters / 1000, unit), 2) + ' ' + unit : ''}</span></div>
      </div>)}</div>
    </section>}
  </div>
}

export function whoopSheet() { useUI.getState().openSheet(() => <WhoopPanel />) }

export function WhoopSummary() {
  const account = useWhoopAccount({ autoSync: true })
  if (!account.data) return null
  return <section className="card whoop-summary" aria-label={t('WHOOP summary')}>
    <div className="row between"><h3>WHOOP</h3><Button size="sm" variant="ghost" onClick={whoopSheet}>{t('Details')}</Button></div>
    <Metrics data={account.data} />
    <p className="small dim">{account.requestError || account.error || !account.connected ? t('Showing the last synced data') : account.lastSync ? t('Last synced {0}', fmtAgo(account.lastSync)) : ''}</p>
  </section>
}
