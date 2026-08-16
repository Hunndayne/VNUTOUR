import { useEffect, useRef } from 'react'

const SCRIPT_ID = 'cf-turnstile-script'
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

let scriptPromise = null

function loadTurnstile() {
  if (typeof window === 'undefined') return Promise.reject(new Error('no-window'))
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.id = SCRIPT_ID
      script.src = SCRIPT_SRC
      script.async = true
      script.defer = true
      script.onload = () => resolve(window.turnstile)
      script.onerror = () => {
        scriptPromise = null
        reject(new Error('turnstile_script_failed'))
      }
      document.head.appendChild(script)
    })
  }
  return scriptPromise
}

/**
 * Widget Cloudflare Turnstile. Token chỉ dùng được một lần — sau một lần
 * submit bị từ chối, caller bump `resetSignal` (state number tăng dần) để
 * widget sinh token mới cho lần thử kế tiếp.
 */
export function TurnstileWidget({ siteKey, onToken, onError, resetSignal = 0 }) {
  const containerRef = useRef(null)
  const widgetIdRef = useRef(null)
  const onTokenRef = useRef(onToken)
  const onErrorRef = useRef(onError)
  onTokenRef.current = onToken
  onErrorRef.current = onError

  useEffect(() => {
    let cancelled = false
    loadTurnstile().then((turnstile) => {
      if (cancelled || !containerRef.current) return
      widgetIdRef.current = turnstile.render(containerRef.current, {
        sitekey: siteKey,
        callback: (token) => onTokenRef.current?.(token),
        'error-callback': (code) => onErrorRef.current?.(code || 'turnstile_error'),
        'expired-callback': () => onTokenRef.current?.(''),
        theme: 'auto',
      })
    }).catch(() => onErrorRef.current?.('turnstile_script_failed'))
    return () => {
      cancelled = true
      if (widgetIdRef.current != null && window.turnstile?.remove) {
        try { window.turnstile.remove(widgetIdRef.current) } catch { /* widget đã bị dọn */ }
        widgetIdRef.current = null
      }
    }
  }, [siteKey])

  useEffect(() => {
    if (resetSignal > 0 && widgetIdRef.current != null && window.turnstile) {
      try { window.turnstile.reset(widgetIdRef.current) } catch { /* noop */ }
    }
  }, [resetSignal])

  return <div ref={containerRef} />
}

/** Honeypot — trường ẩn người thật không bao giờ thấy, bot thường tự điền. */
export function HoneypotField({ value, onChange }) {
  return (
    <div aria-hidden="true" className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden">
      <label>
        Company
        <input
          type="text"
          name="company"
          tabIndex={-1}
          autoComplete="off"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
    </div>
  )
}
