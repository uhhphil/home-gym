// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../lib/api.js'
import { confirmSheet } from '../sheets.jsx'
import { connectBluetoothHeartRate, disconnectBluetoothHeartRate } from '../lib/bluetooth-heart-rate.js'
import { BluetoothHeartRatePanel, WhoopPanel, WhoopSummary } from './Whoop.jsx'

const fixture = vi.hoisted(() => ({ store: null, storeListeners: new Set(), sensor: null, sensorListeners: new Set(), mobile: false }))
vi.mock('../store/useStore.js', async () => {
  const { useSyncExternalStore } = await import('react')
  const subscribe = fn => { fixture.storeListeners.add(fn); return () => fixture.storeListeners.delete(fn) }
  const useStore = selector => useSyncExternalStore(subscribe, () => selector(fixture.store))
  useStore.getState = () => fixture.store
  return { useStore }
})
vi.mock('../store/useUI.js', () => ({ useUI: { getState: () => ({ openSheet: vi.fn() }) } }))
vi.mock('../lib/api.js', () => ({ api: vi.fn() }))
vi.mock('../lib/mobile.js', () => ({ get MOBILE() { return fixture.mobile }, shareExport: vi.fn() }))
vi.mock('../lib/demo.js', () => ({ DEMO: false }))
vi.mock('../sheets.jsx', () => ({ confirmSheet: vi.fn() }))
vi.mock('../lib/bluetooth-heart-rate.js', () => ({
  bluetoothHeartRateSnapshot: () => fixture.sensor,
  subscribeBluetoothHeartRate: fn => { fixture.sensorListeners.add(fn); return () => fixture.sensorListeners.delete(fn) },
  connectBluetoothHeartRate: vi.fn(async () => true), disconnectBluetoothHeartRate: vi.fn(),
}))

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const blank = { configured: false, connected: false, data: null, lastSync: null, error: null }
const observations = (score = 76) => ({ accountId: '10129',
  recoveries: [{ id: 'recovery-a', sleepId: 'sleep-a', createdAt: '2026-11-08T08:00:00Z', score, hrv: null, restingHeartRate: 56 }],
  sleeps: [{ id: 'sleep-a', end: '2026-11-08T08:00:00Z', sleepMs: null }],
  cycles: [{ id: 'cycle-a', start: '2026-11-08T08:00:00Z', strain: null }],
  workouts: [{ id: 'workout-a', sport: 'walking', start: '2026-11-08T08:00:00Z', end: '2026-11-08T08:30:00Z', strain: null, averageHeartRate: null }],
})
const connected = data => ({ ...blank, configured: true, connected: true, data, lastSync: Date.now() })
let host, root
const button = label => [...host.querySelectorAll('button')].find(b => b.textContent === label)
const render = async element => { await act(async () => { root.render(element) }) }
const click = async label => { await act(async () => { button(label).click() }) }
const account = async id => {
  await act(async () => {
    fixture.store = { ...fixture.store, user: id ? { id } : null }
    fixture.storeListeners.forEach(fn => fn())
  })
}
const sensor = patch => act(() => {
  fixture.sensor = { ...fixture.sensor, ...patch }
  fixture.sensorListeners.forEach(fn => fn())
})
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-08T12:00:00Z')); vi.clearAllMocks()
  fixture.mobile = false
  fixture.store = { user: null, S: { unit: 'kg', workouts: [{ id: 'existing-local-workout' }] } }
  fixture.sensor = { supported: false, status: 'unavailable', reading: null, devices: [], deviceName: null, stale: false, contact: null }
  api.mockResolvedValue(blank)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })

