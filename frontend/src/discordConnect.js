import { useCallback, useEffect, useState } from 'react'
import { apiRequest, logoutAndRedirect } from './api.js'
import { navigate } from './router.js'

// Shared plumbing for the Discord "Connect" flow, used by both the onboarding
// card on the participant dashboard and the compact row in account settings.
// The scope is identify only; a participant must join the server themselves.

const STATE_KEY = 'discord_oauth_state'
const REDIRECT_KEY = 'discord_oauth_redirect'
// Where to return after the OAuth round-trip. The participant dashboard reads
// this on load to reopen Settings when the flow was started from there.
export const DISCORD_RETURN_KEY = 'discord_oauth_return'

export const DISCORD_ERROR_MESSAGES = {
  discord_oauth_not_configured: 'Tính năng kết nối Discord chưa được bật trên máy chủ.',
  redirect_uri_not_allowed: 'Địa chỉ chuyển hướng chưa được đăng ký. Báo BTC để kiểm tra cấu hình.',
  invalid_code: 'Phiên kết nối đã hết hạn hoặc không hợp lệ. Vui lòng thử lại.',
  missing_fields: 'Thiếu dữ liệu kết nối. Vui lòng thử lại.',
  discord_unreachable: 'Không liên lạc được với Discord. Thử lại sau ít phút.',
  discord_user_fetch_failed: 'Không đọc được tài khoản Discord. Vui lòng thử lại.',
  discord_already_linked_other: 'Tài khoản Discord này đã được gắn với một hồ sơ khác.',
  discord_already_linked_self: 'Bạn đã kết nối một tài khoản Discord khác. Hãy huỷ liên kết rồi kết nối lại.',
  participant_not_found: 'Bạn cần hoàn tất hồ sơ thí sinh trước khi kết nối Discord.',
  state_mismatch: 'Phiên kết nối không khớp, có thể do mở nhiều tab. Vui lòng thử lại.',
}

export function explainDiscordError(error) {
  const code = error?.data?.error || error?.message
  return DISCORD_ERROR_MESSAGES[code] || 'Không thể kết nối Discord. Vui lòng thử lại.'
}

function randomState() {
  const bytes = new Uint8Array(16)
  window.crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function redirectUri() {
  return `${window.location.origin}/participant`
}

export function useDiscordConnect() {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const loadStatus = useCallback(async () => {
    const payload = await apiRequest('/auth/me/discord/status')
    setStatus(payload)
    return payload
  }, [])

  // On mount: finish an OAuth round-trip if we came back with ?code=&state=,
  // then scrub the query so a reload cannot re-post a spent code. Removing the
  // pending state synchronously (before the first await) makes this idempotent
  // even if two hook instances ever mounted at once.
  useEffect(() => {
    let cancelled = false

    const run = async () => {
      const params = new URLSearchParams(window.location.search)
      const code = params.get('code')
      const oauthError = params.get('error')
      const returnedState = params.get('state')
      const pendingState = window.sessionStorage.getItem(STATE_KEY)
      const isCallback = Boolean(code && returnedState && pendingState)
      const isDenied = Boolean(oauthError && pendingState && returnedState === pendingState)

      try {
        if (isDenied) {
          window.sessionStorage.removeItem(STATE_KEY)
          window.sessionStorage.removeItem(REDIRECT_KEY)
          navigate('/participant', { replace: true })
          if (!cancelled) setError('Bạn đã huỷ kết nối Discord. Có thể thử lại bất cứ lúc nào.')
        } else if (isCallback) {
          const usedRedirect = window.sessionStorage.getItem(REDIRECT_KEY) || redirectUri()
          window.sessionStorage.removeItem(STATE_KEY)
          window.sessionStorage.removeItem(REDIRECT_KEY)
          navigate('/participant', { replace: true })

          if (returnedState !== pendingState) {
            if (!cancelled) setError(DISCORD_ERROR_MESSAGES.state_mismatch)
          } else {
            const result = await apiRequest('/auth/me/discord', {
              method: 'POST',
              body: { code, redirect_uri: usedRedirect },
            })
            if (!cancelled) {
              setNotice(
                result?.discord_username
                  ? `Đã kết nối với @${result.discord_username}.`
                  : 'Đã kết nối Discord.',
              )
            }
          }
        }
        await loadStatus()
      } catch (err) {
        if (cancelled) return
        if (err?.status === 401) { logoutAndRedirect('/'); return }
        setError(explainDiscordError(err))
        try { await loadStatus() } catch { /* leave status null */ }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    run()
    return () => { cancelled = true }
  }, [loadStatus])

  // returnTo is stashed so the dashboard can reopen the right view afterwards.
  const connect = useCallback((returnTo) => {
    const oauth = status?.oauth
    if (!oauth?.configured || !oauth?.client_id) {
      setError(DISCORD_ERROR_MESSAGES.discord_oauth_not_configured)
      return
    }
    const state = randomState()
    const redirect = redirectUri()
    window.sessionStorage.setItem(STATE_KEY, state)
    window.sessionStorage.setItem(REDIRECT_KEY, redirect)
    if (returnTo) window.sessionStorage.setItem(DISCORD_RETURN_KEY, returnTo)
    else window.sessionStorage.removeItem(DISCORD_RETURN_KEY)

    const url = new URL('https://discord.com/oauth2/authorize')
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('client_id', oauth.client_id)
    url.searchParams.set('scope', oauth.scope || 'identify')
    url.searchParams.set('state', state)
    url.searchParams.set('redirect_uri', redirect)
    // Fresh consent each time, so someone signed into the wrong Discord account
    // in this browser can notice before linking it.
    url.searchParams.set('prompt', 'consent')
    window.location.assign(url.toString())
  }, [status])

  const unlink = useCallback(async () => {
    setBusy('unlink'); setError(''); setNotice('')
    try {
      await apiRequest('/auth/me/discord', { method: 'DELETE' })
      await loadStatus()
      setNotice('Đã huỷ liên kết Discord.')
    } catch (err) {
      if (err?.status === 401) { logoutAndRedirect('/'); return }
      setError(explainDiscordError(err))
    } finally {
      setBusy('')
    }
  }, [loadStatus])

  // Connecting a new account never overwrites an existing link server-side, so
  // reconnecting means releasing the current one first — the old account's link
  // is cancelled, then the new one is authorized.
  const reconnect = useCallback(async (returnTo) => {
    setBusy('reconnect'); setError(''); setNotice('')
    try {
      await apiRequest('/auth/me/discord', { method: 'DELETE' })
    } catch (err) {
      if (err?.status === 401) { logoutAndRedirect('/'); return }
      setError(explainDiscordError(err))
      setBusy('')
      return
    }
    connect(returnTo)
  }, [connect])

  return { status, loading, busy, error, notice, connect, unlink, reconnect }
}
