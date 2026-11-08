import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBluetoothHeartRate, createNativeBluetoothHeartRate, HEART_RATE_FRESH_MS, parseHeartRateMeasurement } from './bluetooth-heart-rate.js'

const frame = (...bytes) => new DataView(Uint8Array.from(bytes).buffer)
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
class Characteristic extends EventTarget {
  constructor() {
    super()
    this.startNotifications = vi.fn(async () => this)
    this.addEventListener = vi.fn(super.addEventListener.bind(this))
    this.removeEventListener = vi.fn(super.removeEventListener.bind(this))
  }
  emit(value) { this.value = value; this.dispatchEvent(new Event('characteristicvaluechanged')) }
}
class Device extends EventTarget {
  constructor(name = 'WHOOP test fixture', id = 'fixture') {
    super()
    this.name = name; this.id = id
    this.characteristic = new Characteristic()
    this.service = { getCharacteristic: vi.fn(async () => this.characteristic) }
    this.gatt = {
      connected: false,
      connect: vi.fn(async () => { this.gatt.connected = true; return this.gatt }),
      getPrimaryService: vi.fn(async () => this.service),
      disconnect: vi.fn(() => {
        if (this.gatt.connected) { this.gatt.connected = false; this.dispatchEvent(new Event('gattserverdisconnected')) }
      }),
    }
  }
}

describe('standard Heart Rate Measurement parsing', () => {
  it('reads 8-bit and little-endian 16-bit heart rates and contact flags', () => {
    expect(parseHeartRateMeasurement(frame(0, 128))).toEqual({ bpm: 128, contact: 'unsupported' })
    expect(parseHeartRateMeasurement(frame(6, 128))).toEqual({ bpm: 128, contact: 'detected' })
    expect(parseHeartRateMeasurement(frame(7, 200, 0))).toEqual({ bpm: 200, contact: 'detected' })
    expect(parseHeartRateMeasurement(frame(4, 0))).toEqual({ bpm: null, contact: 'not-detected' })
    expect(parseHeartRateMeasurement(frame(4, 100))).toEqual({ bpm: 100, contact: 'not-detected' })
    // Detection bit has no meaning without the contact-supported bit.
    expect(parseHeartRateMeasurement(frame(2, 100))?.contact).toBe('unsupported')
  })
  it('honors view offsets and validates optional energy and RR fields', () => {
    const bytes = Uint8Array.of(255, 0, 100, 255)
    expect(parseHeartRateMeasurement(bytes.subarray(1, 3))?.bpm).toBe(100)
    expect(parseHeartRateMeasurement(frame(24, 100, 10, 0, 0, 4, 1, 4))?.bpm).toBe(100)
    expect(parseHeartRateMeasurement(frame(9, 200, 0, 10, 0))?.bpm).toBe(200)
  })
  it('ignores truncated, malformed and out-of-range frames', () => {
    for (const value of [null, {}, [], frame(), frame(0), frame(1, 100), frame(8, 100, 0),
      frame(16, 100), frame(16, 100, 0), frame(0, 100, 0), frame(0, 0), frame(0, 24),
      frame(0, 251), frame(1, 44, 1), frame(1, 255, 255)]) {
      expect(parseHeartRateMeasurement(value)).toBeNull()
    }
    expect(parseHeartRateMeasurement(frame(0, 25))?.bpm).toBe(25)
    expect(parseHeartRateMeasurement(frame(0, 250))?.bpm).toBe(250)
  })
})