describe('WHOOP account UI', () => {
  it('does not request account data or offer account authorization to a guest', async () => {
    await render(<WhoopPanel />)
    expect(api).not.toHaveBeenCalled()
    expect(button('Connect WHOOP account')).toBeUndefined()
    expect(host.textContent).toContain('Sign in to your Home Gym profile')
    expect(host.textContent).toContain('Account sync still works here.')
  })
  it('does not offer an active connection when the server is unconfigured', async () => {
    await account('user-a'); await render(<WhoopPanel />)
    expect(api).toHaveBeenCalledExactlyOnceWith('/api/whoop/status', undefined)
    expect(host.textContent).toContain('needs to be set up on this server')
    expect(button('Connect WHOOP account')).toBeUndefined()
    expect(button('Disconnect WHOOP')).toBeUndefined()
  })
  it('keeps cached observations when auto-sync fails and never renders missing scores as zero', async () => {
    await account('user-a')
    api.mockResolvedValueOnce({ ...connected(observations(null)), lastSync: Date.now() - 3600000 })
      .mockRejectedValueOnce(new Error('offline'))
    await render(<WhoopPanel />)
    expect(api.mock.calls.map(c => c[0])).toEqual(['/api/whoop/status', '/api/whoop/sync'])
    expect(host.textContent).toContain('Could not reach WHOOP')
    expect(host.querySelector('[aria-label="WHOOP activities"]').textContent).toContain('walking')
    expect([...host.querySelectorAll('.whoop-metrics strong')].map(el => el.textContent)).toEqual(['–%', '– hr', '– / 21'])
    expect(host.textContent).not.toContain('0 bpm')
    expect(button('Disconnect WHOOP')).toBeTruthy()
  })
  it('marks the cached home summary after an automatic refresh failure', async () => {
    await account('user-a')
    api.mockResolvedValueOnce({ ...connected(observations()), lastSync: Date.now() - 3600000 })
      .mockRejectedValueOnce(new Error('offline'))
    await render(<WhoopSummary />)
    expect(host.textContent).toContain('76%')
    expect(host.textContent).toContain('Showing the last synced data')
  })
  it('offers reconnection after revoked access while preserving cached metrics and export', async () => {
    await account('user-a')
    const saved = { ...connected(observations()), lastSync: Date.now() - 3600000 }
    api.mockImplementation(async path => {
      if (path === '/api/whoop/sync') throw Object.assign(new Error('Access revoked'), { status: 401, data: { code: 'reconnect' } })
      return saved
    })
    const localWorkouts = fixture.store.S.workouts
    await render(<><WhoopPanel /><WhoopSummary /></>)
    expect(host.querySelector('[role="alert"]').textContent).toBe('Reconnect your WHOOP account to continue.')
    expect(button('Connect WHOOP account')).toBeTruthy()
    expect(button('Sync now')).toBeUndefined()
    expect(button('Export WHOOP data')).toBeTruthy()
    expect(host.querySelectorAll('.whoop-metrics')).toHaveLength(2)
    const summary = host.querySelector('[aria-label="WHOOP summary"]')
    expect(summary.textContent).toContain('76%')
    expect(summary.textContent).toContain('Showing the last synced data')
    expect(host.querySelector('[aria-label="WHOOP activities"]').textContent).toContain('walking')
    expect(fixture.store.S.workouts).toBe(localWorkouts)
  })
  it('discards a previous account response that arrives after the new profile loads', async () => {
    const previous = deferred()
    api.mockReturnValueOnce(previous.promise).mockResolvedValueOnce(connected(observations(22)))
    await account('user-a'); await render(<WhoopPanel />)
    await account('user-b')
    expect(host.textContent).toContain('22%')
    await act(async () => previous.resolve(connected(observations(99))))
    expect(host.textContent).toContain('22%')
    expect(host.textContent).not.toContain('99%')
    expect(api).toHaveBeenCalledTimes(2)
  })
  it('removes observations from both mounted views and explains manual revocation when needed', async () => {
    await account('user-a')
    let server = connected(observations())
    api.mockImplementation(async path => {
      if (path === '/api/whoop/disconnect') { server = { ...blank, configured: true }; return { connected: false, revokeRequired: true } }
      return server
    })
    const localWorkouts = fixture.store.S.workouts
    await render(<><WhoopPanel /><WhoopSummary /></>)
    expect(host.querySelectorAll('.whoop-metrics')).toHaveLength(2)
    await click('Disconnect WHOOP')
    expect(confirmSheet).toHaveBeenCalledOnce()
    await act(async () => { await confirmSheet.mock.calls[0][0].onConfirm() })
    expect(host.querySelectorAll('.whoop-metrics')).toHaveLength(0)
    expect(host.querySelector('[aria-label="WHOOP activities"]')).toBeNull()
    expect(host.textContent).toContain('Also revoke this app in WHOOP settings')
    expect(button('Connect WHOOP account')).toBeTruthy()
    expect(fixture.store.S.workouts).toBe(localWorkouts)
    expect(localWorkouts).toEqual([{ id: 'existing-local-workout' }])
  })
  it('cleans up account timers and subscriptions on unmount', async () => {
    await account('user-a'); await render(<WhoopPanel />)
    expect(vi.getTimerCount()).toBe(1)
    act(() => root.unmount())
    expect(vi.getTimerCount()).toBe(0)
    expect(fixture.storeListeners.size).toBe(0)
    expect(fixture.sensorListeners.size).toBe(0)
    api.mockClear()
    act(() => window.dispatchEvent(new CustomEvent('whoop-account-change', { detail: {} })))
    expect(api).not.toHaveBeenCalled()
  })
})

describe('live sensor controls', () => {
  it('requires explicit scan and device selection instead of connecting to the first discovered band', async () => {
    sensor({ supported: true, status: 'idle' })
    await render(<BluetoothHeartRatePanel />)
    expect(connectBluetoothHeartRate).not.toHaveBeenCalled()
    await click('Find heart rate sensor')
    expect(connectBluetoothHeartRate).toHaveBeenCalledExactlyOnceWith()
    connectBluetoothHeartRate.mockClear()
    sensor({ status: 'scanning', devices: [{ id: 'band-a', name: 'WHOOP fixture A' }, { id: 'band-b', name: 'WHOOP fixture B' }] })
    expect(connectBluetoothHeartRate).not.toHaveBeenCalled()
    await click('WHOOP fixture B')
    expect(connectBluetoothHeartRate).toHaveBeenCalledExactlyOnceWith('band-b')
    await click('Cancel')
    expect(disconnectBluetoothHeartRate).toHaveBeenCalledOnce()
  })
  it('distinguishes fresh, stale and lost-contact readings and labels the selected sensor', async () => {
    sensor({ supported: true, status: 'connected', deviceName: 'WHOOP 5.0 fixture', reading: { bpm: 132 } })
    await render(<BluetoothHeartRatePanel />)
    expect(host.querySelector('.whoop-live').textContent).toContain('132 bpm')
    expect(host.querySelector('.whoop-live').textContent).toContain('WHOOP 5.0 fixture')
    sensor({ reading: null, stale: true })
    expect(host.querySelector('.whoop-live strong').textContent).toBe('– bpm')
    expect(host.textContent).toContain('Waiting for a fresh reading')
    sensor({ stale: false, contact: 'not-detected' })
    expect(host.textContent).toContain('Check the fit of your band')
    await click('Disconnect sensor')
    expect(disconnectBluetoothHeartRate).toHaveBeenCalledOnce()
  })
})
