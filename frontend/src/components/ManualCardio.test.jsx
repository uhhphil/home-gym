// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useStore, DEF } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { ManualCardioSheet } from './ManualCardio.jsx'
import { homeGymSetupSheet } from './HomeGymSetup.jsx'
import { walkRunHistory } from '../lib/manual-cardio.js'

let root, host
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  useStore.setState({ S: structuredClone(DEF), user: null })
  useUI.setState({ sheets: [], toastMsg: '' })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })
const button = text => [...host.querySelectorAll('button')].find(b => b.textContent === text)
function enter(label, value) {
  const input = host.querySelector(`[aria-label="${label}"]`)
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('personal home-gym entry points', () => {
  it('saves a walk durably through the existing store without replacing an active session', () => {
    const active = { id: 'lifting', entries: [] }
    useStore.setState(s => ({ S: { ...s.S, active, unit: 'lb' } }))
    act(() => root.render(<ManualCardioSheet close={() => {}} />))
    expect(button('Save activity').disabled).toBe(true)
    enter('Duration (minutes)', '30')
    enter('Distance', '2')
    expect(host.textContent).toContain('15:00')
    act(() => { button('Save activity').click(); button('Save activity').click() })
    const saved = JSON.parse(localStorage.getItem('gym_state_v1'))
    expect(saved.workouts).toHaveLength(1)
    expect(saved.active.id).toBe('lifting')
    expect(walkRunHistory(saved)[0].km).toBeCloseTo(3.218688, 8)
  })

  it('applies the chosen home equipment and converts historical kilograms to pounds', () => {
    useStore.setState(s => ({ S: { ...s.S, bodyweight: [{ d: '2026-11-01', w: 80 }] } }))
    homeGymSetupSheet()
    const sheet = useUI.getState().sheets.at(-1)
    act(() => root.render(sheet.render(() => {})))
    act(() => { button('Use this setup').click(); button('Use this setup').click() })
    const S = useStore.getState().S
    expect(S.unit).toBe('lb')
    expect(S.speedUnit).toBe('mph')
    expect(S.bodyweight[0].w).toBeCloseTo(176.4, 1)
    expect(S.equipFilterOn).toBe(true)
    expect(S.equipProfiles).toHaveLength(1)
    expect(S.equipProfiles[0].equipment).toEqual(['barbell', 'dumbbell', 'bench', 'squat rack', 'pull-up bar'])
    expect(S.equipProfiles[0].equipment).not.toContain('kettlebell')
    expect(S.checkIn).toBe(false)
  })

  it('converts a typed distance before duration has been entered', () => {
    useStore.setState(s => ({ S: { ...s.S, unit: 'lb' } }))
    act(() => root.render(<ManualCardioSheet close={() => {}} />))
    enter('Distance', '2')
    act(() => button('Kilometers').click())
    enter('Duration (minutes)', '30')
    act(() => button('Save activity').click())
    expect(walkRunHistory(useStore.getState().S)[0].km).toBeCloseTo(3.218688, 8)
  })
})
