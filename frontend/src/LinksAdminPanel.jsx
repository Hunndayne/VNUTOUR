import { useCallback, useEffect, useState } from 'react'
import { CARD, Icon, Badge } from './ui.jsx'
import { apiRequest, formatDateTime } from './api.js'

// ─────────────────────────────────────────────────────────────────────
// Admin panel for the link shortener — turn a long URL (Google Form,
// Discord invite, deep SPA link) into a printable `/s/<code>` and watch
// the click count. Follows the card / form idioms in FramesAdminPanel:
// each async action owns its busy/error state and the list refetches
// after every mutation rather than patching local state.
// ─────────────────────────────────────────────────────────────────────

const FIELD_CLASS = 'w-full rounded-lg border border-stone bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10'
const LABEL_CLASS = 'mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40'
const PRIMARY_BTN = 'inline-flex items-center justify-center gap-1.5 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-[0.9] disabled:cursor-not-allowed disabled:opacity-40'
const SECONDARY_BTN = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-stone bg-white px-3 py-2 text-sm font-semibold text-ink/70 transition hover:bg-paper disabled:cursor-not-allowed disabled:opacity-40'
const DANGER_BTN = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-clay/30 bg-white px-3 py-2 text-sm font-semibold text-clay transition hover:bg-clay/5 disabled:cursor-not-allowed disabled:opacity-40'

function ErrorNote({ children }) {
  if (!children) return null
  return <div className="rounded-lg border border-clay/20 bg-clay/10 px-3 py-2 text-sm text-clay">{children}</div>
}

function SuccessNote({ children }) {
  if (!children) return null
  return <div className="rounded-lg border border-trail/20 bg-trail/10 px-3 py-2 text-sm text-trail">{children}</div>
}

function explainLinkError(error) {
  const code = error?.data?.error || error?.message
  const map = {
    forbidden: 'Bạn không có quyền quản lý link rút gọn.',
    invalid_json: 'Dữ liệu gửi lên không hợp lệ.',
    invalid_url: 'Link đích không hợp lệ (chỉ nhận http/https).',
    invalid_code: 'Mã tuỳ chọn chỉ gồm a-z, 0-9, gạch ngang/gạch dưới, 3–32 ký tự.',
    code_taken: 'Mã này đã có người dùng, chọn mã khác.',
    invalid_expiry: 'Thời hạn không hợp lệ.',
    not_found: 'Không tìm thấy link này (có thể đã bị xoá).',
  }
  return map[code] || 'Không thể đồng bộ dữ liệu link. Vui lòng thử lại.'
}

function linkStatus(link) {
  if (!link.is_active) return { key: 'off', label: 'Đã tắt', cls: 'bg-ink/5 text-ink/45' }
  if (link.expires_at && new Date(link.expires_at) <= new Date()) {
    return { key: 'expired', label: 'Hết hạn', cls: 'bg-clay/10 text-clay' }
  }
  return { key: 'live', label: 'Đang chạy', cls: 'bg-trail/10 text-trail' }
}

