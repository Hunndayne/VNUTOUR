import { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon, CARD } from './ui.jsx'
import { apiRequest, getStoredUser, logoutAndRedirect } from './api.js'
import { useDraftState, DraftNotice } from './drafts.jsx'

const RECIPIENT_OPTIONS = [
  { value: 'all', label: 'Tất cả tài khoản', desc: 'Gửi đến mọi tài khoản đang hoạt động' },
  { value: 'participant', label: 'Thí sinh', desc: 'Tài khoản có vai trò participant' },
  { value: 'collab', label: 'Cộng tác viên', desc: 'Tài khoản có vai trò collab' },
  { value: 'admin', label: 'Quản trị viên', desc: 'Tài khoản có vai trò admin' },
  { value: 'specific', label: 'Chỉ định cụ thể', desc: 'Chọn từng tài khoản trong danh sách' },
]

const PLACEHOLDER_KEYS = ['{{ten}}', '{{name}}', '{{full_name}}', '{{ho_ten}}', '{{email}}', '{{username}}', '{{role}}']

// Everything the admin is composing lives in one draft object so a single
// `useDraftState` call autosaves the whole email — subject, body, recipients,
// mode — instead of juggling seven independent localStorage writes.
const EMPTY_COMPOSE = {
  recipientType: 'all',
  selectedUsernames: [],
  externalEmails: '',
  ccEmails: '',
  bccEmails: '',
  subject: '',
  htmlBody: '',
  isHtmlMode: true,
}

function explainApiError(error) {
  if (error?.data?.error === 'smtp_not_configured') return 'Máy chủ chưa được cấu hình SMTP.'
  if (error?.data?.error === 'no_recipients') return 'Không có người nhận nào.'
  if (error?.data?.error === 'subject_required') return 'Vui lòng nhập tiêu đề email.'
  if (error?.data?.error === 'html_body_required') return 'Vui lòng nhập nội dung email.'
  if (error?.status === 400) return 'Dữ liệu gửi lên không hợp lệ.'
  if (error?.status === 403) return 'Bạn không có quyền thực hiện hành động này.'
  if (error?.status === 500) return 'Lỗi máy chủ. Vui lòng thử lại sau.'
  return 'Có lỗi xảy ra. Vui lòng thử lại.'
}

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => HTML_ESCAPES[char])
}

/**
 * Fill the {{...}} placeholders from a recipient's record.
 *
 * `forHtml` escapes the substituted values — never the template. The admin's own
 * markup has to stay live for the preview to be worth anything, but a recipient's
 * name is data they typed themselves: left raw it becomes markup, and a name like
 * `<img src=x onerror=...>` would run script in whoever opens the preview.
 *
 * The replacements go through functions because a literal replacement string
 * treats `$&`, `$'` and friends as capture references, so a name containing `$&`
 * would come out mangled.
 */
function applyPreviewTemplate(source, preview, { forHtml = false } = {}) {
  const value = (key) => {
    const raw = String(preview?.[key] ?? '')
    return () => (forHtml ? escapeHtml(raw) : raw)
  }
  return String(source || '')
    .replaceAll('{{ten}}', value('name'))
    .replaceAll('{{name}}', value('name'))
    .replaceAll('{{full_name}}', value('name'))
    .replaceAll('{{ho_ten}}', value('name'))
    .replaceAll('{{email}}', value('email'))
    .replaceAll('{{username}}', value('username'))
    .replaceAll('{{role}}', value('role'))
}

