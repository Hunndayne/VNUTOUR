import { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon, CARD } from './ui.jsx'
import { apiRequest, getStoredUser, logoutAndRedirect } from './api.js'

const RECIPIENT_OPTIONS = [
  { value: 'all', label: 'Tat ca tai khoan', desc: 'Gui den moi tai khoan dang hoat dong' },
  { value: 'participant', label: 'Thi sinh', desc: 'Tai khoan co vai tro participant' },
  { value: 'collab', label: 'Cong tac vien', desc: 'Tai khoan co vai tro collab' },
  { value: 'admin', label: 'Quan tri vien', desc: 'Tai khoan co vai tro admin' },
  { value: 'specific', label: 'Chi dinh cu the', desc: 'Chon tung tai khoan trong danh sach' },
]

const PLACEHOLDER_KEYS = ['{{ten}}', '{{name}}', '{{full_name}}', '{{ho_ten}}', '{{email}}', '{{username}}', '{{role}}']

function explainApiError(error) {
  if (error?.data?.error === 'smtp_not_configured') return 'May chu chua duoc cau hinh SMTP.'
  if (error?.data?.error === 'no_recipients') return 'Khong co nguoi nhan nao.'
  if (error?.data?.error === 'subject_required') return 'Vui long nhap tieu de email.'
  if (error?.data?.error === 'html_body_required') return 'Vui long nhap noi dung email.'
  if (error?.status === 400) return 'Du lieu gui len khong hop le.'
  if (error?.status === 403) return 'Ban khong co quyen thuc hien hanh dong nay.'
  if (error?.status === 500) return 'Loi may chu. Vui long thu lai sau.'
  return 'Co loi xay ra. Vui long thu lai.'
}

function applyPreviewTemplate(source, preview) {
  return String(source || '')
    .replaceAll('{{ten}}', preview.name)
    .replaceAll('{{name}}', preview.name)
    .replaceAll('{{full_name}}', preview.name)
    .replaceAll('{{ho_ten}}', preview.name)
    .replaceAll('{{email}}', preview.email)
    .replaceAll('{{username}}', preview.username)
    .replaceAll('{{role}}', preview.role)
}

