import { useSyncExternalStore } from 'react'

export type SaveChannel = 'meta' | 'content'
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

const SAVE_LABELS: Record<SaveStatus, string> = {
  idle: '',
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Save failed',
}

interface SharedSaveState {
  meta: SaveStatus
  content: SaveStatus
}

const EVENT_NAME = 'article-save-status-change'

/**
 * The metadata panel and the content editor hydrate as two independent React
 * islands (src/pages/app/articles/[id].astro) — a module-level singleton
 * wouldn't be shared if their bundles ever split, so state lives on `window`
 * instead, with a same-window CustomEvent standing in for a subscription.
 */
function getShared(): SharedSaveState {
  const w = window as unknown as { __articleSaveStatus?: SharedSaveState }
  if (!w.__articleSaveStatus) {
    w.__articleSaveStatus = { meta: 'idle', content: 'idle' }
  }
  return w.__articleSaveStatus
}

/** One channel's status changed — recomputes the merged label for every subscriber. */
export function setSaveStatus(channel: SaveChannel, status: SaveStatus): void {
  getShared()[channel] = status
  window.dispatchEvent(new Event(EVENT_NAME))
}

/** Test-only: clears both channels back to idle between test cases. */
export function resetSaveStatus(): void {
  const w = window as unknown as { __articleSaveStatus?: SharedSaveState }
  w.__articleSaveStatus = { meta: 'idle', content: 'idle' }
}

/** saving > error > saved > idle — a save in flight always wins the display. */
function mergedStatus(shared: SharedSaveState): SaveStatus {
  const values = [shared.meta, shared.content]
  if (values.includes('saving')) return 'saving'
  if (values.includes('error')) return 'error'
  if (values.includes('saved')) return 'saved'
  return 'idle'
}

export function getSaveLabel(): string {
  return SAVE_LABELS[mergedStatus(getShared())]
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT_NAME, onChange)
  return () => window.removeEventListener(EVENT_NAME, onChange)
}

/**
 * One combined "Saving…"/"Saved"/"Save failed" label for the whole article
 * editor page — the metadata panel and the content editor each report their
 * own save lifecycle into this store rather than rendering separate
 * indicators, so the page never shows two "Saved" badges at once.
 */
export function useSharedSaveLabel(): string {
  return useSyncExternalStore(subscribe, getSaveLabel, () => '')
}
