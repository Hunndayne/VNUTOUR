import { useState, useEffect, useRef } from 'react'
import { apiRequest } from './api.js'
import { Icon, CARD } from './ui.jsx'
import { exportToJson, exportQuizToExcel, importFromFile, downloadSampleExcel, downloadSampleJson } from './importExportUtils.js'

export default function QuestionBankPanel({ eventId, canEdit }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState(null)
  const [importMode, setImportMode] = useState('replace')
  const [busy, setBusy] = useState(false)
  const [explanations, setExplanations] = useState({})

  useEffect(() => {
    let active = true
    apiRequest(`/program/sub-events/${eventId}/question-bank`)
      .then((res) => {
        if (active) {
          setItems(res.items || [])
          setLoading(false)
        }
      })
      .catch((err) => {
        if (active) {
          setError(err.message)
          setLoading(false)
        }
      })
    return () => { active = false }
  }, [eventId])

  const fileInputRef = useRef(null)

  const handleFileImport = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      setBusy(true)
      setImportError(null)
      const parsed = await importFromFile(file)
      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error("Không tìm thấy câu hỏi hợp lệ trong file")
      }
      
      if (importMode === 'replace' && items.length && !window.confirm(`Thay ${items.length} câu hiện tại bằng ${parsed.length} câu từ ${file.name}? Các trạm chọn từng câu cần chọn lại từ bộ mới. Lịch sử bài đã nộp vẫn được giữ.`)) return
      await apiRequest(`/program/sub-events/${eventId}/question-bank`, {
        method: 'POST',
        body: { items: parsed, mode: importMode }
      })
      
      setImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
      
      // Refresh
      const res = await apiRequest(`/program/sub-events/${eventId}/question-bank`)
      setItems(res.items || [])
      setExplanations({})
    } catch (err) {
      setImportError(err.message || 'Lỗi nhập dữ liệu')
      if (fileInputRef.current) fileInputRef.current.value = ''
    } finally {
      setBusy(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const clearBank = async () => {
    if (!window.confirm(`Gỡ toàn bộ ${items.length} câu trong ngân hàng? Các trạm chọn từng câu sẽ cần chọn lại. Lịch sử bài đã nộp vẫn được giữ.`)) return
    setBusy(true)
    try {
      await apiRequest(`/program/sub-events/${eventId}/question-bank`, { method: 'DELETE' })
      setItems([])
      setExplanations({})
      setError(null)
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  const saveExplanation = async item => {
    setBusy(true)
    try {
      const updated = await apiRequest(`/program/sub-events/${eventId}/question-bank/${item.id}`, {
        method: 'PUT', body: { explanation: explanations[item.id] ?? item.explanation ?? '' },
      })
      setItems(current => current.map(value => value.id === item.id ? updated : value))
      setExplanations(current => { const next = { ...current }; delete next[item.id]; return next })
      setError(null)
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  const handleExportJSON = () => {
    exportToJson(items, `question_bank_${eventId}.json`)
  }

  const handleExportExcel = () => {
    exportQuizToExcel(items, `question_bank_${eventId}.xlsx`)
  }

  if (loading) {
    return <div className={`${CARD} p-5 text-sm text-ink/50`}>Đang tải bộ câu hỏi...</div>
  }

  return (
    <div className={`${CARD} overflow-hidden`}>
      <div className="border-b border-stone px-5 py-4 flex flex-wrap gap-3 items-center justify-between">
        <div>
          <h2 className="font-display text-base font-semibold text-ink">Ngân hàng câu hỏi dùng chung</h2>
          <p className="text-xs text-ink/50 mt-1">
            Tổng cộng: {items.length} câu. Các trạm có thể lấy câu hỏi từ nguồn này.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit && items.length > 0 && <button type="button" disabled={busy} onClick={clearBank} className="rounded-lg border border-clay/30 px-3 py-2 text-sm text-clay disabled:opacity-50">Gỡ bộ câu hỏi</button>}
          {items.length > 0 && (
            <>
              <button
                type="button"
                onClick={handleExportExcel}
                className="rounded-lg border border-stone bg-white px-3 py-1.5 text-sm font-medium text-ink transition hover:bg-paper"
              >
                Xuất Excel
              </button>
              <button
                type="button"
                onClick={handleExportJSON}
                className="rounded-lg border border-stone bg-white px-3 py-1.5 text-sm font-medium text-ink transition hover:bg-paper"
              >
                Xuất JSON
              </button>
            </>
          )}
          <button
            type="button"
            disabled={!canEdit || busy}
            onClick={() => setImporting(!importing)}
            className="rounded-lg bg-paper px-3 py-1.5 text-sm font-medium text-ink transition hover:bg-stone/50 disabled:opacity-50"
          >
            {importing ? 'Đóng' : 'Nhập file'}
          </button>
        </div>
      </div>

      {importing && (
        <div className="border-b border-stone p-5 bg-paper/50">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-ink">Nhập từ file Excel/JSON</p>
            <div className="flex gap-2">
              <button onClick={downloadSampleExcel} className="text-xs text-trail hover:underline font-medium">Mẫu Excel</button>
              <button onClick={downloadSampleJson} className="text-xs text-trail hover:underline font-medium">Mẫu JSON</button>
            </div>
          </div>
          <p className="text-xs text-ink/60 mb-3">
            Cột Excel: Question, Points, Correct Option (0-indexed), Explanation (giải thích), Tags, Option 1, Option 2, … Bài đã nộp giữ nguyên bản lưu đáp án.
          </p>
          <label className="mb-3 block text-sm text-ink">Cách nhập
            <select value={importMode} disabled={busy} onChange={e => setImportMode(e.target.value)} className="ml-3 rounded-lg border border-stone bg-white p-2">
              <option value="replace">Thay bộ câu hỏi hiện tại</option>
              <option value="append">Thêm vào bộ hiện tại</option>
            </select>
          </label>
          <input
            type="file"
            disabled={busy}
            accept=".json,.xlsx,.xls,.csv"
            ref={fileInputRef}
            onChange={handleFileImport}
            className="block w-full text-sm text-ink/70 file:mr-4 file:rounded-lg file:border-0 file:bg-ink file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-ink/90 cursor-pointer"
          />
          {importError && <p className="text-xs text-clay mt-2">{importError}</p>}
        </div>
      )}

      {error && <div role="alert" className="p-5 text-sm text-clay">{error}</div>}
      {items.length === 0 ? (
        <div className="p-5 text-sm text-ink/50 italic">Ngân hàng câu hỏi trống.</div>
      ) : (
        <div className="divide-y divide-stone max-h-96 overflow-y-auto">
          {items.map((item, idx) => (
            <div key={item.id} className="p-4 hover:bg-paper/50 transition">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-xs font-mono font-semibold text-ink/40 mr-2">#{idx + 1}</span>
                  <span className="text-xs font-mono bg-stone px-1.5 py-0.5 rounded mr-2 text-ink/50 uppercase">
                    {item.type === 'text' ? 'Tự luận' : 'Trắc nghiệm'}
                  </span>
                  <span className="text-sm font-medium text-ink">{item.question}</span>
                </div>
                <span className="text-xs text-gold font-mono whitespace-nowrap ml-4">
                  {item.points} đ
                </span>
              </div>
              {item.type === 'text' ? (
                <div className="mt-2 text-xs pl-6 text-trail font-medium flex gap-1.5 flex-wrap">
                  <Icon name="check" className="w-3 h-3 mt-[1px]" />
                  {item.correctText && item.correctText.length > 0 ? (
                    item.correctText.map((t, i) => (
                      <span key={i} className="bg-trail/10 px-1.5 py-0.5 rounded">{t}</span>
                    ))
                  ) : (
                    <span className="text-ink/40 font-normal italic">Chấm thủ công</span>
                  )}
                </div>
              ) : (
                <ul className="mt-2 space-y-1">
                  {(item.options || []).map((opt, oIdx) => (
                    <li
                      key={oIdx}
                      className={`text-xs pl-6 relative ${oIdx === item.correctOption ? 'font-medium text-trail' : 'text-ink/60'}`}
                    >
                      {oIdx === item.correctOption && (
                        <Icon name="check" className="w-3 h-3 absolute left-1 top-[1px]" />
                      )}
                      {String.fromCharCode(65 + oIdx)}. {opt}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3 pl-6">
                <label className="block text-xs font-semibold text-ink/60" htmlFor={`explanation-${item.id}`}>Giải thích</label>
                {canEdit ? <>
                  <textarea id={`explanation-${item.id}`} rows={2} disabled={busy} value={explanations[item.id] ?? item.explanation ?? ''} onChange={e => setExplanations(current => ({ ...current, [item.id]: e.target.value }))} placeholder="Thí sinh xem sau khi hết thời gian trạm" className="mt-1 w-full rounded-lg border border-stone p-2 text-sm" />
                  {explanations[item.id] !== undefined && <button type="button" disabled={busy} onClick={() => saveExplanation(item)} className="mt-2 rounded-lg bg-trail px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Lưu giải thích</button>}
                </> : <p className="mt-1 whitespace-pre-wrap text-sm text-ink/70">{item.explanation || 'Chưa có giải thích'}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
