// Standard BLE Heart Rate Service; no WHOOP credentials or proprietary protocol.
// https://developer.chrome.com/docs/capabilities/bluetooth#receive_gatt_notifications
// https://www.bluetooth.com/specifications/specs/heart-rate-service-1-0/
// Call connect from a button gesture. This is a live display source, not a
// background recorder: readings stay in memory and are never written to WHOOP.
export const HEART_RATE_FRESH_MS = 15000

/** Validate a complete Heart Rate Measurement frame, including optional fields. */
export function parseHeartRateMeasurement(value) {
  try {
    const view = value instanceof DataView ? value
      : ArrayBuffer.isView(value) ? new DataView(value.buffer, value.byteOffset, value.byteLength)
        : value instanceof ArrayBuffer ? new DataView(value) : null
    if (!view || view.byteLength < 2) return null
    const flags = view.getUint8(0)
    let offset = flags & 1 ? 3 : 2
    if (view.byteLength < offset) return null
    const bpm = flags & 1 ? view.getUint16(1, true) : view.getUint8(1)
    const contact = flags & 4 ? (flags & 2 ? 'detected' : 'not-detected') : 'unsupported'
    if (flags & 8) offset += 2 // Energy Expended, UINT16.
    if (view.byteLength < offset) return null
    // RR intervals are UINT16 values. Do not accept a truncated or empty RR list.
    if (flags & 16) {
      if (view.byteLength - offset < 2 || (view.byteLength - offset) % 2) return null
    } else if (view.byteLength !== offset) return null
    // Match the app's existing heart-rate bounds (heart-rate.js).
    if (bpm < 25 || bpm > 250) return contact === 'not-detected' ? { bpm: null, contact } : null
    return { bpm, contact }
  } catch { return null }
}

