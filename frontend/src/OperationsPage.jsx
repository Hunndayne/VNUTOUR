import { useCallback, useEffect, useMemo, useState } from 'react'
import { FIXED_PHASES } from './adminProgram.js'
import { apiDownload, apiRequest, formatDateTime, isMasterAdmin, logoutAndRedirect } from './api.js'
import { useEnumSearchParam, useSearchParam } from './router.js'
import { CARD, Icon } from './ui.jsx'

const TABS = ['audit', 'report', 'backup']

function saveDownload({ blob, filename }) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function formatBytes(value) {
  const bytes = Number(value) || 0
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function explainError(error) {
  const code = error?.data?.error || error?.message
  const messages = {
    undo_conflict: 'Không thể hoàn tác vì dữ liệu đã được thay đổi sau thao tác này.',
    already_undone: 'Thao tác này đã được hoàn tác.',
    undo_not_supported: 'Loại thao tác này không hỗ trợ hoàn tác tự động.',
    restore_confirmation_required: 'Cần nhập chính xác RESTORE để xác nhận.',
    invalid_backup: 'File backup không hợp lệ.',
    backup_too_large: 'File backup vượt quá giới hạn.',
    master_admin_required: 'Chỉ master admin mới được hoàn tác thao tác đổi phase.',
  }
  return messages[code] || 'Không thể hoàn thành thao tác.'
}

/**
 * Hoàn tác một `phase.change` là đổi phase toàn hệ thống, nên backend chỉ cho
 * master admin làm; các action khác (score.*, checkin.reset, settings.update)
 * admin thường vẫn hoàn tác bình thường.
 */
function isUndoLocked(item, masterAdmin) {
  return item?.action === 'phase.change' && !masterAdmin
}

export default function OperationsPage() {
  const [tab, setTab] = useEnumSearchParam('view', TABS, 'audit')
  const [auditLogs, setAuditLogs] = useState([])
  const [backups, setBackups] = useState([])
  // Bộ lọc báo cáo theo phase — đưa vào URL để link/reload không mất, nhưng
  // KHÔNG lưu nháp: đây là filter, không phải nội dung soạn dở.
  const [phase, setPhase] = useSearchParam('phase', '')
  const [restoreName, setRestoreName] = useState('')
  const [restoreConfirmation, setRestoreConfirmation] = useState('')
  const [restoreFile, setRestoreFile] = useState(null)
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const canUndoPhaseChange = isMasterAdmin()

  const loadAudit = useCallback(async () => {
    const payload = await apiRequest('/admin/audit-logs?limit=100')
    setAuditLogs(payload.items || [])
  }, [])

  const loadBackups = useCallback(async () => {
    const payload = await apiRequest('/admin/backups')
    const items = payload.items || []
    setBackups(items)
    setRestoreName((current) => current || items[0]?.filename || '')
  }, [])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        await Promise.all([loadAudit(), loadBackups()])
      } catch (loadError) {
        if (cancelled) return
        if (loadError?.status === 401) {
          logoutAndRedirect('/')
          return
        }
        setError(explainError(loadError))
      }
    }
    void load()
    return () => { cancelled = true }
  }, [loadAudit, loadBackups])

  const run = async (key, action) => {
    setBusy(key)
    setError('')
    setNotice('')
    try {
      await action()
    } catch (actionError) {
      if (actionError?.status === 401) {
        logoutAndRedirect('/')
        return
      }
      setError(explainError(actionError))
    } finally {
      setBusy('')
    }
  }

  const undoAudit = (item) => run(`undo:${item.id}`, async () => {
    if (isUndoLocked(item, canUndoPhaseChange)) {
      setError(explainError({ data: { error: 'master_admin_required' } }))
      return
    }
    if (!window.confirm(`Hoàn tác thao tác “${item.summary}”?`)) return
    await apiRequest(`/admin/audit-logs/${item.id}/undo`, { method: 'POST' })
    setNotice('Đã hoàn tác và ghi thêm một audit log mới.')
    await loadAudit()
  })

  const exportReport = () => run('report', async () => {
    const query = phase ? `?phase=${encodeURIComponent(phase)}` : ''
    saveDownload(await apiDownload(`/admin/reports/export.xlsx${query}`))
    setNotice('Đã tạo báo cáo XLSX.')
    await loadAudit()
  })

  const createBackup = () => run('backup:create', async () => {
    const result = await apiRequest('/admin/backups', { method: 'POST' })
    setNotice(`Đã tạo backup ${result.filename}.`)
    await Promise.all([loadBackups(), loadAudit()])
  })

  const downloadBackup = (filename) => run(`backup:${filename}`, async () => {
    saveDownload(await apiDownload(`/admin/backups/${encodeURIComponent(filename)}`))
  })

  const restoreBackup = () => run('backup:restore', async () => {
    if (restoreConfirmation !== 'RESTORE') {
      setError('Cần nhập chính xác RESTORE để xác nhận.')
      return
    }
    if (!window.confirm('Restore sẽ thay thế dữ liệu hiện tại. Hệ thống sẽ tự tạo safety backup trước khi tiếp tục.')) return

    if (restoreFile) {
      const form = new FormData()
      form.append('file', restoreFile)
      form.append('confirmation', restoreConfirmation)
      await apiRequest('/admin/backups/restore', {
        method: 'POST',
        body: form,
      })
    } else {
      await apiRequest('/admin/backups/restore', {
        method: 'POST',
        body: {
          backup_name: restoreName,
          confirmation: restoreConfirmation,
        },
      })
    }
    window.alert('Restore thành công. Tất cả session cũ đã bị thu hồi; vui lòng đăng nhập lại.')
    logoutAndRedirect('/login')
  })

  const reversibleCount = useMemo(
    () => auditLogs.filter((item) => item.can_undo).length,
    [auditLogs],
  )

  return (
    <div className="space-y-5">
      {(notice || error) && (
        <div className={`${CARD} px-4 py-3 text-sm ${error ? 'border-clay/20 bg-clay/10 text-clay' : 'border-trail/20 bg-trail/10 text-trail'}`}>
          {error || notice}
        </div>
      )}

      <div className={`${CARD} flex flex-wrap gap-2 p-2`}>
        {[
          ['audit', `Audit log (${reversibleCount} có thể undo)`],
          ['report', 'Xuất XLSX'],
          ['backup', 'Backup / Restore'],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${tab === key ? 'bg-ink text-white' : 'text-ink/55 hover:bg-paper'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'audit' && (
        <div className={CARD}>
          <div className="border-b border-stone px-5 py-4">
            <h2 className="font-semibold text-ink">Lịch sử thao tác</h2>
            <p className="mt-1 text-xs text-ink/45">Undo chỉ thực hiện khi trạng thái hiện tại vẫn khớp với trạng thái sau thao tác gốc.</p>
          </div>
          <div className="divide-y divide-stone">
            {auditLogs.map((item) => {
              const undoLocked = isUndoLocked(item, canUndoPhaseChange)
              return (
                <div key={item.id} className="space-y-2 px-5 py-4">
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-ink/35">#{item.id}</span>
                        <span className="rounded bg-paper px-2 py-0.5 font-mono text-xs text-ink/60">{item.action}</span>
                        <span className="text-xs text-ink/40">{formatDateTime(item.created_at)}</span>
                      </div>
                      <p className="mt-1 text-sm font-medium text-ink">{item.summary}</p>
                      <p className="mt-1 text-xs text-ink/45">Bởi {item.actor || 'hệ thống'}{item.undone_at ? ` · Đã undo bởi ${item.undone_by || 'hệ thống'}` : ''}</p>
                    </div>
                    {item.can_undo && (
                      <button
                        type="button"
                        disabled={busy === `undo:${item.id}` || undoLocked}
                        title={undoLocked ? 'Chỉ master admin mới hoàn tác được thao tác đổi phase.' : undefined}
                        onClick={() => undoAudit(item)}
                        className="rounded-lg border border-clay/20 px-3 py-1.5 text-xs font-semibold text-clay hover:bg-clay/5 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Hoàn tác
                      </button>
                    )}
                  </div>
                  {(item.before_data || item.after_data) && (
                    <details className="text-xs text-ink/50">
                      <summary className="cursor-pointer">Xem trạng thái trước/sau</summary>
                      <pre className="mt-2 overflow-x-auto rounded-lg bg-paper p-3">{JSON.stringify({ before: item.before_data, after: item.after_data }, null, 2)}</pre>
                    </details>
                  )}
                </div>
              )
            })}
            {auditLogs.length === 0 && <p className="px-5 py-10 text-center text-sm text-ink/40">Chưa có audit log.</p>}
          </div>
        </div>
      )}

      {tab === 'report' && (
        <div className={`${CARD} max-w-2xl space-y-4 p-5`}>
          <div>
            <h2 className="font-semibold text-ink">Báo cáo vận hành XLSX</h2>
            <p className="mt-1 text-sm text-ink/50">Workbook gồm tổng quan, đội & thành viên, check-in, điểm, bài nộp và audit log.</p>
          </div>
          <label className="block text-sm font-medium text-ink">
            Lọc phase
            <select value={phase} onChange={(event) => setPhase(event.target.value)} className="mt-1 w-full rounded-lg border border-stone bg-white px-3 py-2">
              <option value="">Tất cả phase</option>
              {FIXED_PHASES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
            </select>
          </label>
          <button type="button" disabled={busy === 'report'} onClick={exportReport} className="flex items-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white">
            <Icon name="doc" className="h-4 w-4" />
            {busy === 'report' ? 'Đang tạo...' : 'Tải báo cáo XLSX'}
          </button>
        </div>
      )}

      {tab === 'backup' && (
        <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
          <div className={CARD}>
            <div className="flex items-center justify-between border-b border-stone px-5 py-4">
              <div>
                <h2 className="font-semibold text-ink">Các bản backup</h2>
                <p className="mt-1 text-xs text-ink/45">Backup chứa dữ liệu nghiệp vụ và media local; không chứa token phiên.</p>
              </div>
              <button type="button" onClick={createBackup} disabled={busy === 'backup:create'} className="rounded-lg bg-trail px-3 py-2 text-xs font-semibold text-white">
                Tạo backup
              </button>
            </div>
            <div className="divide-y divide-stone">
              {backups.map((item) => (
                <div key={item.filename} className="flex items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-xs text-ink">{item.filename}</p>
                    <p className="mt-1 text-xs text-ink/40">{formatDateTime(item.created_at)} · {formatBytes(item.size)}</p>
                  </div>
                  <button type="button" onClick={() => downloadBackup(item.filename)} className="rounded-lg border border-stone px-3 py-1.5 text-xs text-ink/60">
                    Tải xuống
                  </button>
                </div>
              ))}
              {backups.length === 0 && <p className="px-5 py-10 text-center text-sm text-ink/40">Chưa có backup.</p>}
            </div>
          </div>

          <div className={`${CARD} space-y-4 p-5`}>
            <div>
              <h2 className="font-semibold text-clay">Restore dữ liệu</h2>
              <p className="mt-1 text-xs leading-5 text-ink/45">Hệ thống tự tạo safety backup trước khi thay thế dữ liệu. Restore sẽ thu hồi toàn bộ session.</p>
            </div>
            <label className="block text-sm font-medium text-ink">
              Backup trên server
              <select value={restoreName} onChange={(event) => setRestoreName(event.target.value)} disabled={Boolean(restoreFile)} className="mt-1 w-full rounded-lg border border-stone bg-white px-3 py-2">
                <option value="">Chọn backup</option>
                {backups.map((item) => <option key={item.filename} value={item.filename}>{item.filename}</option>)}
              </select>
            </label>
            <label className="block text-sm font-medium text-ink">
              Hoặc tải file ZIP
              <input type="file" accept=".zip" onChange={(event) => setRestoreFile(event.target.files?.[0] || null)} className="mt-1 block w-full text-sm text-ink/55" />
            </label>
            <label className="block text-sm font-medium text-ink">
              Nhập RESTORE để xác nhận
              <input value={restoreConfirmation} onChange={(event) => setRestoreConfirmation(event.target.value)} className="mt-1 w-full rounded-lg border border-clay/30 bg-white px-3 py-2 font-mono" />
            </label>
            <button type="button" onClick={restoreBackup} disabled={busy === 'backup:restore' || (!restoreName && !restoreFile)} className="w-full rounded-lg bg-clay px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
              {busy === 'backup:restore' ? 'Đang restore...' : 'Restore backup'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
