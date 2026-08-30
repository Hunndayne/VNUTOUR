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
      setImportError(null)
      const parsed = await importFromFile(file)
      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error("Không tìm thấy câu hỏi hợp lệ trong file")
      }
      
      await apiRequest(`/api/admin/program/sub-events/${eventId}/question-bank`, {
        method: 'POST',
        body: { items: parsed }
      })
      
      setImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
      
      // Refresh
      const res = await apiRequest(`/api/admin/program/sub-events/${eventId}/question-bank`)
      setItems(res.items || [])
    } catch (err) {
      setImportError(err.message || 'Lỗi nhập dữ liệu')
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
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
      <div className="border-b border-stone px-5 py-4 flex items-center justify-between">
        <div>
          <h2 className="font-display text-base font-semibold text-ink">Ngân hàng câu hỏi dùng chung</h2>
          <p className="text-xs text-ink/50 mt-1">
            Tổng cộng: {items.length} câu. Các trạm có thể lấy câu hỏi từ nguồn này.
          </p>
        </div>
        <div className="flex gap-2">
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
            disabled={!canEdit}
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
            Hỗ trợ file <code>.xlsx</code> hoặc <code>.json</code>. Cấu trúc Excel cần các cột: Question, Points, Correct Option (0-indexed), Tags, Option 1, Option 2, ...
          </p>
          <input
            type="file"
            accept=".json,.xlsx,.xls,.csv"
            ref={fileInputRef}
            onChange={handleFileImport}
            className="block w-full text-sm text-ink/70 file:mr-4 file:rounded-lg file:border-0 file:bg-ink file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-ink/90 cursor-pointer"
          />
          {importError && <p className="text-xs text-clay mt-2">{importError}</p>}
        </div>
      )}

      {error ? (
        <div className="p-5 text-sm text-clay">{error}</div>
      ) : items.length === 0 ? (
        <div className="p-5 text-sm text-ink/50 italic">Ngân hàng câu hỏi trống.</div>
      ) : (
        <div className="divide-y divide-stone max-h-96 overflow-y-auto">
          {items.map((item, idx) => (
            <div key={item.id} className="p-4 hover:bg-paper/50 transition">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-xs font-mono font-semibold text-ink/40 mr-2">#{idx + 1}</span>
                  <span className="text-sm font-medium text-ink">{item.question}</span>
                </div>
                <span className="text-xs text-gold font-mono whitespace-nowrap ml-4">
                  {item.points} đ
                </span>
              </div>
              <ul className="mt-2 space-y-1">
                {item.options.map((opt, oIdx) => (
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
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
