import { describe, expect, it } from 'vitest'
import { shortcutFor, type KeyTarget } from './shortcuts'

const el = (tagName: string, attrs: Record<string, string> = {}, isContentEditable = false): KeyTarget => ({
  tagName,
  isContentEditable,
  getAttribute: (name) => attrs[name] ?? null,
})
const body = el('BODY')
const key = (k: string, over: Partial<Parameters<typeof shortcutFor>[0]> = {}) =>
  shortcutFor({ key: k, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, target: body, ...over })

describe('shortcutFor', () => {
  it('maps the player keys', () => {
    expect(key(' ')).toEqual({ type: 'toggle' })
    expect(key('ArrowLeft')).toEqual({ type: 'nudge', seconds: -1 })
    expect(key('ArrowRight')).toEqual({ type: 'nudge', seconds: 1 })
    expect(key('ArrowLeft', { shiftKey: true })).toEqual({ type: 'nudge', seconds: -5 })
    expect(key('ArrowRight', { shiftKey: true })).toEqual({ type: 'nudge', seconds: 5 })
    expect(key('Home')).toEqual({ type: 'start' })
    expect(key('End')).toEqual({ type: 'end' })
    expect(key('x')).toBeNull()
  })

  it('maps the timeline keys: comma and full stop step a frame, I and O mark the range', () => {
    expect(key(',')).toEqual({ type: 'step', frames: -1 })
    expect(key('.')).toEqual({ type: 'step', frames: 1 })
    expect(key('i')).toEqual({ type: 'mark', end: 'in' })
    expect(key('I', { shiftKey: true })).toEqual({ type: 'mark', end: 'in' })
    expect(key('o')).toEqual({ type: 'mark', end: 'out' })
    expect(key('O')).toEqual({ type: 'mark', end: 'out' })
  })

  it('lets a slider or radio keep a typed letter, and a text field always', () => {
    expect(key('i', { target: el('INPUT', { type: 'text' }) })).toBeNull()
    expect(key(',', { target: el('TEXTAREA') })).toBeNull()
    // Sliders and radios only want arrows, Home and End; the timeline's own handles are sliders.
    expect(key('i', { target: el('DIV', { role: 'slider' }) })).toEqual({ type: 'mark', end: 'in' })
    expect(key('.', { target: el('BUTTON', { role: 'radio' }) })).toEqual({ type: 'step', frames: 1 })
  })

  it('leaves keys alone with Ctrl, Cmd or Alt held', () => {
    expect(key('ArrowLeft', { ctrlKey: true })).toBeNull()
    expect(key(' ', { metaKey: true })).toBeNull()
    expect(key('Home', { altKey: true })).toBeNull()
  })

  it('does nothing while typing in a text field', () => {
    for (const target of [
      el('INPUT', { type: 'text' }),
      el('INPUT'),
      el('TEXTAREA'),
      el('SELECT'),
      el('DIV', {}, true),
    ]) {
      expect(key(' ', { target })).toBeNull()
      expect(key('ArrowLeft', { target })).toBeNull()
    }
  })

  it('lets Space press a focused button or radio, but still seeks with the arrows from a button', () => {
    expect(key(' ', { target: el('BUTTON') })).toBeNull()
    expect(key(' ', { target: el('BUTTON', { role: 'radio' }) })).toBeNull()
    expect(key('ArrowRight', { target: el('BUTTON') })).toEqual({ type: 'nudge', seconds: 1 })
  })

  it('lets radios, sliders and range inputs keep their arrow keys', () => {
    expect(key('ArrowRight', { target: el('BUTTON', { role: 'radio' }) })).toBeNull()
    expect(key('ArrowLeft', { target: el('SPAN', { role: 'slider' }) })).toBeNull()
    expect(key('Home', { target: el('INPUT', { type: 'range' }) })).toBeNull()
    expect(key(' ', { target: el('INPUT', { type: 'range' }) })).toEqual({ type: 'toggle' })
  })
})