export default function EmailPage() {
  const currentUser = useMemo(() => getStoredUser() || {}, [])
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [apiError, setApiError] = useState(null)
  const [compose, setCompose, draft] = useDraftState('email:compose', EMPTY_COMPOSE)
  const patchCompose = useCallback(
    (patch) => setCompose((current) => ({ ...current, ...patch })),
    [setCompose],
  )
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('')
  const [busy, setBusy] = useState(null)
  const [result, setResult] = useState(null)
  const [recipientCounts, setRecipientCounts] = useState({ all: 0, admin: 0, collab: 0, participant: 0, inactive: 0 })

  const loadAccounts = useCallback(async () => {
    const params = new URLSearchParams({ limit: compose.recipientType === 'specific' ? '100' : '1', active: '1' })
    if (compose.recipientType !== 'all' && compose.recipientType !== 'specific') {
      params.set('role', compose.recipientType)
    }
    if (compose.recipientType === 'specific' && debouncedSearchQuery.trim()) {
      params.set('q', debouncedSearchQuery.trim())
    }
    const payload = await apiRequest(`/admin/accounts?${params.toString()}`)
    setAccounts((payload.items || []).filter((item) => item.is_active !== false))
    setRecipientCounts(payload.counts || { all: 0, admin: 0, collab: 0, participant: 0, inactive: 0 })
  }, [compose.recipientType, debouncedSearchQuery])

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearchQuery(searchQuery), 250)
    return () => window.clearTimeout(timer)
  }, [searchQuery])

  useEffect(() => {
    let cancelled = false
    const bootstrap = async () => {
      try {
        setLoading(true)
        setApiError(null)
        await loadAccounts()
      } catch (error) {
        if (cancelled) return
        if (error?.status === 401) {
          logoutAndRedirect('/')
          return
        }
        setApiError(explainApiError(error))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void bootstrap()
    return () => { cancelled = true }
  }, [loadAccounts])

  const filteredAccounts = useMemo(() => accounts, [accounts])

  const estimatedRecipientCount = useMemo(() => {
    let count = 0
    if (compose.recipientType === 'specific') {
      count = compose.selectedUsernames.length
    } else if (compose.recipientType === 'all') {
      count = recipientCounts.all || 0
    } else {
      count = recipientCounts[compose.recipientType] || 0
    }
    count += [compose.externalEmails, compose.ccEmails, compose.bccEmails]
      .flatMap((value) => value.split(/[\n,;]/))
      .map((email) => email.trim())
      .filter(Boolean)
      .length
    return count
  }, [compose, recipientCounts])

  const personalizationPreview = useMemo(() => {
    const actorAccount = accounts.find((item) => item.username === currentUser?.username)
    const selectedAccount = compose.recipientType === 'specific'
      ? accounts.find((item) => compose.selectedUsernames.includes(item.username))
      : accounts.find((item) => (compose.recipientType === 'all' ? true : item.role === compose.recipientType))
    const account = selectedAccount || actorAccount

    return {
      name: account?.full_name || currentUser?.full_name || currentUser?.username || 'Admin',
      email: account?.email || currentUser?.email || 'admin@example.com',
      username: account?.username || currentUser?.username || 'admin',
      role: account?.role || currentUser?.role || 'admin',
    }
  }, [accounts, currentUser, compose.recipientType, compose.selectedUsernames])

  // Rendered inside a sandboxed iframe rather than into this document. Escaping
  // the placeholder values already stops the injection, but the sandbox is what
  // keeps it stopped: nothing in here can reach localStorage or the admin
  // session even if the body later grows another untrusted source. No mail
  // client runs scripts either, so blocking them makes the preview truer, not
  // weaker.
  const previewDocument = useMemo(() => {
    const body = compose.isHtmlMode
      ? applyPreviewTemplate(compose.htmlBody, personalizationPreview, { forHtml: true })
      : `<pre>${escapeHtml(applyPreviewTemplate(compose.htmlBody, personalizationPreview))}</pre>`
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      body { margin: 0; padding: 12px; font: 14px/1.5 Inter, system-ui, sans-serif; color: #20312B; }
      pre { margin: 0; white-space: pre-wrap; font: inherit; }
      h1 { font-size: 1.125rem; } h2 { font-size: 1rem; }
      a { color: #B8860B; }
      img { max-width: 100%; }
    </style></head><body>${body}</body></html>`
  }, [compose.htmlBody, compose.isHtmlMode, personalizationPreview])

  const handleSend = useCallback(async () => {
    const parseEmails = (value) => value.split(/[\n,;]/).map((email) => email.trim()).filter(Boolean)
    const extEmails = parseEmails(compose.externalEmails)
    const ccList = parseEmails(compose.ccEmails)
    const bccList = parseEmails(compose.bccEmails)
    if (!compose.subject.trim()) {
      setApiError('Vui lòng nhập tiêu đề email.')
      return
    }
    if (!compose.htmlBody.trim()) {
      setApiError('Vui lòng nhập nội dung email.')
      return
    }
    if (estimatedRecipientCount === 0) {
      setApiError('Không có người nhận nào.')
      return
    }
    if (!window.confirm(`Bạn có chắc muốn gửi email đến ${estimatedRecipientCount} người nhận?`)) return

    setBusy('send')
    setApiError(null)
    setResult(null)

    try {
      const response = await apiRequest('/admin/send-email', {
        method: 'POST',
        body: {
          recipient_type: compose.recipientType,
          usernames: compose.recipientType === 'specific' ? compose.selectedUsernames : [],
          to_emails: extEmails,
          cc_emails: ccList,
          bcc_emails: bccList,
          subject: compose.subject.trim(),
          // "Văn bản thường" has to mean it: escape before wrapping, or a typed
          // `<b>` (or a pasted tag) silently becomes live markup in the email.
          // The {{...}} placeholders survive escaping and are filled server-side.
          html_body: compose.isHtmlMode ? compose.htmlBody.trim() : `<pre>${escapeHtml(compose.htmlBody.trim())}</pre>`,
        },
      })
      setResult(response)
      // Only a successful queue drops the draft — a failed send must leave the
      // typed email exactly as it was so the admin can fix and retry.
      draft.clear()
    } catch (error) {
      if (error?.status === 401) {
        logoutAndRedirect('/')
        return
      }
      setApiError(explainApiError(error))
    } finally {
      setBusy(null)
    }
  }, [compose, draft, estimatedRecipientCount])

  const toggleUsername = (username) => {
    patchCompose({
      selectedUsernames: compose.selectedUsernames.includes(username)
        ? compose.selectedUsernames.filter((item) => item !== username)
        : [...compose.selectedUsernames, username],
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-gold border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {apiError && (
        <div className={`${CARD} border-clay/20 bg-clay/10 px-4 py-3 text-sm text-clay`}>
          {apiError}
        </div>
      )}

      {result && (
        <div className={`${CARD} border-trail/20 bg-trail/10 px-4 py-3 text-sm text-trail`}>
          Đã xếp hàng {result.queued} email{result.personalized
            ? ` cá nhân hóa, cách nhau ${result.interval_seconds || 10} giây.`
            : '.'}
        </div>
      )}

      <div className={CARD}>
        <div className="border-b border-stone px-5 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Icon name="users" className="h-4 w-4" />
            Người nhận
          </h2>
        </div>
        <div className="space-y-4 px-5 py-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {RECIPIENT_OPTIONS.map((option) => (
              <label
                key={option.value}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition ${
                  compose.recipientType === option.value
                    ? 'border-gold bg-gold/5'
                    : 'border-stone bg-white hover:border-ink/20'
                }`}
              >
                <input
                  type="radio"
                  name="recipientType"
                  value={option.value}
                  checked={compose.recipientType === option.value}
                  onChange={() => patchCompose({ recipientType: option.value })}
                  className="mt-0.5 accent-gold"
                />
                <div>
                  <div className="text-sm font-medium text-ink">{option.label}</div>
                  <div className="text-xs text-ink/55">{option.desc}</div>
                </div>
              </label>
            ))}
          </div>

          {compose.recipientType === 'specific' && (
            <div className="space-y-3 rounded-lg border border-stone p-4">
              <div className="flex items-center gap-3">
                <div className="relative flex-1">
                  <Icon name="search" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/40" />
                  <input
                    type="text"
                    placeholder="Tìm kiếm theo tên, email, username..."
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    className="w-full rounded-lg border border-stone bg-white py-2 pl-9 pr-3 text-sm text-ink outline-none focus:border-gold"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => patchCompose({ selectedUsernames: filteredAccounts.map((account) => account.username) })}
                  className="rounded-lg border border-stone px-3 py-2 text-xs text-ink/60 hover:bg-stone/30"
                >
                  Chọn tất cả
                </button>
                <button
                  type="button"
                  onClick={() => patchCompose({ selectedUsernames: [] })}
                  className="rounded-lg border border-stone px-3 py-2 text-xs text-ink/60 hover:bg-stone/30"
                >
                  Bỏ chọn
                </button>
              </div>

              <div className="max-h-60 space-y-1 overflow-y-auto">
                {filteredAccounts.map((account) => (
                  <label
                    key={account.username}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                      compose.selectedUsernames.includes(account.username)
                        ? 'bg-gold/10 text-ink'
                        : 'text-ink/70 hover:bg-stone/30'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={compose.selectedUsernames.includes(account.username)}
                      onChange={() => toggleUsername(account.username)}
                      className="accent-gold"
                    />
                    <span className="font-medium">{account.full_name || account.username}</span>
                    <span className="text-xs text-ink/40">{account.email}</span>
                    <span className="ml-auto text-xs text-ink/40">{account.role}</span>
                  </label>
                ))}
                {filteredAccounts.length === 0 && (
                  <p className="py-4 text-center text-sm text-ink/40">Không tìm thấy tài khoản nào.</p>
                )}
              </div>
              <div className="text-xs text-ink/40">Đã chọn {compose.selectedUsernames.length} tài khoản.</div>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-2">
            <label className="text-sm font-medium text-ink">
                To <span className="font-normal text-ink/40">(email nhập thêm)</span>
            </label>
            <textarea
                placeholder="to@example.com"
              value={compose.externalEmails}
              onChange={(event) => patchCompose({ externalEmails: event.target.value })}
              rows={3}
              className="w-full resize-none rounded-lg border border-stone bg-white px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/30 focus:border-gold"
            />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-ink">CC</label>
              <textarea
                placeholder="cc@example.com"
                value={compose.ccEmails}
                onChange={(event) => patchCompose({ ccEmails: event.target.value })}
                rows={3}
                className="w-full resize-none rounded-lg border border-stone bg-white px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/30 focus:border-gold"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-ink">BCC</label>
              <textarea
                placeholder="bcc@example.com"
                value={compose.bccEmails}
                onChange={(event) => patchCompose({ bccEmails: event.target.value })}
                rows={3}
                className="w-full resize-none rounded-lg border border-stone bg-white px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/30 focus:border-gold"
              />
            </div>
          </div>
          <p className="text-xs leading-5 text-ink/45">
            Email dùng biến cá nhân hóa sẽ được tách thành từng thư và đưa vào queue có khoảng nghỉ để tránh gửi dồn.
            CC/BCC sẽ được gắn vào từng thư cá nhân hóa.
          </p>
        </div>
      </div>

      <div className={CARD}>
        <div className="border-b border-stone px-5 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Icon name="doc" className="h-4 w-4" />
            Soạn email
          </h2>
        </div>
        <div className="space-y-4 px-5 py-4">
          <DraftNotice draft={draft} label="email đang soạn" />

          <div>
            <label className="text-sm font-medium text-ink">Tiêu đề</label>
            <input
              type="text"
              placeholder="Nhập tiêu đề email..."
              value={compose.subject}
              onChange={(event) => patchCompose({ subject: event.target.value })}
              className="mt-1 w-full rounded-lg border border-stone bg-white px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/30 focus:border-gold"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-ink/60">Chế độ soạn thảo:</span>
            <button
              type="button"
              onClick={() => patchCompose({ isHtmlMode: true })}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                compose.isHtmlMode ? 'bg-gold text-white' : 'border border-stone text-ink/55 hover:bg-stone/30'
              }`}
            >
              HTML
            </button>
            <button
              type="button"
              onClick={() => patchCompose({ isHtmlMode: false })}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                !compose.isHtmlMode ? 'bg-gold text-white' : 'border border-stone text-ink/55 hover:bg-stone/30'
              }`}
            >
              Văn bản thường
            </button>
            {compose.isHtmlMode && (
              <span className="text-xs text-ink/40">
                Có thể dùng thẻ HTML và placeholder cá nhân hóa.
              </span>
            )}
          </div>

          <div className="rounded-lg border border-stone bg-paper px-4 py-3 text-sm text-ink/70">
            <p className="font-medium text-ink">Biến cá nhân hóa</p>
            <p className="mt-1 text-xs leading-5 text-ink/50">
              Dùng trong tiêu đề hoặc nội dung: {PLACEHOLDER_KEYS.map((item) => (
                <code key={item} className="mr-2">{item}</code>
              ))}
            </p>
            <p className="mt-2 text-xs text-ink/45">
              Ví dụ: <code>{'Chúc mừng {{ten}}!'}</code>
            </p>
          </div>

          <div>
            <label className="text-sm font-medium text-ink">
              Nội dung {compose.isHtmlMode ? '(HTML)' : '(văn bản thường)'}
            </label>
            <textarea
              placeholder={compose.isHtmlMode
                ? '<h1>Chúc mừng {{ten}}</h1><p>Nội dung email...</p>'
                : 'Nhập nội dung email...'}
              value={compose.htmlBody}
              onChange={(event) => patchCompose({ htmlBody: event.target.value })}
              rows={14}
              className="mt-1 w-full resize-y rounded-lg border border-stone bg-white px-3 py-2 font-mono text-sm text-ink outline-none placeholder:text-ink/30 focus:border-gold"
              style={compose.isHtmlMode ? undefined : { fontFamily: 'inherit' }}
            />
          </div>

          <div className="rounded-lg border border-stone bg-white">
            <div className="border-b border-stone px-4 py-3">
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-ink/35">Preview</p>
              <p className="mt-1 text-xs text-ink/45">
                Đang xem thử với dữ liệu của: <span className="font-medium text-ink">{personalizationPreview.name}</span>
              </p>
            </div>

            <div className="space-y-4 px-4 py-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.12em] text-ink/35">Subject</p>
                <p className="mt-2 text-sm text-ink/70">
                  {compose.subject.trim()
                    ? applyPreviewTemplate(compose.subject, personalizationPreview)
                    : 'Chưa có tiêu đề để xem trước.'}
                </p>
              </div>

              <div>
                <p className="text-xs font-medium uppercase tracking-[0.12em] text-ink/35">Nội dung</p>
                {compose.htmlBody.trim() ? (
                  <iframe
                    title="Xem thử nội dung email"
                    sandbox=""
                    srcDoc={previewDocument}
                    className="mt-2 h-72 w-full rounded-lg border border-stone bg-paper"
                  />
                ) : (
                  <p className="mt-2 text-sm text-ink/45">Chưa có nội dung để xem trước.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className={`${CARD} flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between`}>
        <div>
          <div className="text-sm text-ink/55">
            {estimatedRecipientCount > 0
              ? `Sẽ gửi đến ${estimatedRecipientCount} người nhận`
              : 'Chưa có người nhận nào được chọn'}
          </div>
          {apiError && (
            <div className="mt-2 text-sm font-medium text-clay">
              {apiError}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={handleSend}
          disabled={busy === 'send'}
          className={`flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white transition ${
            busy === 'send'
              ? 'cursor-not-allowed bg-gold/60'
              : 'bg-gold hover:bg-gold/90 active:scale-[0.97]'
          }`}
        >
          {busy === 'send' ? (
            <>
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              Đang xếp hàng...
            </>
          ) : (
            <>
              <Icon name="mail" className="h-4 w-4" />
              Xếp hàng gửi email
            </>
          )}
        </button>
      </div>
    </div>
  )
}