/** Separate instances keep device lifecycle tests independent of the app source. */
export function createBluetoothHeartRate({
  getBluetooth = () => globalThis.navigator?.bluetooth,
  isSecure = () => globalThis.isSecureContext !== false,
  now = () => Date.now(),
} = {}) {
  const supported = () => isSecure() && typeof getBluetooth()?.requestDevice === 'function'
  let state = Object.freeze({ supported: supported(), status: supported() ? 'idle' : 'unavailable',
    deviceId: null, deviceName: null, devices: [], reading: null, stale: false, contact: null, error: null })
  let current = null, expiry = null
  const listeners = new Set()
  // A cancelled GATT setup must finish tearing down before the same device is
  // connected again; its late completion must not disconnect the new session.
  const deviceTasks = new Map()
  const publish = (patch, notify = true) => {
    state = Object.freeze({ ...state, ...patch })
    if (notify) for (const fn of [...listeners]) { try { fn() } catch { /* independent listeners */ } }
  }
  const clearExpiry = () => { clearTimeout(expiry); expiry = null }
  const expire = (notify = true) => {
    if (!state.reading) return
    const age = now() - state.reading.at
    if (age < 0 || age >= HEART_RATE_FRESH_MS) {
      clearExpiry()
      publish({ reading: null, stale: true }, notify)
    }
  }
  const release = owner => {
    if (!owner) return
    owner.characteristic?.removeEventListener('characteristicvaluechanged', owner.onValue)
    owner.device?.removeEventListener('gattserverdisconnected', owner.onDisconnect)
    // Disconnect stops notifications too. Avoid an asynchronous stopNotifications
    // from an old session racing a reconnect using the same characteristic.
    if (owner.started) { try { owner.device?.gatt?.disconnect() } catch { /* already gone */ } }
  }
  const disconnected = owner => {
    if (current !== owner) return
    current = null
    clearExpiry()
    release(owner)
    publish({ status: 'disconnected', reading: null, stale: false, contact: null, error: null })
  }
  const setup = async owner => {
    owner.started = true
    owner.onDisconnect = () => disconnected(owner)
    owner.device.addEventListener('gattserverdisconnected', owner.onDisconnect)
    try {
      const server = await owner.device.gatt.connect()
      if (current !== owner) { release(owner); return false }
      const service = await server.getPrimaryService('heart_rate')
      if (current !== owner) { release(owner); return false }
      const characteristic = await service.getCharacteristic('heart_rate_measurement')
      if (current !== owner) { release(owner); return false }
      owner.characteristic = characteristic
      owner.onValue = event => {
        if (current !== owner) return
        const result = parseHeartRateMeasurement(event.target?.value)
        if (!result) return
        clearExpiry()
        if (result.contact === 'not-detected') {
          publish({ reading: null, stale: false, contact: result.contact })
          return
        }
        const reading = Object.freeze({ bpm: result.bpm, at: now(), source: 'bluetooth', deviceName: state.deviceName })
        publish({ reading, stale: false, contact: result.contact })
        expiry = setTimeout(() => expire(), HEART_RATE_FRESH_MS)
      }
      characteristic.addEventListener('characteristicvaluechanged', owner.onValue)
      await characteristic.startNotifications()
      if (current !== owner) { release(owner); return false }
      publish({ status: 'connected', error: null })
      return true
    } catch (error) {
      release(owner)
      if (current === owner) {
        current = null
        clearExpiry()
        publish({ status: 'error', reading: null, stale: false, contact: null,
          error: 'Could not connect to the heart-rate monitor. Turn on heart-rate broadcast and try again.' })
      }
      return false
    }
  }
  const connect = () => {
    if (current) return current.promise || Promise.resolve(state.status === 'connected')
    if (!supported()) {
      publish({ supported: false, status: 'unavailable', error: 'Live Bluetooth heart rate is unavailable in this browser.' })
      return Promise.resolve(false)
    }
    const owner = {}
    current = owner
    clearExpiry()
    publish({ supported: true, status: 'connecting', deviceId: null, deviceName: null,
      reading: null, stale: false, contact: null, error: null })
    let choice
    try {
      // No await before requestDevice: preserve the button's transient activation.
      choice = getBluetooth().requestDevice({ filters: [{ services: ['heart_rate'] }] })
    } catch (error) { choice = Promise.reject(error) }
    owner.promise = Promise.resolve(choice).then(async device => {
      if (current !== owner) return false
      owner.device = device
      const key = device.id || device
      const previous = deviceTasks.get(key)
      if (previous) await previous
      if (current !== owner) return false
      publish({ deviceId: device.id || null, deviceName: device.name?.trim() || 'Bluetooth heart-rate monitor' })
      const task = setup(owner)
      deviceTasks.set(key, task)
      try { return await task }
      finally { if (deviceTasks.get(key) === task) deviceTasks.delete(key) }
    }).catch(error => {
      if (current !== owner) return false
      current = null
      release(owner)
      const cancelled = error?.name === 'NotFoundError' || error?.name === 'AbortError'
      publish({ status: cancelled ? 'idle' : 'error', reading: null, stale: false, contact: null,
        error: cancelled ? null : 'Could not open the Bluetooth device chooser. Try again from the Connect button.' })
      return false
    })
    return owner.promise
  }
  return {
    snapshot: () => { expire(false); return state },
    subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) },
    connect,
    disconnect: () => {
      const owner = current
      current = null
      clearExpiry()
      release(owner)
      publish({ status: supported() ? 'disconnected' : 'unavailable', reading: null, stale: false, contact: null, error: null })
    },
  }
}

