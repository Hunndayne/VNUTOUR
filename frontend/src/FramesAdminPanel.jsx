import { useCallback, useEffect, useRef, useState } from 'react'
import { CARD, Icon, Badge } from './ui.jsx'
import { formatDateTime } from './api.js'
import {
  listAdminFrames,
  frameImageUrl,
  createFrame,
  updateFrame,
  deleteFrame,
  getFrameStats,
} from './frameApi.js'
import { stripMarkdown } from './markdownUtils.jsx'
import MarkdownPreview from './MarkdownPreview.jsx'

// ─────────────────────────────────────────────────────────────────────
// Admin panel for the "ghép khung ảnh" (photo frame) tool — upload new
// frames, manage the ones already live, and glance at download stats.
// Mirrors the card / form idioms in SiteSettingsPage.jsx and the table
// idiom in TeamsPage.jsx: each async action owns its own busy/error state
// and the list refetches after every mutation rather than patching local
// state, so what's on screen always matches the server.
// ─────────────────────────────────────────────────────────────────────

const FIELD_CLASS = 'w-full rounded-lg border border-stone bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10'
const LABEL_CLASS = 'mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40'
const PRIMARY_BTN = 'inline-flex items-center justify-center gap-1.5 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-[0.9] disabled:cursor-not-allowed disabled:opacity-40'
const SECONDARY_BTN = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-stone bg-white px-3 py-2 text-sm font-semibold text-ink/70 transition hover:bg-paper disabled:cursor-not-allowed disabled:opacity-40'

// Recommend transparent PNG, but also accept the other common web formats.
const ACCEPT_TYPES = 'image/png,image/jpeg,image/webp'

// Checkered backdrop so transparency in the PNG frames is visible against
// thumbnails, matching the standard "transparent layer" affordance used by
// image editors.
const CHECKER_BG = {
  backgroundImage:
    'linear-gradient(45deg, #e5e0d8 25%, transparent 25%), linear-gradient(-45deg, #e5e0d8 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e5e0d8 75%), linear-gradient(-45deg, transparent 75%, #e5e0d8 75%)',
  backgroundSize: '16px 16px',
  backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
}

function ErrorNote({ children }) {
  if (!children) return null
  return <div className="rounded-lg border border-clay/20 bg-clay/10 px-3 py-2 text-sm text-clay">{children}</div>
}

function SuccessNote({ children }) {
  if (!children) return null
  return <div className="rounded-lg border border-trail/20 bg-trail/10 px-3 py-2 text-sm text-trail">{children}</div>
}

function explainFrameError(error) {
  const code = error?.data?.error || error?.message
  const map = {
    forbidden: 'Bạn không có quyền quản lý khung ảnh.',
    invalid_json: 'Dữ liệu gửi lên không hợp lệ.',
    not_found: 'Không tìm thấy khung ảnh này (có thể đã bị xoá).',
    missing_title: 'Khung ảnh cần có tiêu đề.',
    missing_file: 'Vui lòng chọn một tệp ảnh.',
    invalid_image: 'Tệp ảnh không hợp lệ. Hãy dùng PNG, JPEG hoặc WEBP.',
  }
  return map[code] || 'Không thể đồng bộ dữ liệu khung ảnh. Vui lòng thử lại.'
}

