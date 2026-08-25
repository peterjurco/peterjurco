// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  getSaveLabel,
  resetSaveStatus,
  setSaveStatus,
} from '../src/lib/articles/save-status'

beforeEach(() => resetSaveStatus())
afterEach(() => resetSaveStatus())

describe('save-status — merges the meta and content channels into one label', () => {
  it('is empty when both channels are idle', () => {
    expect(getSaveLabel()).toBe('')
  })

  it('shows "Saving…" if either channel is saving, even once the other has saved', () => {
    setSaveStatus('meta', 'saved')
    setSaveStatus('content', 'saving')
    expect(getSaveLabel()).toBe('Saving…')
  })

  it('shows "Save failed" if either channel errored and neither is saving', () => {
    setSaveStatus('meta', 'saved')
    setSaveStatus('content', 'error')
    expect(getSaveLabel()).toBe('Save failed')
  })

  it('shows "Saved" once both channels have saved', () => {
    setSaveStatus('meta', 'saved')
    setSaveStatus('content', 'saved')
    expect(getSaveLabel()).toBe('Saved')
  })
})
