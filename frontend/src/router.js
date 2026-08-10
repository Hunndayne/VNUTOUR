// A tiny history-based router.
//
// Every screen used to render at `/`: the sidebar swapped a `useState` tab and
// the URL never moved, so a reload always dropped the user back on the overview
// and the browser's back button walked out of the app. Each screen now owns a
// real URL — this module is the shared plumbing for reading and changing it.
//
// `popstate` only fires for back/forward, so `navigate()` announces its own
// pushes on a custom event that `useLocation` listens to as well.

import { useCallback, useEffect, useMemo, useState } from 'react'

const NAVIGATION_EVENT = 'vnutour:navigation'

function readLocation() {
  if (typeof window === 'undefined') {
    return { path: '/', search: '', hash: '' }
  }
  return {
    // Trailing slashes are stripped so `/admin/teams/` and `/admin/teams`
    // are the same route; `/` survives as itself.
    path: window.location.pathname.replace(/\/+$/, '') || '/',
    search: window.location.search,
    hash: window.location.hash,
  }
}

/** The full path + query + hash, i.e. what `navigate()` compares against. */
export function currentUrl() {
  if (typeof window === 'undefined') return '/'
  return `${window.location.pathname}${window.location.search}${window.location.hash}`
}

export function currentPath() {
  return readLocation().path
}

/**
 * Move to `to` without a page load. `replace: true` overwrites the current
 * entry — use it for redirects and for syncing state into the URL, so the back
 * button does not have to walk through corrections the user never made.
 */
export function navigate(to, { replace = false } = {}) {
  if (typeof window === 'undefined') return
  const target = String(to || '/')
  if (target === currentUrl()) return
  window.history[replace ? 'replaceState' : 'pushState'](null, '', target)
  window.dispatchEvent(new Event(NAVIGATION_EVENT))
}

/** Build `/path?a=1` from a path and a plain object; empty values are dropped. */
export function buildUrl(path, params = {}) {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') return
    query.set(key, String(value))
  })
  const suffix = query.toString()
  return suffix ? `${path}?${suffix}` : path
}

/** `{ path, search, hash }`, re-rendering on every navigation. */
export function useLocation() {
  const [location, setLocation] = useState(readLocation)

  useEffect(() => {
    const sync = () => {
      setLocation((previous) => {
        const next = readLocation()
        // Returning the previous object when nothing moved keeps a redirect
        // that lands where it already is from looping.
        return previous.path === next.path
          && previous.search === next.search
          && previous.hash === next.hash
          ? previous
          : next
      })
    }
    // A navigation can happen between the first render and this effect.
    sync()
    window.addEventListener('popstate', sync)
    window.addEventListener(NAVIGATION_EVENT, sync)
    return () => {
      window.removeEventListener('popstate', sync)
      window.removeEventListener(NAVIGATION_EVENT, sync)
    }
  }, [])

  return location
}

/** `/admin/teams` → `['admin', 'teams']`. */
export function useRouteSegments() {
  const { path } = useLocation()
  return useMemo(() => path.split('/').filter(Boolean), [path])
}

/**
 * A query-string parameter driven like `useState`, so the sub-tab or open
 * drawer survives a reload. The parameter is dropped from the URL when it
 * equals `fallback`, which keeps the common case a clean path.
 *
 * `setValue(next, { replace: true })` when the change is the page syncing
 * itself rather than the user choosing something.
 */
export function useSearchParam(key, fallback = '') {
  const { search } = useLocation()
  const raw = useMemo(() => new URLSearchParams(search).get(key), [search, key])
  const value = raw === null ? fallback : raw

  const setValue = useCallback((next, { replace = false } = {}) => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    // Read the parameter back out of the URL rather than closing over it, so
    // `setValue(previous => !previous)` works the way `useState` would and two
    // updates in the same tick cannot clobber each other.
    const previousRaw = params.get(key)
    const previous = previousRaw === null ? fallback : previousRaw
    const resolved = typeof next === 'function' ? next(previous) : next
    const normalized = resolved === null || resolved === undefined ? '' : String(resolved)
    if (!normalized || normalized === String(fallback)) {
      params.delete(key)
    } else {
      params.set(key, normalized)
    }
    const query = params.toString()
    navigate(`${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`, { replace })
  }, [key, fallback])

  return [value, setValue]
}

/**
 * Same as `useSearchParam`, but anything outside `allowed` reads back as
 * `fallback` — a hand-edited `?view=nonsense` shows the default tab rather
 * than a blank panel.
 */
export function useEnumSearchParam(key, allowed, fallback = allowed[0]) {
  const [raw, setRaw] = useSearchParam(key, fallback)
  const value = allowed.includes(raw) ? raw : fallback
  return [value, setRaw]
}