// ─────────────────────────────────────────────────────────────────────
// Stats — total downloads + recent activity feed
// ─────────────────────────────────────────────────────────────────────
function StatsSection({ stats, loading }) {
  if (loading) {
    return (
      <div className={`${CARD} px-4 py-10 text-center text-sm text-ink/35`}>
        Đang tải thống kê lượt tải...
      </div>
    )
  }

  const recent = stats?.recent || []

  return (
    <div className={`${CARD} p-5`}>
      <h3 className="mb-4 font-mono text-[11px] uppercase tracking-[0.18em] text-ink/40">Thống kê lượt tải</h3>
      <div className="grid gap-5 sm:grid-cols-[auto_1fr]">
        <div className="flex flex-col items-start justify-center rounded-lg border border-stone bg-paper px-5 py-4 sm:min-w-[160px]">
          <p className="font-mono text-3xl font-bold text-ink">{stats?.total ?? 0}</p>
          <p className="mt-1 text-xs text-ink/45">Tổng lượt tải</p>
        </div>
        <div className="min-w-0">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-ink/35">Lượt tải gần đây</p>
          {recent.length === 0 ? (
            <p className="text-sm text-ink/40">Chưa có lượt tải nào.</p>
          ) : (
            <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
              {recent.map((item, i) => (
                <div
                  key={item.id ?? `${item.frame_id}-${i}`}
                  className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm transition hover:bg-paper"
                >
                  <span className="truncate text-ink/80">{item.frame_title || `Khung #${item.frame_id}`}</span>
                  <span className="shrink-0 font-mono text-xs text-ink/40">{formatDateTime(item.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Upload form
// ─────────────────────────────────────────────────────────────────────
function UploadFrameForm({ onCreated }) {
  const [file, setFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [isActive, setIsActive] = useState(false)
  const [saving, setSaving] = useState(false)
  const [apiError, setApiError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const fileInputRef = useRef(null)

  // Live preview of the chosen file — object URL, revoked on change/unmount.
  // No client-side compression: that would risk flattening transparency.
  useEffect(() => {
    if (!file) { setPreviewUrl(''); return undefined }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const handleFileChange = (event) => {
    setFile(event.target.files?.[0] || null)
  }

  const resetForm = () => {
    setFile(null)
    setTitle('')
    setDescription('')
    setIsActive(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setApiError('')
    setSuccessMsg('')

    if (!file) { setApiError('Vui lòng chọn một tệp ảnh.'); return }
    if (!title.trim()) { setApiError('Vui lòng nhập tiêu đề.'); return }

    setSaving(true)
    try {
      await createFrame({ file, title: title.trim(), description: description.trim(), isActive })
      resetForm()
      setSuccessMsg('Đã thêm khung ảnh mới.')
      setTimeout(() => setSuccessMsg(''), 3000)
      onCreated?.()
    } catch (error) {
      setApiError(explainFrameError(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={`${CARD} p-5`}>
      <h3 className="mb-4 font-mono text-[11px] uppercase tracking-[0.18em] text-ink/40">Thêm khung ảnh mới</h3>

      <form onSubmit={handleSubmit} className="space-y-4">
        <ErrorNote>{apiError}</ErrorNote>
        <SuccessNote>{successMsg}</SuccessNote>

        <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
          <div>
            <label className={LABEL_CLASS}>Ảnh khung</label>
            <label
              className="flex h-40 w-40 cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-lg border-2 border-dashed border-stone bg-paper text-center transition hover:border-trail/40"
              style={previewUrl ? CHECKER_BG : undefined}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPT_TYPES}
                className="hidden"
                onChange={handleFileChange}
              />
              {previewUrl ? (
                <img src={previewUrl} alt="Xem trước khung ảnh" className="h-full w-full object-contain p-2" />
              ) : (
                <>
                  <Icon name="doc" className="h-6 w-6 text-ink/30" />
                  <span className="px-2 text-xs text-ink/40">Chọn tệp ảnh</span>
                </>
              )}
            </label>
            <p className="mt-1.5 text-xs leading-5 text-ink/40">
              Nên dùng PNG nền trong suốt để ghép ảnh đẹp nhất.
            </p>
          </div>

          <div className="space-y-3">
            <div>
              <label className={LABEL_CLASS}>Tiêu đề *</label>
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Khung ảnh VNUTour 2026"
                className={FIELD_CLASS}
              />
            </div>
            <div>
              <label className={LABEL_CLASS}>Mô tả</label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={3}
                placeholder="Mô tả ngắn cho khung ảnh (tuỳ chọn)"
                className={`${FIELD_CLASS} resize-y`}
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-ink/70">
              <input
                type="checkbox"
                checked={isActive}
                onChange={e => setIsActive(e.target.checked)}
                className="h-4 w-4 rounded border-stone text-trail focus:ring-trail/30"
              />
              Hiển thị công khai
            </label>
          </div>
        </div>

        <button type="submit" disabled={saving} className={PRIMARY_BTN}>
          <Icon name="checkPlain" className="h-4 w-4" />
          {saving ? 'Đang tải lên...' : 'Thêm khung ảnh'}
        </button>
      </form>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Comprehensive edit modal — title, markdown description (with live
// preview), public/hidden, sort order, and image replacement, all saved
// in one call. Mirrors the split-pane editor idiom used for the Feed.
// ─────────────────────────────────────────────────────────────────────
function EditFrameModal({ frame, onClose, onSaved }) {
  const [title, setTitle] = useState(frame.title || '')
  const [description, setDescription] = useState(frame.description || '')
  const [isActive, setIsActive] = useState(Boolean(frame.is_active))
  const [sortOrder, setSortOrder] = useState(Number(frame.sort_order) || 0)
  const [file, setFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef(null)

  // Live preview of a freshly picked replacement file; revoked on change.
  useEffect(() => {
    if (!file) { setPreviewUrl(''); return undefined }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const handleSave = async () => {
    if (!title.trim()) { setError('Tiêu đề không được để trống.'); return }
    setSaving(true)
    setError('')
    try {
      const patch = {
        title: title.trim(),
        description: description.trim(),
        is_active: isActive,
        sort_order: Math.max(0, Number(sortOrder) || 0),
      }
      if (file) patch.file = file
      await updateFrame(frame.id, patch)
      onSaved?.()
    } catch (err) {
      setError(explainFrameError(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-stone bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-stone bg-paper px-6 py-4">
          <h3 className="font-display text-lg font-bold text-ink">Chỉnh sửa khung ảnh</h3>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-ink/40 hover:bg-stone/30 hover:text-ink">✕</button>
        </div>

        {error && (
          <div className="border-b border-clay/20 bg-clay/10 px-6 py-2.5 text-xs text-clay">{error}</div>
        )}

        <div className="grid flex-1 grid-cols-1 divide-y divide-stone overflow-y-auto md:grid-cols-2 md:divide-x md:divide-y-0">
          {/* Left: form */}
          <div className="space-y-4 p-6">
            <div>
              <label className={LABEL_CLASS}>Tiêu đề *</label>
              <input value={title} onChange={e => setTitle(e.target.value)} className={FIELD_CLASS} placeholder="Khung ảnh VNUTour 2026" maxLength={200} />
            </div>

            <div>
              <label className={LABEL_CLASS}>Mô tả (hỗ trợ Markdown)</label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={5}
                className={`${FIELD_CLASS} resize-y font-mono text-xs leading-relaxed`}
                placeholder="Mô tả khung ảnh — có thể dùng **đậm**, *nghiêng*, [liên kết](url), ảnh ![mô tả](url)..."
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <label className="flex items-center gap-2 text-sm text-ink/70">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={e => setIsActive(e.target.checked)}
                  className="h-4 w-4 rounded border-stone text-trail focus:ring-trail/30"
                />
                Hiển thị công khai
              </label>
              <div>
                <label className={LABEL_CLASS}>Thứ tự hiển thị</label>
                <input
                  type="number"
                  min={0}
                  value={sortOrder}
                  onChange={e => setSortOrder(e.target.value)}
                  className={FIELD_CLASS}
                />
              </div>
            </div>

            <div>
              <label className={LABEL_CLASS}>Ảnh khung</label>
              <div className="flex items-center gap-2">
                <input ref={fileRef} type="file" accept={ACCEPT_TYPES} className="hidden" onChange={e => setFile(e.target.files?.[0] || null)} />
                <button type="button" onClick={() => fileRef.current?.click()} className={SECONDARY_BTN}>
                  {file ? 'Chọn ảnh khác' : 'Đổi ảnh khung'}
                </button>
                {file && (
                  <button type="button" onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = '' }} className="text-xs font-semibold text-clay hover:underline">
                    Bỏ ảnh mới
                  </button>
                )}
              </div>
              <p className="mt-1.5 text-xs leading-5 text-ink/40">
                Giữ nguyên nếu không muốn đổi ảnh. Nên dùng PNG nền trong suốt.
              </p>
            </div>
          </div>

          {/* Right: preview */}
          <div className="space-y-4 bg-paper/40 p-6">
            <p className="font-mono text-[10px] uppercase tracking-widest text-ink/40">Xem trước</p>
            <div className="flex h-48 items-center justify-center overflow-hidden rounded-lg border border-stone" style={CHECKER_BG}>
              <img
                src={previewUrl || frameImageUrl(frame.id)}
                alt={title || 'Xem trước khung ảnh'}
                className="h-full w-full object-contain p-3"
              />
            </div>
            <div className="rounded-lg border border-stone bg-white p-4">
              <h4 className="font-display text-base font-bold text-ink">{title || '(Chưa có tiêu đề)'}</h4>
              <div className="mt-2 text-sm text-ink/70">
                <MarkdownPreview content={description} emptyMessage="Mô tả sẽ hiển thị ở đây..." />
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-stone bg-paper px-6 py-3.5">
          <button type="button" onClick={onClose} disabled={saving} className={SECONDARY_BTN}>Huỷ</button>
          <button type="button" onClick={handleSave} disabled={saving} className={PRIMARY_BTN}>
            {saving ? 'Đang lưu...' : 'Lưu thay đổi'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// One frame card — thumbnail, quick active toggle / sort / delete, and a
// "Sửa" button that opens the comprehensive edit modal. Owns its own
// busy/error state so one card's in-flight action never blocks the others.
// ─────────────────────────────────────────────────────────────────────
function FrameCard({ frame, onChanged }) {
  const [editOpen, setEditOpen] = useState(false)
  const [busy, setBusy] = useState('')
  const [cardError, setCardError] = useState('')

  const runAction = async (key, task) => {
    setBusy(key)
    setCardError('')
    try {
      await task()
      onChanged?.()
    } catch (error) {
      setCardError(explainFrameError(error))
    } finally {
      setBusy('')
    }
  }

  const handleToggleActive = () => {
    runAction('active', () => updateFrame(frame.id, { is_active: !frame.is_active }))
  }

  const handleSortMove = (delta) => {
    const next = Math.max(0, (Number(frame.sort_order) || 0) + delta)
    runAction('sort', () => updateFrame(frame.id, { sort_order: next }))
  }

  const handleDelete = () => {
    if (!window.confirm(`Xoá khung ảnh "${frame.title}"? Hành động này không thể hoàn tác.`)) return
    runAction('delete', () => deleteFrame(frame.id))
  }

  return (
    <div className={`${CARD} flex flex-col overflow-hidden`}>
      {editOpen && (
        <EditFrameModal
          frame={frame}
          onClose={() => setEditOpen(false)}
          onSaved={() => { setEditOpen(false); onChanged?.() }}
        />
      )}

      <div className="relative flex h-40 items-center justify-center border-b border-stone" style={CHECKER_BG}>
        <img src={frameImageUrl(frame.id)} alt={frame.title} className="h-full w-full object-contain p-3" />
        <span className="absolute right-2 top-2">
          <Badge
            label={frame.is_active ? 'Công khai' : 'Ẩn'}
            cls={frame.is_active ? 'bg-trail/12 text-trail' : 'bg-ink/[0.07] text-ink/50'}
          />
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        {cardError && <ErrorNote>{cardError}</ErrorNote>}

        <div>
          <div className="flex items-start justify-between gap-2">
            <h4 className="font-semibold text-ink">{frame.title}</h4>
            <button type="button" onClick={() => setEditOpen(true)} className="shrink-0 text-xs font-semibold text-trail hover:underline">
              Sửa
            </button>
          </div>
          {frame.description && <p className="mt-1 line-clamp-3 text-sm text-ink/55">{stripMarkdown(frame.description)}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-ink/40">
          <span>{frame.width}×{frame.height}px</span>
          <span>{frame.download_count ?? 0} lượt tải</span>
          <span>{formatDateTime(frame.created_at)}</span>
        </div>

        <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-stone pt-3">
          <button type="button" onClick={handleToggleActive} disabled={busy === 'active'} className={SECONDARY_BTN}>
            {busy === 'active' ? 'Đang lưu...' : frame.is_active ? 'Ẩn đi' : 'Hiện công khai'}
          </button>

          <div className="inline-flex items-center gap-1 rounded-lg border border-stone px-1.5 py-1" title="Thứ tự hiển thị">
            <button
              type="button"
              onClick={() => handleSortMove(-1)}
              disabled={busy === 'sort'}
              className="px-1.5 text-ink/50 transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Đưa lên trước"
            >
              <Icon name="chevronUpDown" className="h-3.5 w-3.5" />
            </button>
            <span className="min-w-[1.5rem] text-center font-mono text-xs text-ink/60">{frame.sort_order ?? 0}</span>
            <button
              type="button"
              onClick={() => handleSortMove(1)}
              disabled={busy === 'sort'}
              className="px-1.5 text-ink/50 transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Đưa xuống sau"
            >
              <Icon name="chevronR" className="h-3.5 w-3.5 rotate-90" />
            </button>
          </div>

          <button
            type="button"
            onClick={handleDelete}
            disabled={busy === 'delete'}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-clay/25 bg-clay/5 px-3 py-2 text-sm font-semibold text-clay transition hover:bg-clay/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy === 'delete' ? 'Đang xoá...' : 'Xoá'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────
function FramesAdminPanel() {
  const [frames, setFrames] = useState([])
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [stats, setStats] = useState(null)
  const [statsLoading, setStatsLoading] = useState(true)

  const loadFrames = useCallback(async () => {
    try {
      setListError('')
      const data = await listAdminFrames()
      setFrames(data)
    } catch (error) {
      setListError(explainFrameError(error))
    } finally {
      setListLoading(false)
    }
  }, [])

  const loadStats = useCallback(async () => {
    try {
      const data = await getFrameStats({ limit: 50 })
      setStats(data)
    } catch {
      // Stats are supplementary — a failure here shouldn't block the list.
      setStats(null)
    } finally {
      setStatsLoading(false)
    }
  }, [])

  const refreshAll = useCallback(() => {
    loadFrames()
    loadStats()
  }, [loadFrames, loadStats])

  useEffect(() => {
    refreshAll()
  }, [refreshAll])

  const sortedFrames = [...frames].sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0))

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <StatsSection stats={stats} loading={statsLoading} />
      <UploadFrameForm onCreated={refreshAll} />

      <div className={`${CARD} p-5`}>
        <h3 className="mb-4 font-mono text-[11px] uppercase tracking-[0.18em] text-ink/40">
          Danh sách khung ảnh{frames.length > 0 ? ` (${frames.length})` : ''}
        </h3>

        {listError && <div className="mb-4"><ErrorNote>{listError}</ErrorNote></div>}

        {listLoading ? (
          <div className="px-4 py-14 text-center text-sm text-ink/35">Đang tải danh sách khung ảnh...</div>
        ) : sortedFrames.length === 0 ? (
          <div className="px-4 py-14 text-center text-sm text-ink/35">
            Chưa có khung ảnh nào. Thêm khung ảnh đầu tiên ở trên.
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {sortedFrames.map(frame => (
              <FrameCard key={frame.id} frame={frame} onChanged={refreshAll} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default FramesAdminPanel