describe('iPhone native bridge adapter', () => {
  let source, plugin, callbacks, session
  const devices = [{ id: 'selected-id', name: 'WHOOP 5.0 fixture', rssi: -55 }]
  const emit = data => { for (const callback of callbacks) callback({ session, ...data }) }
  const status = (value, extra = {}) => emit({ kind: 'state', status: value, devices,
    deviceId: 'selected-id', deviceName: devices[0].name, ...extra })
  const measurement = (bytes = [6, 128], at = Date.now()) => emit({ kind: 'measurement', bytes, at })
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(100000)
    callbacks = new Set()
    plugin = {
      addListener: vi.fn(async (name, callback) => {
        callbacks.add(callback)
        return { remove: vi.fn(async () => callbacks.delete(callback)) }
      }),
      scan: vi.fn(async args => { session = args.session; status('scanning'); return { ok: true } }),
      connect: vi.fn(async () => { status('connected'); return { ok: true } }),
      disconnect: vi.fn(async () => ({ ok: true })),
    }
    source = createNativeBluetoothHeartRate({ getPlugin: async () => ({ HR: plugin }) })
  })
  afterEach(() => { source.disconnect(); vi.useRealTimers() })

  it('scans without connecting until the user chooses a discovered ID', async () => {
    expect(await source.connect()).toBe(true)
    expect(source.snapshot()).toMatchObject({ status: 'scanning', devices, reading: null })
    expect(plugin.connect).not.toHaveBeenCalled()
    expect(await source.connect('arbitrary-id')).toBe(false)
    expect(plugin.connect).not.toHaveBeenCalled()
    expect(await source.connect('selected-id')).toBe(true)
    expect(plugin.connect).toHaveBeenCalledExactlyOnceWith({ id: 'selected-id', session })
    measurement()
    expect(source.snapshot()).toMatchObject({ status: 'connected', contact: 'detected',
      reading: { bpm: 128, at: 100000, source: 'bluetooth', deviceName: 'WHOOP 5.0 fixture' } })
  })
  it('shares malformed-frame/contact handling, and rejects stale or future native samples', async () => {
    await source.connect(); await source.connect('selected-id')
    for (const bytes of [[1, 100], [0, 300], [0, -1], [0, 12.5], [0, 0]]) measurement(bytes)
    measurement([0, 128], Date.now() - HEART_RATE_FRESH_MS)
    measurement([0, 128], Date.now() + 5000)
    expect(source.snapshot().reading).toBeNull()
    measurement([7, 200, 0], Date.now() + 0.5)
    expect(source.snapshot().reading).toMatchObject({ bpm: 200, at: Date.now() })
    measurement([4, 0])
    expect(source.snapshot()).toMatchObject({ reading: null, contact: 'not-detected' })
    measurement(); vi.advanceTimersByTime(HEART_RATE_FRESH_MS)
    expect(source.snapshot()).toMatchObject({ reading: null, stale: true })
  })
  it('clears immediately on native disconnect/background and never accepts later samples', async () => {
    await source.connect(); await source.connect('selected-id'); measurement()
    status('disconnected')
    expect(source.snapshot()).toMatchObject({ status: 'disconnected', reading: null })
    measurement()
    expect(source.snapshot().reading).toBeNull()
  })
  it('exposes permission/radio errors and supports retry with one active listener', async () => {
    await source.connect()
    status('error', { error: 'Allow Bluetooth access in Settings.' })
    expect(source.snapshot()).toMatchObject({ status: 'error', error: 'Allow Bluetooth access in Settings.' })
    await source.connect()
    expect(callbacks.size).toBe(1)
    expect(source.snapshot()).toMatchObject({ status: 'scanning', error: null })
    await source.connect('selected-id')
    expect(await source.connect()).toBe(false)
    expect(plugin.addListener).toHaveBeenCalledTimes(2)
    source.disconnect()
    expect(callbacks.size).toBe(0)
    expect(source.snapshot()).toMatchObject({ reading: null, status: 'disconnected', devices: [] })
  })
  it('ignores prior session events after reconnecting', async () => {
    await source.connect()
    const oldSession = session, oldCallback = [...callbacks][0]
    source.disconnect(); await source.connect(); await source.connect('selected-id')
    oldCallback({ session: oldSession, kind: 'state', status: 'error', error: 'Old session' })
    emit({ session: oldSession, kind: 'measurement', bytes: [0, 150], at: Date.now() })
    expect(source.snapshot()).toMatchObject({ status: 'connected', reading: null, error: null })
  })
  it('cancels before a late plugin or listener can start scanning', async () => {
    const loading = deferred()
    source = createNativeBluetoothHeartRate({ getPlugin: () => loading.promise })
    const first = source.connect()
    source.disconnect(); loading.resolve({ HR: plugin })
    expect(await first).toBe(false)
    expect(plugin.scan).not.toHaveBeenCalled()
    const subscribing = deferred(), remove = vi.fn()
    plugin.addListener.mockReturnValueOnce(subscribing.promise)
    const second = source.connect()
    await Promise.resolve()
    source.disconnect(); subscribing.resolve({ remove })
    expect(await second).toBe(false)
    expect(remove).toHaveBeenCalledOnce()
    expect(plugin.scan).not.toHaveBeenCalled()
  })
  it('keeps a newer session intact when an older scan request fails late', async () => {
    const oldScan = deferred()
    plugin.scan.mockReturnValueOnce(oldScan.promise)
    const pending = source.connect()
    await Promise.resolve(); await Promise.resolve()
    source.disconnect()
    await source.connect(); await source.connect('selected-id')
    oldScan.reject(new Error('old scan failed'))
    expect(await pending).toBe(false)
    expect(source.snapshot()).toMatchObject({ status: 'connected', error: null })
  })
  it('reports missing bridge and rejected selected-device connections without hanging', async () => {
    source = createNativeBluetoothHeartRate({ getPlugin: async () => { throw new Error('Unavailable') } })
    expect(await source.connect()).toBe(false)
    expect(source.snapshot()).toMatchObject({ supported: false, status: 'unavailable' })
    source = createNativeBluetoothHeartRate({ getPlugin: async () => ({ HR: plugin }) })
    await source.connect()
    plugin.connect.mockResolvedValueOnce({ ok: false })
    expect(await source.connect('selected-id')).toBe(false)
    expect(source.snapshot()).toMatchObject({ status: 'error', reading: null })
  })
})

