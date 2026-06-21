import { FIXED_PHASES } from './adminProgram.js'

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://10.147.17.251:8080/api'

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

export function redirectByRole(role) {
  if (role === 'admin') {
    window.location.replace('/admin')
    return
  }
  if (role === 'collab') {
    window.location.replace('/checkin')
    return
  }
  window.location.replace('/participant')
}

export function logoutAndRedirect(path = '/') {
  clearStoredSession()
  window.location.replace(path)
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
    const error = new Error(
      typeof payload === 'object' && payload?.error
        ? payload.error
        : `request_failed_${response.status}`,
    )
    error.status = response.status
    error.data = payload
    throw error
  }

  return payload
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
          })),
        ]
      }),
    ),
  }
}
