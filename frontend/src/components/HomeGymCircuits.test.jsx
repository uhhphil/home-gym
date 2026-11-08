// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { useStore, DEF } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { EXIDX } from '../lib/exercises.js'
import { HomeGymCircuitSheet } from './HomeGymCircuits.jsx'

const picker = vi.hoisted(() => ({ pick: null, close: vi.fn() }))
vi.mock('../sheets.jsx', () => ({ exercisePicker: onPick => { picker.pick = onPick; return { close: picker.close } } }))
let root, host
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  useStore.setState({ S: structuredClone(DEF), user: null })
  useUI.setState({ sheets: [], toastMsg: '' })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })
const button = label => [...host.querySelectorAll('button')].find(b => b.textContent === label)

describe('circuit creation', () => {
  it('chooses stations through the existing picker and saves once without replacing an active workout', () => {
    const onSaved = vi.fn()
    useStore.setState(s => ({ S: { ...s.S, active: { id: 'active-lift', entries: [] } } }))
    act(() => root.render(<HomeGymCircuitSheet close={() => {}} onSaved={onSaved} />))
    expect(button('Save circuit').disabled).toBe(true)
    act(() => button('Add station').click())
    act(() => picker.pick(EXIDX['0549']))
    expect(button('Save circuit').disabled).toBe(true)
    act(() => button('Add station').click())
    act(() => picker.pick(EXIDX['0534']))
    expect(button('Save circuit').disabled).toBe(false)
    act(() => { button('Save circuit').click(); button('Save circuit').click() })
    const saved = JSON.parse(localStorage.getItem('gym_state_v1'))
    expect(saved.routines).toHaveLength(1)
    expect(saved.routines[0].startFrom).toBe('plan')
    expect(saved.routines[0].ex.map(e => e.id)).toEqual(['0549', '0534'])
    expect(saved.active.id).toBe('active-lift')
    expect(onSaved).toHaveBeenCalledTimes(1)
  })
})