export default function EmailPage() {
  const currentUser = useMemo(() => getStoredUser() || {}, [])
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [apiError, setApiError] = useState(null)
  const [recipientType, setRecipientType] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('')
  const [selectedUsernames, setSelectedUsernames] = useState([])
  const [externalEmails, setExternalEmails] = useState('')
  const [subject, setSubject] = useState('')
  const [htmlBody, setHtmlBody] = useState('')
  const [isHtmlMode, setIsHtmlMode] = useState(true)
  const [busy, setBusy] = useState(null)
  const [result, setResult] = useState(null)
  const [recipientCounts, setRecipientCounts] = useState({ all: 0, admin: 0, collab: 0, participant: 0, inactive: 0 })

  const loadAccounts = useCallback(async () => {
    const params = new URLSearchParams({ limit: recipientType === 'specific' ? '100' : '1', active: '1' })
    if (recipientType !== 'all' && recipientType !== 'specific') {
      params.set('role', recipientType)
    }
    if (recipientType === 'specific' && debouncedSearchQuery.trim()) {
      params.set('q', debouncedSearchQuery.trim())
    }
    const payload = await apiRequest(`/admin/accounts?${params.toString()}`)
    setAccounts((payload.items || []).filter((item) => item.is_active !== false))
    setRecipientCounts(payload.counts || { all: 0, admin: 0, collab: 0, participant: 0, inactive: 0 })
  }, [debouncedSearchQuery, recipientType])

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
    if (recipientType === 'specific') {
      count = selectedUsernames.length
    } else if (recipientType === 'all') {
      count = recipientCounts.all || 0
    } else {
      count = recipientCounts[recipientType] || 0
    }
    count += externalEmails.split(/[\n,]/).map((email) => email.trim()).filter(Boolean).length
    return count
  }, [externalEmails, recipientCounts, recipientType, selectedUsernames])

  const personalizationPreview = useMemo(() => {
    const actorAccount = accounts.find((item) => item.username === currentUser?.username)
    const selectedAccount = recipientType === 'specific'
      ? accounts.find((item) => selectedUsernames.includes(item.username))
      : accounts.find((item) => (recipientType === 'all' ? true : item.role === recipientType))
    const account = selectedAccount || actorAccount

    return {
      name: account?.full_name || currentUser?.full_name || currentUser?.username || 'Admin',
      email: account?.email || currentUser?.email || 'admin@example.com',
      username: account?.username || currentUser?.username || 'admin',
      role: account?.role || currentUser?.role || 'admin',
    }
  }, [accounts, currentUser, recipientType, selectedUsernames])

  const handleSend = useCallback(async () => {
    const extEmails = externalEmails.split(/[\n,]/).map((email) => email.trim()).filter(Boolean)
    if (!subject.trim()) {
      setApiError('Vui long nhap tieu de email.')
      return
    }
    if (!htmlBody.trim()) {
      setApiError('Vui long nhap noi dung email.')
      return
    }
    if (estimatedRecipientCount === 0) {
      setApiError('Khong co nguoi nhan nao.')
      return
    }
    if (!window.confirm(`Ban co chac muon gui email den ${estimatedRecipientCount} nguoi nhan?`)) return

    setBusy('send')
    setApiError(null)
    setResult(null)

    try {
      const response = await apiRequest('/admin/send-email', {
        method: 'POST',
        body: {
          recipient_type: recipientType,
          usernames: recipientType === 'specific' ? selectedUsernames : [],
          external_emails: extEmails,
          subject: subject.trim(),
          html_body: isHtmlMode ? htmlBody.trim() : `<pre>${htmlBody.trim()}</pre>`,
        },
      })
      setResult(response)
    } catch (error) {
      if (error?.status === 401) {
        logoutAndRedirect('/')
        return
      }
      setApiError(explainApiError(error))
    } finally {
      setBusy(null)
    }
  }, [estimatedRecipientCount, externalEmails, htmlBody, isHtmlMode, recipientType, selectedUsernames, subject])

  const toggleUsername = (username) => {
    setSelectedUsernames((current) => (
      current.includes(username)
        ? current.filter((item) => item !== username)
        : [...current, username]
    ))
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
          Da gui thanh cong {result.sent} / {result.recipients?.length || 0} email{result.personalized ? ' theo mau ca nhan hoa.' : '.'}
        </div>
      )}

      <div className={CARD}>
        <div className="border-b border-stone px-5 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Icon name="users" className="h-4 w-4" />
            Nguoi nhan
          </h2>
        </div>
        <div className="space-y-4 px-5 py-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {RECIPIENT_OPTIONS.map((option) => (
              <label
                key={option.value}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition ${
                  recipientType === option.value
                    ? 'border-gold bg-gold/5'
                    : 'border-stone bg-white hover:border-ink/20'
                }`}
              >
                <input
                  type="radio"
                  name="recipientType"
                  value={option.value}
                  checked={recipientType === option.value}
                  onChange={() => setRecipientType(option.value)}
                  className="mt-0.5 accent-gold"
                />
                <div>
                  <div className="text-sm font-medium text-ink">{option.label}</div>
                  <div className="text-xs text-ink/55">{option.desc}</div>
                </div>
              </label>
            ))}
          </div>

          {recipientType === 'specific' && (
            <div className="space-y-3 rounded-lg border border-stone p-4">
              <div className="flex items-center gap-3">
                <div className="relative flex-1">
                  <Icon name="search" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/40" />
                  <input
                    type="text"
                    placeholder="Tim kiem theo ten, email, username..."
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    className="w-full rounded-lg border border-stone bg-white py-2 pl-9 pr-3 text-sm text-ink outline-none focus:border-gold"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedUsernames(filteredAccounts.map((account) => account.username))}
                  className="rounded-lg border border-stone px-3 py-2 text-xs text-ink/60 hover:bg-stone/30"
                >
                  Chon tat ca
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedUsernames([])}
                  className="rounded-lg border border-stone px-3 py-2 text-xs text-ink/60 hover:bg-stone/30"
                >
                  Bo chon
                </button>
              </div>

              <div className="max-h-60 space-y-1 overflow-y-auto">
                {filteredAccounts.map((account) => (
                  <label
                    key={account.username}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                      selectedUsernames.includes(account.username)
                        ? 'bg-gold/10 text-ink'
                        : 'text-ink/70 hover:bg-stone/30'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedUsernames.includes(account.username)}
                      onChange={() => toggleUsername(account.username)}
                      className="accent-gold"
                    />
                    <span className="font-medium">{account.full_name || account.username}</span>
                    <span className="text-xs text-ink/40">{account.email}</span>
                    <span className="ml-auto text-xs text-ink/40">{account.role}</span>
                  </label>
                ))}
                {filteredAccounts.length === 0 && (
                  <p className="py-4 text-center text-sm text-ink/40">Khong tim thay tai khoan nao.</p>
                )}
              </div>
              <div className="text-xs text-ink/40">Da chon {selectedUsernames.length} tai khoan.</div>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium text-ink">
              Email ben ngoai <span className="font-normal text-ink/40">(khong co tai khoan trong he thong)</span>
            </label>
            <textarea
              placeholder="Nhap email, phan cach bang dau phay hoac xuong dong."
              value={externalEmails}
              onChange={(event) => setExternalEmails(event.target.value)}
              rows={3}
              className="w-full resize-none rounded-lg border border-stone bg-white px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/30 focus:border-gold"
            />
          </div>
        </div>
      </div>

      <div className={CARD}>
        <div className="border-b border-stone px-5 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Icon name="doc" className="h-4 w-4" />
            Soan email
          </h2>
        </div>
        <div className="space-y-4 px-5 py-4">
          <div>
            <label className="text-sm font-medium text-ink">Tieu de</label>
            <input
              type="text"
              placeholder="Nhap tieu de email..."
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              className="mt-1 w-full rounded-lg border border-stone bg-white px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/30 focus:border-gold"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-ink/60">Che do soan thao:</span>
            <button
              type="button"
              onClick={() => setIsHtmlMode(true)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                isHtmlMode ? 'bg-gold text-white' : 'border border-stone text-ink/55 hover:bg-stone/30'
              }`}
            >
              HTML
            </button>
            <button
              type="button"
              onClick={() => setIsHtmlMode(false)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                !isHtmlMode ? 'bg-gold text-white' : 'border border-stone text-ink/55 hover:bg-stone/30'
              }`}
            >
              Van ban thuong
            </button>
            {isHtmlMode && (
              <span className="text-xs text-ink/40">
                Co the dung the HTML va placeholder ca nhan hoa.
              </span>
            )}
          </div>

          <div className="rounded-lg border border-stone bg-paper px-4 py-3 text-sm text-ink/70">
            <p className="font-medium text-ink">Bien ca nhan hoa</p>
            <p className="mt-1 text-xs leading-5 text-ink/50">
              Dung trong tieu de hoac noi dung: {PLACEHOLDER_KEYS.map((item) => (
                <code key={item} className="mr-2">{item}</code>
              ))}
            </p>
            <p className="mt-2 text-xs text-ink/45">
              Vi du: <code>{'Chuc mung {{ten}}!'}</code>
            </p>
          </div>

          <div>
            <label className="text-sm font-medium text-ink">
              Noi dung {isHtmlMode ? '(HTML)' : '(van ban thuong)'}
            </label>
            <textarea
              placeholder={isHtmlMode
                ? '<h1>Chuc mung {{ten}}</h1><p>Noi dung email...</p>'
                : 'Nhap noi dung email...'}
              value={htmlBody}
              onChange={(event) => setHtmlBody(event.target.value)}
              rows={14}
              className="mt-1 w-full resize-y rounded-lg border border-stone bg-white px-3 py-2 font-mono text-sm text-ink outline-none placeholder:text-ink/30 focus:border-gold"
              style={isHtmlMode ? undefined : { fontFamily: 'inherit' }}
            />
          </div>

          <div className="rounded-lg border border-stone bg-white">
            <div className="border-b border-stone px-4 py-3">
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-ink/35">Preview</p>
              <p className="mt-1 text-xs text-ink/45">
                Dang xem thu voi du lieu cua: <span className="font-medium text-ink">{personalizationPreview.name}</span>
              </p>
            </div>

            <div className="space-y-4 px-4 py-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.12em] text-ink/35">Subject</p>
                <p className="mt-2 text-sm text-ink/70">
                  {subject.trim() ? applyPreviewTemplate(subject, personalizationPreview) : 'Chua co tieu de de xem truoc.'}
                </p>
              </div>

              <div>
                <p className="text-xs font-medium uppercase tracking-[0.12em] text-ink/35">Noi dung</p>
                {htmlBody.trim() ? (
                  isHtmlMode ? (
                    <div
                      className="mt-2 rounded-lg border border-stone bg-paper px-4 py-3 text-sm [&_h1]:text-lg [&_h1]:font-bold [&_h2]:text-base [&_h2]:font-semibold [&_a]:text-gold [&_a]:underline"
                      dangerouslySetInnerHTML={{ __html: applyPreviewTemplate(htmlBody, personalizationPreview) }}
                    />
                  ) : (
                    <pre className="mt-2 whitespace-pre-wrap rounded-lg border border-stone bg-paper px-4 py-3 text-sm text-ink/70">
                      {applyPreviewTemplate(htmlBody, personalizationPreview)}
                    </pre>
                  )
                ) : (
                  <p className="mt-2 text-sm text-ink/45">Chua co noi dung de xem truoc.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className={`${CARD} flex items-center justify-between px-5 py-4`}>
        <div className="text-sm text-ink/55">
          {estimatedRecipientCount > 0
            ? `Se gui den ${estimatedRecipientCount} nguoi nhan`
            : 'Chua co nguoi nhan nao duoc chon'}
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
              Dang gui...
            </>
          ) : (
            <>
              <Icon name="mail" className="h-4 w-4" />
              Gui email
            </>
          )}
        </button>
      </div>
    </div>
  )
}
