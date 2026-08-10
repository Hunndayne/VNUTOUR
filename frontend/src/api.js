import { FIXED_PHASES } from './adminProgram.js'
import { clearAllDrafts } from './drafts.jsx'

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL

if (!API_BASE_URL) {
  throw new Error('missing_vite_api_base_url')
}

const AUTH_TOKEN_KEY = 'authToken'
const USER_KEY = 'user'

function joinUrl(base, path) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${base.replace(/\/+$/, '')}${normalizedPath}`
}

export function getStoredAuthToken() {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(AUTH_TOKEN_KEY)
}

export function getStoredUser() {
  if (typeof window === 'undefined') return null
  try {
    return JSON.parse(window.localStorage.getItem(USER_KEY) || 'null')
  } catch {
    return null
  }
}

export function setStoredSession(token, user) {
  if (typeof window === 'undefined') return
  if (token) {
    window.localStorage.setItem(AUTH_TOKEN_KEY, token)
  }
  if (user) {
    window.localStorage.setItem(USER_KEY, JSON.stringify(user))
  }
}

export function clearStoredSession() {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(AUTH_TOKEN_KEY)
  window.localStorage.removeItem(USER_KEY)
}

export const ROLE_MASTER_ADMIN = 'master_admin'
export const ROLE_ADMIN = 'admin'

/** Master admins are admins too — every admin screen stays open to them. */
export function isAdminRole(role) {
  return role === ROLE_ADMIN || role === ROLE_MASTER_ADMIN
}

/**
 * Only a master admin may reshape the programme: the current phase, the phase
 * calendar, sub-events and stations. The backend enforces this on its own and
 * answers 403 `master_admin_required`; the flag exists so the UI can disable
 * those controls instead of letting an admin click into a refusal.
 */
export function isMasterAdmin(user = getStoredUser()) {
  return user?.role === ROLE_MASTER_ADMIN
}

/**
 * Where each role lands after signing in. Every screen has its own URL now, so
 * "home" is a real path per role rather than `/` deciding what to render.
 */
export const ROLE_HOME_PATHS = {
  [ROLE_MASTER_ADMIN]: '/admin',
  [ROLE_ADMIN]: '/admin',
  collab: '/coop',
  participant: '/participant',
}

export function roleHomePath(role) {
  return ROLE_HOME_PATHS[role] || '/'
}

export function redirectToRoot() {
  window.location.replace('/')
}

export function redirectByRole(role) {
  window.location.replace(roleHomePath(role))
}

export function logoutAndRedirect(path = '/') {
  clearStoredSession()
  // Locally autosaved edits belong to the account that typed them — leaving
  // them behind would hand the next person to sign in on this machine a
  // half-written email or a stranger's profile.
  clearAllDrafts()
  window.location.replace(path)
}

export function isSessionAuthError(error) {
  const code = error?.data?.error || error?.message
  return error?.status === 401 && ['missing_token', 'invalid_token'].includes(code)
}

export async function apiRequest(path, options = {}) {
  const {
    method = 'GET',
    body,
    token,
    auth = true,
    headers = {},
  } = options

  const requestHeaders = { ...headers }
  const authToken = token ?? getStoredAuthToken()

  if (body !== undefined && !(body instanceof FormData)) {
    requestHeaders['Content-Type'] = requestHeaders['Content-Type'] || 'application/json'
  }

  if (auth && authToken) {
    requestHeaders.Authorization = requestHeaders.Authorization || `Bearer ${authToken}`
  }

  const response = await fetch(joinUrl(API_BASE_URL, path), {
    method,
    headers: requestHeaders,
    body: body === undefined
      ? undefined
      : body instanceof FormData
        ? body
        : JSON.stringify(body),
  })

  const rawText = await response.text()
  let payload = null

  if (rawText) {
    try {
      payload = JSON.parse(rawText)
    } catch {
      payload = rawText
    }
  }

  if (!response.ok) {
    const code = typeof payload === 'object' && payload?.error ? payload.error : null
    const sessionAuthFailure = response.status === 401 && ['missing_token', 'invalid_token'].includes(code)
    const error = new Error(
      code
        ? code
        : `request_failed_${response.status}`,
    )
    error.status = sessionAuthFailure ? 401 : response.status === 401 ? 400 : response.status
    error.originalStatus = response.status
    error.data = payload
    throw error
  }

  return payload
}

export async function apiDownload(path, options = {}) {
  const authToken = options.token ?? getStoredAuthToken()
  const headers = { ...(options.headers || {}) }
  if (authToken) {
    headers.Authorization = headers.Authorization || `Bearer ${authToken}`
  }
  const response = await fetch(joinUrl(API_BASE_URL, path), {
    method: options.method || 'GET',
    headers,
    body: options.body,
  })
  if (!response.ok) {
    let payload = null
    try {
      payload = await response.json()
    } catch {
      payload = null
    }
    const error = new Error(payload?.error || `request_failed_${response.status}`)
    error.status = response.status
    error.data = payload
    throw error
  }
  const disposition = response.headers.get('Content-Disposition') || ''
  const filenameMatch = disposition.match(/filename="?([^";]+)"?/i)
  return {
    blob: await response.blob(),
    filename: filenameMatch?.[1] || 'download',
  }
}

export function formatApiDateToInput(value) {
  if (!value) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return String(value).slice(0, 10)
  }

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function formatDateTime(value) {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
  })
}

export function normalizeProgramForFrontend(programPayload = {}) {
  const phaseMap = new Map(
    (programPayload.phases || []).map(phase => [phase.key, phase]),
  )

  return {
    currentPhase: programPayload.current_phase || 'registration',
    currentSubEventId: programPayload.current_sub_event_id ? String(programPayload.current_sub_event_id) : '',
    phaseSchedule: Object.fromEntries(
      FIXED_PHASES.map((phaseInfo) => {
        const phase = phaseMap.get(phaseInfo.key)
        return [
          phaseInfo.key,
          {
            startDate: formatApiDateToInput(phase?.start_date),
            endDate: formatApiDateToInput(phase?.end_date),
          },
        ]
      }),
    ),
    subEventsByPhase: Object.fromEntries(
      FIXED_PHASES.map((phaseInfo) => {
        const phase = phaseMap.get(phaseInfo.key)
        return [
          phaseInfo.key,
          (phase?.sub_events || []).map((subEvent) => ({
            id: String(subEvent.id),
            name: subEvent.name || '',
            type: subEvent.type || 'custom',
            startDate: formatApiDateToInput(subEvent.start_date),
            endDate: formatApiDateToInput(subEvent.end_date),
            usesStations: Boolean(subEvent.uses_stations),
            note: subEvent.note || '',
            order: subEvent.order ?? 0,
            isCurrent: Boolean(subEvent.is_current),
          })),
        ]
      }),
    ),
  }
}