/** iOS bridge adapter. The native side emits raw standard frames, parsed above. */
export function createNativeBluetoothHeartRate({ getPlugin, now = () => Date.now() }) {
  let state = Object.freeze({ supported: true, status: 'idle', deviceId: null, deviceName: null,
    devices: [], reading: null, stale: false, contact: null, error: null })
  let owner = null, sequence = 0, expiry = null
  const instanceID = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`
  const listeners = new Set()
  const publish = (patch, notify = true) => {
    state = Object.freeze({ ...state, ...patch })
    if (notify) for (const fn of [...listeners]) { try { fn() } catch { /* independent listeners */ } }
  }
  const clearExpiry = () => { clearTimeout(expiry); expiry = null }
  const expire = (notify = true) => {
    if (state.reading && (now() - state.reading.at >= HEART_RATE_FRESH_MS || now() < state.reading.at)) {
      clearExpiry(); publish({ reading: null, stale: true }, notify)
    }
  }
  const release = previous => {
    if (!previous) return
    Promise.resolve(previous.listener?.remove?.()).catch(() => {})
    Promise.resolve(previous.plugin?.disconnect({ session: previous.session })).catch(() => {})
  }
  const receive = (target, event) => {
    if (owner !== target || event?.session !== target.session) return
    if (event.kind === 'measurement') {
      if (state.status !== 'connected' || !Array.isArray(event.bytes) ||
        event.bytes.some(v => !Number.isInteger(v) || v < 0 || v > 255)) return
      const result = parseHeartRateMeasurement(Uint8Array.from(event.bytes))
      if (!result || !Number.isFinite(event.at) || event.at > now() + 1000 || now() - event.at >= HEART_RATE_FRESH_MS) return
      // Native Date carries fractional milliseconds while JS Date.now rounds.
      const at = Math.min(event.at, now())
      clearExpiry()
      if (result.contact === 'not-detected') publish({ reading: null, stale: false, contact: result.contact })
      else {
        publish({ reading: Object.freeze({ bpm: result.bpm, at, source: 'bluetooth', deviceName: state.deviceName }),
          stale: false, contact: result.contact })
        expiry = setTimeout(() => expire(), Math.max(1, HEART_RATE_FRESH_MS - (now() - at)))
      }
      return
    }
    if (event.kind !== 'state' || !['scanning', 'selecting', 'connecting', 'connected', 'disconnected', 'error', 'unavailable'].includes(event.status)) return
    const devices = Array.isArray(event.devices) ? event.devices.filter(d => typeof d?.id === 'string' && typeof d?.name === 'string').slice(0, 100) : state.devices
    if (event.status !== 'connected') clearExpiry()
    publish({ status: event.status, devices, supported: event.status !== 'unavailable',
      deviceId: event.deviceId || null, deviceName: event.deviceName || null, error: event.error || null,
      ...(event.status !== 'connected' ? { reading: null, stale: false, contact: null } : {}) })
  }
  const disconnect = () => {
    const previous = owner; owner = null
    clearExpiry(); release(previous)
    publish({ status: 'disconnected', reading: null, stale: false, contact: null, devices: [], error: null })
  }
  return {
    snapshot: () => { expire(false); return state },
    subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) },
    disconnect,
    connect: async id => {
      if (id) {
        if (!owner?.plugin || !['scanning', 'selecting'].includes(state.status) || !state.devices.some(d => d.id === id)) return false
        const target = owner
        publish({ status: 'connecting', reading: null, stale: false, error: null })
        try {
          const accepted = (await target.plugin.connect({ id, session: target.session }))?.ok === true
          if (!accepted && owner === target) { disconnect(); publish({ status: 'error', error: 'Could not connect to the selected monitor. Scan again.' }) }
          return accepted && owner === target
        }
        catch {
          if (owner === target) { disconnect(); publish({ status: 'error', error: 'Could not connect to the heart-rate monitor.' }) }
          return false
        }
      }
      if (owner && ['scanning', 'connecting', 'connected'].includes(state.status)) return false
      disconnect()
      const target = { session: `ble-${instanceID}-${++sequence}` }
      owner = target
      publish({ status: 'scanning', devices: [], deviceId: null, deviceName: null, error: null })
      try {
        // Wrapper avoids Promise assimilation of a Capacitor plugin proxy's `then`.
        const { HR } = await getPlugin()
        if (owner !== target) return false
        target.plugin = HR
        const listener = await HR.addListener('change', event => receive(target, event))
        target.listener = listener
        if (owner !== target) { release(target); return false }
        const result = await HR.scan({ session: target.session })
        return result?.ok === true && owner === target
      } catch {
        if (owner === target) { disconnect(); publish({ status: 'unavailable', supported: false, error: 'The Bluetooth bridge is unavailable in this app build.' }) }
        return false
      }
    },
  }
}

// A web page on iPhone never gains Bluetooth by changing its user agent. Only
// the installed shell with this registered native plugin uses Core Bluetooth.
const native = import.meta.env.VITE_MOBILE === '1' && globalThis.Capacitor?.getPlatform?.() === 'ios' &&
  globalThis.Capacitor?.isPluginAvailable?.('BluetoothHeartRate')
const source = native ? createNativeBluetoothHeartRate({ getPlugin: async () => {
  const { registerPlugin } = await import('@capacitor/core')
  return { HR: registerPlugin('BluetoothHeartRate') }
} }) : createBluetoothHeartRate()
export const bluetoothHeartRateSnapshot = source.snapshot
export const subscribeBluetoothHeartRate = source.subscribe
export const connectBluetoothHeartRate = source.connect
export const disconnectBluetoothHeartRate = source.disconnect
