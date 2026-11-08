// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore, DEF } from '../store/useStore.js'
import { HomeGymLinks, HomeGymRoutines } from './HomeGymDashboard.jsx'

const actions = vi.hoisted(() => ({
  navigate: vi.fn(),
  equipmentProfile: vi.fn(),
  setup: vi.fn(),
}))
vi.mock('react-router-dom', () => ({ useNavigate: () => actions.navigate }))
vi.mock('../sheets.jsx', () => ({
  equipmentProfileSheet: actions.equipmentProfile,
  starterPlanSheet: vi.fn(),
}))
vi.mock('./HomeGymSetup.jsx', () => ({ homeGymSetupSheet: actions.setup }))

let root, host
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  localStorage.clear()
  useStore.setState({ S: {
    ...structuredClone(DEF),
    active: { id: 'active-lifting-session', entries: [{ id: '0025', sets: [{ w: 135, r: 5, done: true }] }] },
    workouts: [{ id: 'existing-history-id', d: '2026-11-08', entries: [{ id: '0025', sets: [{ w: 125, r: 5, done: true }] }] }],
  }, user: null })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const button = label => [...host.querySelectorAll('button')].find(b => b.textContent === label)

describe('home gym dashboard actions', () => {
  it('opens each saved routine by its existing ID without starting or changing a workout', () => {
    const routines = [
      { id: 'routine-original-001', name: 'Strength A', ex: [] },
      { id: 'routine-original-002', name: 'Strength B', ex: [] },
    ]
    useStore.setState(s => ({ S: { ...s.S, routines } }))
    const before = structuredClone(useStore.getState().S)
    act(() => root.render(<HomeGymRoutines />))

    for (const routine of routines) {
      const tile = [...host.querySelectorAll('button')].find(b => b.textContent.includes(routine.name))
      act(() => tile.click())
      expect(actions.navigate).toHaveBeenLastCalledWith('/plan/r/' + routine.id)
      expect(useStore.getState().S).toEqual(before)
    }
    expect(actions.navigate).toHaveBeenCalledTimes(2)
  })

  it.each([true, false])('the Workout shortcut only navigates, with an active session: %s', hasActive => {
    if (!hasActive) useStore.setState(s => ({ S: { ...s.S, active: null } }))
    const before = structuredClone(useStore.getState().S)
    act(() => root.render(<HomeGymLinks />))
    act(() => button('Workout').click())

    expect(actions.navigate).toHaveBeenCalledExactlyOnceWith('/workout')
    expect(useStore.getState().S).toEqual(before)
  })

  it('edits the equipment profile that is active at click time', () => {
    const original = { id: 'gym-one', name: 'First gym', equipment: ['barbell'] }
    const selected = { id: 'gym-two', name: 'Home gym', equipment: ['dumbbell', 'bench'] }
    useStore.setState(s => ({ S: { ...s.S, equipProfiles: [original, selected], activeEquipId: original.id } }))
    act(() => root.render(<HomeGymLinks />))
    // Profile selection can change in another view while the shortcut is mounted.
    act(() => useStore.setState(s => ({ S: { ...s.S, activeEquipId: selected.id } })))
    const before = structuredClone(useStore.getState().S)
    act(() => button('My equipment').click())

    expect(actions.equipmentProfile).toHaveBeenCalledExactlyOnceWith(selected)
    expect(actions.setup).not.toHaveBeenCalled()
    expect(useStore.getState().S).toEqual(before)
  })

  it.each([null, 'removed-profile'])('opens setup when no existing profile matches active ID %s', activeEquipId => {
    useStore.setState(s => ({ S: {
      ...s.S,
      equipProfiles: [{ id: 'another-profile', name: 'Other gym', equipment: ['barbell'] }],
      activeEquipId,
    } }))
    const before = structuredClone(useStore.getState().S)
    act(() => root.render(<HomeGymLinks />))
    act(() => button('My equipment').click())

    expect(actions.setup).toHaveBeenCalledExactlyOnceWith()
    expect(actions.equipmentProfile).not.toHaveBeenCalled()
    expect(useStore.getState().S).toEqual(before)
  })
})