// datetime-local wants "YYYY-MM-DDTHH:mm" in the viewer's local zone; the
// API speaks ISO-8601 UTC.
function isoToLocalInput(iso) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const area = document.createElement('textarea')
      area.value = text
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(area)
      return ok
    } catch {
      return false
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// Create form
// ─────────────────────────────────────────────────────────────────────
function CreateLinkForm({ onCreated }) {
  const [targetUrl, setTargetUrl] = useState('')
  const [label, setLabel] = useState('')
  const [code, setCode] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [saving, setSaving] = useState(false)
  const [apiError, setApiError] = useState('')
  const [createdUrl, setCreatedUrl] = useState('')

  const handleSubmit = async (event) => {
    event.preventDefault()
    setApiError('')
    setCreatedUrl('')
    if (!targetUrl.trim()) { setApiError('Vui lòng nhập link đích.'); return }

    setSaving(true)
    try {
      const payload = { target_url: targetUrl.trim(), label: label.trim(), expires_at: expiresAt || '' }
      if (code.trim()) payload.code = code.trim()
      const link = await apiRequest('/admin/short-links', { method: 'POST', body: payload })
      setCreatedUrl(link.short_url)
      setTargetUrl('')
      setLabel('')
      setCode('')
      setExpiresAt('')
      onCreated?.()
    } catch (error) {
      setApiError(explainLinkError(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={`${CARD} p-5`}>
      <h3 className="mb-4 font-mono text-[11px] uppercase tracking-[0.18em] text-ink/40">Tạo link rút gọn</h3>
      <form onSubmit={handleSubmit} className="space-y-4">
        <ErrorNote>{apiError}</ErrorNote>
        {createdUrl && (
          <SuccessNote>
            Link mới: <a className="font-semibold underline" href={createdUrl} target="_blank" rel="noreferrer">{createdUrl}</a>
          </SuccessNote>
        )}

        <div>
          <label className={LABEL_CLASS}>Link đích *</label>
          <input
            className={FIELD_CLASS}
            type="text"
            value={targetUrl}
            onChange={(e) => setTargetUrl(e.target.value)}
            placeholder="https://docs.google.com/forms/..."
          />
          <p className="mt-1.5 text-xs text-ink/40">Dán URL dài cần rút gọn. Thiếu https:// sẽ tự thêm.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className={LABEL_CLASS}>Ghi chú</label>
            <input
              className={FIELD_CLASS}
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="VD: Poster đăng ký vòng loại"
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>Mã tuỳ chọn</label>
            <input
              className={`${FIELD_CLASS} font-mono`}
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toLowerCase())}
              placeholder="dang-ky (bỏ trống = tự sinh)"
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>Hết hạn (tuỳ chọn)</label>
            <input
              className={FIELD_CLASS}
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </div>
        </div>

        <button className={PRIMARY_BTN} type="submit" disabled={saving}>
          {saving ? 'Đang tạo...' : 'Tạo link'}
        </button>
      </form>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Edit row (inline, replaces the list row while open)
// ─────────────────────────────────────────────────────────────────────
function EditLinkRow({ link, onDone, onCancel }) {
  const [targetUrl, setTargetUrl] = useState(link.target_url)
  const [label, setLabel] = useState(link.label || '')
  const [code, setCode] = useState(link.code)
  const [expiresAt, setExpiresAt] = useState(isoToLocalInput(link.expires_at))
  const [saving, setSaving] = useState(false)
  const [apiError, setApiError] = useState('')

  const handleSave = async (event) => {
    event.preventDefault()
    setApiError('')
    setSaving(true)
    try {
      await apiRequest(`/admin/short-links/${link.id}`, {
        method: 'PATCH',
        body: {
          target_url: targetUrl.trim(),
          label: label.trim(),
          code: code.trim(),
          // Luôn gửi expires_at: rỗng nghĩa là bỏ hạn.
          expires_at: expiresAt || '',
        },
      })
      onDone?.()
    } catch (error) {
      setApiError(explainLinkError(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <tr className="border-t border-stone/60 bg-paper/60">
      <td colSpan={6} className="px-4 py-4">
        <form onSubmit={handleSave} className="space-y-3">
          <ErrorNote>{apiError}</ErrorNote>
          <div className="grid gap-3 sm:grid-cols-[1fr_180px_140px_190px]">
            <div>
              <label className={LABEL_CLASS}>Link đích</label>
              <input className={FIELD_CLASS} type="text" value={targetUrl} onChange={(e) => setTargetUrl(e.target.value)} />
            </div>
            <div>
              <label className={LABEL_CLASS}>Ghi chú</label>
              <input className={FIELD_CLASS} type="text" value={label} onChange={(e) => setLabel(e.target.value)} />
            </div>
            <div>
              <label className={LABEL_CLASS}>Mã</label>
              <input className={`${FIELD_CLASS} font-mono`} type="text" value={code} onChange={(e) => setCode(e.target.value.toLowerCase())} />
            </div>
            <div>
              <label className={LABEL_CLASS}>Hết hạn</label>
              <input className={FIELD_CLASS} type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
            </div>
          </div>
          <div className="flex gap-2">
            <button className={PRIMARY_BTN} type="submit" disabled={saving}>
              {saving ? 'Đang lưu...' : 'Lưu'}
            </button>
            <button className={SECONDARY_BTN} type="button" onClick={onCancel}>Huỷ</button>
          </div>
        </form>
      </td>
    </tr>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Main panel
// ─────────────────────────────────────────────────────────────────────
export default function LinksAdminPanel() {
  const [links, setLinks] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [busyId, setBusyId] = useState('')
  const [actionError, setActionError] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [confirmingId, setConfirmingId] = useState(null)
  const [copiedId, setCopiedId] = useState(null)

  const loadLinks = useCallback(async () => {
    try {
      const payload = await apiRequest('/admin/short-links')
      setLinks(payload.links || [])
      setLoadError('')
    } catch (error) {
      setLoadError(explainLinkError(error))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadLinks() }, [loadLinks])

  // Bỏ trạng thái "Đã sao chép" cũ khi bấm copy hàng khác.
  useEffect(() => {
    if (!copiedId) return undefined
    const timer = setTimeout(() => setCopiedId(null), 2000)
    return () => clearTimeout(timer)
  }, [copiedId])

  const runAction = async (link, key, fn) => {
    setActionError('')
    setBusyId(`${key}:${link.id}`)
    try {
      await fn()
      await loadLinks()
    } catch (error) {
      setActionError(explainLinkError(error))
    } finally {
      setBusyId('')
    }
  }

  const handleCopy = async (link) => {
    const ok = await copyText(link.short_url)
    if (ok) setCopiedId(link.id)
  }

  const handleToggle = (link) => runAction(link, 'toggle', () =>
    apiRequest(`/admin/short-links/${link.id}`, {
      method: 'PATCH',
      body: { is_active: !link.is_active },
    }))

  const handleDelete = (link) => runAction(link, 'delete', () =>
    apiRequest(`/admin/short-links/${link.id}`, { method: 'DELETE' }))

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold text-ink">Rút gọn link</h2>
        <p className="mt-1 text-sm text-ink/55">
          Biến link dài thành <span className="font-mono">/s/mã</span> ngắn gọn để in poster, chia sẻ Zalo hay nhúng QR — và đếm được lượt click.
        </p>
      </div>

      <CreateLinkForm onCreated={loadLinks} />

      <div className={`${CARD} p-5`}>
        <h3 className="mb-4 font-mono text-[11px] uppercase tracking-[0.18em] text-ink/40">Danh sách link</h3>
        <ErrorNote>{actionError || loadError}</ErrorNote>

        {loading ? (
          <p className="px-1 py-8 text-center text-sm text-ink/35">Đang tải danh sách link...</p>
        ) : links.length === 0 ? (
          <p className="px-1 py-8 text-center text-sm text-ink/35">Chưa có link nào. Tạo link đầu tiên ở trên.</p>
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead>
                <tr className="border-b border-stone font-mono text-[10px] uppercase tracking-widest text-ink/35">
                  <th className="px-4 py-2.5 font-medium">Link rút gọn</th>
                  <th className="px-4 py-2.5 font-medium">Link đích & ghi chú</th>
                  <th className="px-4 py-2.5 font-medium">Trạng thái</th>
                  <th className="px-4 py-2.5 font-medium">Lượt click</th>
                  <th className="px-4 py-2.5 font-medium">Ngày tạo</th>
                  <th className="px-4 py-2.5 text-right font-medium">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {links.map((link) => {
                  const status = linkStatus(link)
                  const busy = busyId.endsWith(`:${link.id}`)
                  if (editingId === link.id) {
                    return (
                      <EditLinkRow
                        key={link.id}
                        link={link}
                        onDone={() => { setEditingId(null); loadLinks() }}
                        onCancel={() => setEditingId(null)}
                      />
                    )
                  }
                  return (
                    <tr key={link.id} className="border-t border-stone/60 align-top transition hover:bg-paper/60">
                      <td className="px-4 py-3">
                        <a className="font-mono text-sm font-semibold text-trail hover:underline" href={link.short_url} target="_blank" rel="noreferrer">
                          /s/{link.code}
                        </a>
                        <button
                          className="ml-2 inline-flex items-center gap-1 rounded-md border border-stone bg-white px-2 py-1 text-xs text-ink/60 transition hover:bg-paper"
                          type="button"
                          onClick={() => handleCopy(link)}
                        >
                          <Icon name={copiedId === link.id ? 'checkPlain' : 'link'} className="h-3.5 w-3.5" />
                          {copiedId === link.id ? 'Đã chép' : 'Sao chép'}
                        </button>
                      </td>
                      <td className="max-w-[280px] px-4 py-3">
                        <a
                          className="block truncate text-ink/75 hover:underline"
                          href={link.target_url}
                          target="_blank"
                          rel="noreferrer"
                          title={link.target_url}
                        >
                          {link.target_url}
                        </a>
                        {link.label && <p className="mt-0.5 truncate text-xs text-ink/45" title={link.label}>{link.label}</p>}
                      </td>
                      <td className="px-4 py-3">
                        <Badge label={status.label} cls={status.cls} />
                        {link.expires_at && status.key === 'live' && (
                          <p className="mt-1 text-xs text-ink/40">Đến {formatDateTime(link.expires_at)}</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono font-semibold text-ink">{link.click_count}</span>
                        {link.last_clicked_at && (
                          <p className="mt-0.5 text-xs text-ink/40">Cuối: {formatDateTime(link.last_clicked_at)}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-ink/50">{formatDateTime(link.created_at)}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1.5">
                          {confirmingId === link.id ? (
                            <>
                              <button className={DANGER_BTN} type="button" disabled={busy} onClick={() => handleDelete(link)}>
                                {busy ? 'Đang xoá...' : 'Xác nhận xoá'}
                              </button>
                              <button className={SECONDARY_BTN} type="button" onClick={() => setConfirmingId(null)}>Huỷ</button>
                            </>
                          ) : (
                            <>
                              <button className={SECONDARY_BTN} type="button" onClick={() => { setEditingId(link.id); setConfirmingId(null) }}>
                                Sửa
                              </button>
                              <button className={SECONDARY_BTN} type="button" disabled={busy} onClick={() => handleToggle(link)}>
                                {link.is_active ? 'Tắt' : 'Bật'}
                              </button>
                              <button
                                className={DANGER_BTN}
                                type="button"
                                onClick={() => setConfirmingId(link.id)}
                                title="Xoá link rút gọn"
                              >
                                <Icon name="xmark" className="h-4 w-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
