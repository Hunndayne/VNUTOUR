// Local autosave for in-progress edits.
//
// The long forms in this app — a station with its quiz builder, a broadcast
// email, a participant's profile — take minutes to fill in. A reload, an
// accidental back, or a phone putting the tab to sleep used to throw all of it
// away. Every such form now mirrors its state into localStorage under a stable
// key, restores it on mount, and drops it once the edit is saved or discarded.
//
// localStorage rather than sessionStorage: the loss people actually complain
// about is closing the tab, which sessionStorage does not survive.

/* eslint-disable react-refresh/only-export-components */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const DRAFT_PREFIX = 'vnutour:draft:'

/** Old drafts are noise — a week is long past the point of "I was mid-edit". */
const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000

function getStore() {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage
  } catch {
    // Private mode / storage disabled — the forms still work, just unsaved.
    return null
  }
}

function stableStringify(value) {
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    // Files, DOM nodes and other unserialisable state simply never match, so
    // such a form is treated as always-dirty and never persisted below.
    return ''
  }
}

export function readDraft(key) {
  const store = getStore()
  if (!store || !key) return null
  try {
    const raw = store.getItem(DRAFT_PREFIX + key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || !('value' in parsed)) return null
    if (!parsed.savedAt || Date.now() - parsed.savedAt > DRAFT_TTL_MS) {
      store.removeItem(DRAFT_PREFIX + key)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function writeDraft(key, value) {
  const store = getStore()
  if (!store || !key) return
  try {
    store.setItem(DRAFT_PREFIX + key, JSON.stringify({ savedAt: Date.now(), value }))
  } catch {
    // Quota exceeded or unserialisable — losing the autosave beats breaking
    // the keystroke that triggered it.
  }
}

export function clearDraft(key) {
  const store = getStore()
  if (!store || !key) return
  try {
    store.removeItem(DRAFT_PREFIX + key)
  } catch { /* nothing to do */ }
}

/** Drop every stored draft — used on logout so the next account starts clean. */
export function clearAllDrafts() {
  const store = getStore()
  if (!store) return
  try {
    Object.keys(store)
      .filter((name) => name.startsWith(DRAFT_PREFIX))
      .forEach((name) => store.removeItem(name))
  } catch { /* nothing to do */ }
}

/**
 * `useState` that survives a reload.
 *
 * @param key       Stable identity for this edit, e.g. `station:12` or
 *                  `station:new`. Pass a falsy key to disable persistence.
 * @param baseline  The pristine server value (or a lazy initialiser). Read
 *                  once, on mount, and used both as the starting value and as
 *                  the yardstick for "has anything actually changed".
 *
 * Returns `[value, setValue, draft]` where `draft` carries:
 *   dirty     — the value differs from the baseline
 *   restored  — this mount started from a stored draft, not the baseline
 *   savedAt   — when that draft was written
 *   discard() — throw the draft away and go back to the baseline
 *   clear()   — forget the stored draft, keep the value (call after saving)
 *   dismiss() — hide the "restored" notice, keep everything else
 */
export function useDraftState(key, baseline, { enabled = true, debounceMs = 400 } = {}) {
  // Boxed so a baseline that is legitimately `undefined` is still only
  // evaluated once, on mount.
  const pristineRef = useRef(null)
  if (pristineRef.current === null) {
    pristineRef.current = { value: typeof baseline === 'function' ? baseline() : baseline }
  }
  const pristine = pristineRef.current.value
  const active = Boolean(enabled && key)

  const [state, setState] = useState(() => {
    if (!active) return { value: pristine, restoredAt: null }
    const stored = readDraft(key)
    if (!stored) return { value: pristine, restoredAt: null }
    // A draft identical to what the server already has is not worth telling
    // anybody about — most likely the user saved from another tab.
    if (stableStringify(stored.value) === stableStringify(pristine)) {
      clearDraft(key)
      return { value: pristine, restoredAt: null }
    }
    return { value: stored.value, restoredAt: stored.savedAt }
  })

  const setValue = useCallback((next) => {
    setState((previous) => {
      const value = typeof next === 'function' ? next(previous.value) : next
      return value === previous.value ? previous : { ...previous, value }
    })
  }, [])

  const dirty = useMemo(
    () => stableStringify(state.value) !== stableStringify(pristine),
    [state.value, pristine],
  )

  // Debounced so a long description does not hit localStorage per keystroke.
  useEffect(() => {
    if (!active) return undefined
    const timer = setTimeout(() => {
      if (dirty) writeDraft(key, state.value)
      else clearDraft(key)
    }, debounceMs)
    return () => clearTimeout(timer)
  }, [active, key, debounceMs, dirty, state.value])

  const discard = useCallback(() => {
    clearDraft(key)
    setState({ value: pristineRef.current.value, restoredAt: null })
  }, [key])

  const clear = useCallback(() => {
    clearDraft(key)
    setState((previous) => (previous.restoredAt === null ? previous : { ...previous, restoredAt: null }))
  }, [key])

  const dismiss = useCallback(() => {
    setState((previous) => (previous.restoredAt === null ? previous : { ...previous, restoredAt: null }))
  }, [])

  const draft = useMemo(() => ({
    dirty,
    restored: Boolean(state.restoredAt),
    savedAt: state.restoredAt,
    discard,
    clear,
    dismiss,
  }), [dirty, state.restoredAt, discard, clear, dismiss])

  return [state.value, setValue, draft]
}

function formatSavedAt(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const sameDay = new Date().toDateString() === date.toDateString()
  return date.toLocaleString('vi-VN', sameDay
    ? { hour: '2-digit', minute: '2-digit' }
    : { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })
}

/**
 * The banner a restored draft puts above its form, plus the quieter
 * "we are autosaving this" line once the user starts typing.
 */
export function DraftNotice({ draft, label = 'nội dung đang soạn dở', className = '' }) {
  if (!draft) return null

  if (draft.restored) {
    const at = formatSavedAt(draft.savedAt)
    return (
      <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-gold/35 bg-gold/10 px-3 py-2 text-xs text-ink/75 ${className}`}>
        <span className="font-semibold text-[#9A6B12]">Đã khôi phục bản nháp</span>
        <span className="flex-1 min-w-[12rem]">
          {label.charAt(0).toUpperCase() + label.slice(1)} từ lần trước{at ? ` (lưu lúc ${at})` : ''} đã được điền lại.
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={draft.dismiss}
            className="rounded-md border border-stone bg-white px-2.5 py-1 font-semibold text-ink/70 transition hover:bg-paper"
          >
            Tiếp tục
          </button>
          <button
            type="button"
            onClick={draft.discard}
            className="rounded-md border border-clay/30 px-2.5 py-1 font-semibold text-clay transition hover:bg-clay/10"
          >
            Bỏ nháp
          </button>
        </span>
      </div>
    )
  }

  if (!draft.dirty) return null

  return (
    <p className={`flex items-center gap-1.5 text-[11px] text-ink/40 ${className}`}>
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-trail/60" aria-hidden="true" />
      Thay đổi được lưu nháp trên máy này — tải lại trang cũng không mất.
    </p>
  )
}
