// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import LiveHeartRate from './LiveHeartRate.jsx'

const sources = vi.hoisted(() => ({ phone: null, bluetooth: null, phoneListeners: new Set(), bluetoothListeners: new Set() }))
vi.mock('../lib/phone-workout.js', () => ({
  liveHeartRate: () => sources.phone,
  onLiveHeartRate: fn => { sources.phoneListeners.add(fn); return () => sources.phoneListeners.delete(fn) },
}))
vi.mock('../lib/bluetooth-heart-rate.js', () => ({
  bluetoothHeartRateSnapshot: () => ({ reading: sources.bluetooth }),
  subscribeBluetoothHeartRate: fn => { sources.bluetoothListeners.add(fn); return () => sources.bluetoothListeners.delete(fn) },
}))
let host, root
const emit = kind => act(() => { for (const fn of sources[kind + 'Listeners']) fn() })
const render = (phoneEnabled = true) => act(() => root.render(<LiveHeartRate phoneEnabled={phoneEnabled} />))
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  sources.phone = null; sources.bluetooth = null
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })

it('renders no fabricated reading when neither source has a fresh value', () => {
  render(); expect(host.textContent).toBe('')
})
it('prefers a fresh connected sensor and labels its source, falling back when stale or disconnected', () => {
  sources.phone = { bpm: 100, at: Date.now() }
  sources.bluetooth = { bpm: 130, at: Date.now(), source: 'bluetooth', deviceName: 'WHOOP fixture' }
  render()
  expect(host.textContent).toContain('130')
  expect(host.querySelector('.live-hr').getAttribute('aria-label')).toContain('WHOOP fixture')
  sources.bluetooth = null; emit('bluetooth')
  expect(host.textContent).toContain('100')
  expect(host.querySelector('.live-hr').title).toBe('Phone workout')
  sources.phone = null; emit('phone')
  expect(host.textContent).toBe('')
})
it('keeps Bluetooth visible with the health module off, without reading phone values', () => {
  sources.phone = { bpm: 100, at: Date.now() }
  render(false); expect(host.textContent).toBe('')
  sources.bluetooth = { bpm: 135, at: Date.now(), source: 'bluetooth', deviceName: 'Polar fixture' }
  emit('bluetooth'); expect(host.textContent).toContain('135')
  sources.bluetooth = null; emit('bluetooth'); expect(host.textContent).toBe('')
  render(true); expect(host.textContent).toContain('100')
  render(false); expect(host.textContent).toBe('')
})
it('refreshes phone freshness and releases listeners/timers when unmounted', () => {
  sources.phone = { bpm: 100, at: Date.now() }; render()
  sources.phone = null
  act(() => vi.advanceTimersByTime(15000))
  expect(host.textContent).toBe('')
  expect(sources.phoneListeners.size).toBe(1)
  expect(sources.bluetoothListeners.size).toBe(1)
  act(() => root.unmount())
  expect(sources.phoneListeners.size).toBe(0)
  expect(sources.bluetoothListeners.size).toBe(0)
  expect(vi.getTimerCount()).toBe(0)
})