describe('Bluetooth heart-rate lifecycle', () => {
  let device, bluetooth, source
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(100000)
    device = new Device()
    bluetooth = { requestDevice: vi.fn(async () => device) }
    source = createBluetoothHeartRate({ getBluetooth: () => bluetooth })
  })
  afterEach(() => { source.disconnect(); vi.useRealTimers() })

  it('reports unavailable browsers and insecure contexts without opening a chooser', async () => {
    for (const api of [undefined, {}, { requestDevice: null }]) {
      const unavailable = createBluetoothHeartRate({ getBluetooth: () => api })
      expect(unavailable.snapshot()).toMatchObject({ supported: false, status: 'unavailable', reading: null })
      expect(await unavailable.connect()).toBe(false)
    }
    const insecure = createBluetoothHeartRate({ getBluetooth: () => bluetooth, isSecure: () => false })
    expect(await insecure.connect()).toBe(false)
    expect(bluetooth.requestDevice).not.toHaveBeenCalled()
  })
  it('opens the filtered chooser synchronously and subscribes to standard notifications once', async () => {
    const one = source.connect(), two = source.connect()
    expect(bluetooth.requestDevice).toHaveBeenCalledExactlyOnceWith({ filters: [{ services: ['heart_rate'] }] })
    expect(two).toBe(one)
    expect(source.snapshot().status).toBe('connecting')
    expect(await one).toBe(true)
    expect(await source.connect()).toBe(true)
    expect(device.gatt.getPrimaryService).toHaveBeenCalledExactlyOnceWith('heart_rate')
    expect(device.service.getCharacteristic).toHaveBeenCalledExactlyOnceWith('heart_rate_measurement')
    expect(device.characteristic.startNotifications).toHaveBeenCalledOnce()
    expect(device.characteristic.addEventListener).toHaveBeenCalledOnce()
    expect(source.snapshot()).toMatchObject({ status: 'connected', deviceName: device.name, reading: null })
    device.characteristic.emit(frame(6, 128))
    expect(source.snapshot().reading).toEqual({ bpm: 128, at: 100000, source: 'bluetooth', deviceName: device.name })
    expect(source.snapshot()).toBe(source.snapshot())
  })
  it('handles chooser cancellation quietly and lets the user retry', async () => {
    bluetooth.requestDevice.mockRejectedValueOnce({ name: 'NotFoundError' })
    expect(await source.connect()).toBe(false)
    expect(source.snapshot()).toMatchObject({ status: 'idle', reading: null, error: null })
    expect(await source.connect()).toBe(true)
  })
  it('handles a synchronously denied chooser and a failed connection without leaking listeners', async () => {
    bluetooth.requestDevice.mockImplementationOnce(() => { throw { name: 'SecurityError' } })
    expect(await source.connect()).toBe(false)
    expect(source.snapshot()).toMatchObject({ status: 'error', reading: null })
    device.characteristic.startNotifications.mockRejectedValueOnce(new Error('fixture failure'))
    expect(await source.connect()).toBe(false)
    expect(source.snapshot()).toMatchObject({ status: 'error', reading: null })
    expect(device.characteristic.removeEventListener).toHaveBeenCalled()
    device.characteristic.emit(frame(0, 120))
    expect(source.snapshot().reading).toBeNull()
  })
  it('expires readings after 15 seconds and invalid packets cannot extend freshness', async () => {
    const listener = vi.fn(), off = source.subscribe(listener)
    await source.connect()
    device.characteristic.emit(frame(0, 130))
    vi.advanceTimersByTime(HEART_RATE_FRESH_MS - 1)
    device.characteristic.emit(frame(1, 100))
    expect(source.snapshot().reading?.bpm).toBe(130)
    listener.mockClear()
    vi.advanceTimersByTime(1)
    expect(source.snapshot()).toMatchObject({ status: 'connected', reading: null, stale: true })
    expect(listener).toHaveBeenCalledOnce()
    device.characteristic.emit(frame(0, 132))
    expect(source.snapshot()).toMatchObject({ stale: false, reading: { bpm: 132 } })
    off(); listener.mockClear()
    vi.advanceTimersByTime(HEART_RATE_FRESH_MS)
    expect(listener).not.toHaveBeenCalled()
  })
  it('never returns an expired reading even before a throttled timer runs', async () => {
    await source.connect(); device.characteristic.emit(frame(0, 130))
    vi.setSystemTime(200000)
    expect(source.snapshot()).toMatchObject({ reading: null, stale: true })
  })
  it('clears the reading immediately when sensor contact is lost', async () => {
    await source.connect(); device.characteristic.emit(frame(6, 120))
    device.characteristic.emit(frame(4, 0))
    expect(source.snapshot()).toMatchObject({ contact: 'not-detected', reading: null, stale: false })
    device.characteristic.emit(frame(6, 125))
    expect(source.snapshot()).toMatchObject({ contact: 'detected', reading: { bpm: 125 } })
  })
  it('clears readings and listeners on device disconnect; reconnect fetches fresh attributes', async () => {
    await source.connect(); device.characteristic.emit(frame(0, 125))
    device.gatt.disconnect()
    expect(source.snapshot()).toMatchObject({ status: 'disconnected', reading: null, contact: null })
    device.characteristic.emit(frame(0, 150))
    expect(source.snapshot().reading).toBeNull()
    await source.connect()
    expect(device.gatt.getPrimaryService).toHaveBeenCalledTimes(2)
    const listener = vi.fn(); source.subscribe(listener)
    device.characteristic.emit(frame(0, 130))
    expect(listener).toHaveBeenCalledOnce()
  })
  it('ignores a cancelled chooser that completes after another connection', async () => {
    const choice = deferred(), old = new Device('old', 'old')
    bluetooth.requestDevice.mockReturnValueOnce(choice.promise)
    const pending = source.connect()
    source.disconnect()
    await source.connect()
    choice.resolve(old)
    expect(await pending).toBe(false)
    expect(old.gatt.connect).not.toHaveBeenCalled()
    expect(source.snapshot()).toMatchObject({ status: 'connected', deviceName: device.name })
  })
  it('ignores an old chooser rejection after a new connection succeeds', async () => {
    const choice = deferred()
    bluetooth.requestDevice.mockReturnValueOnce(choice.promise)
    const pending = source.connect()
    source.disconnect(); await source.connect()
    choice.reject(new Error('old request'))
    expect(await pending).toBe(false)
    expect(source.snapshot()).toMatchObject({ status: 'connected', error: null })
  })
  it('serializes a reconnect behind cancelled GATT setup for the same device', async () => {
    const opening = deferred()
    device.gatt.connect.mockImplementationOnce(async () => { await opening.promise; device.gatt.connected = true; return device.gatt })
    const old = source.connect()
    await Promise.resolve()
    source.disconnect()
    const replacement = source.connect()
    await Promise.resolve()
    expect(device.gatt.connect).toHaveBeenCalledTimes(1)
    opening.resolve()
    expect(await old).toBe(false)
    expect(await replacement).toBe(true)
    expect(device.gatt.connected).toBe(true)
    expect(device.gatt.connect).toHaveBeenCalledTimes(2)
    device.characteristic.emit(frame(0, 140))
    expect(source.snapshot().reading?.bpm).toBe(140)
  })
  it('cleans up cancelled notification setup and ignores late notifications', async () => {
    const starting = deferred()
    device.characteristic.startNotifications.mockReturnValueOnce(starting.promise)
    const pending = source.connect()
    await vi.waitFor(() => expect(device.characteristic.startNotifications).toHaveBeenCalled())
    source.disconnect()
    device.characteristic.emit(frame(0, 120))
    starting.resolve(device.characteristic)
    expect(await pending).toBe(false)
    expect(source.snapshot()).toMatchObject({ status: 'disconnected', reading: null })
    expect(vi.getTimerCount()).toBe(0)
  })
  it('uses the actual device name, or a neutral fallback, without claiming WHOOP identity', async () => {
    device.name = 'Polar fixture'
    await source.connect(); device.characteristic.emit(frame(0, 128))
    expect(source.snapshot().reading?.deviceName).toBe('Polar fixture')
    source.disconnect(); device.name = ''
    await source.connect()
    expect(source.snapshot().deviceName).toBe('Bluetooth heart-rate monitor')
  })
})
