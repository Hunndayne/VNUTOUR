import { useState, useEffect } from 'react'
import { apiRequest } from './api.js'
import { Icon, CARD } from './ui.jsx'

export default function QuestionBankPanel({ eventId, canEdit }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  
  const [importing, setImporting] = useState(false)
  const [importText, setImportText] = useState('')
  const [importError, setImportError] = useState(null)

  useEffect(() => {
    let active = true
    apiRequest(`/api/admin/program/sub-events/${eventId}/question-bank`)
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

  const handleImport = async () => {
    try {
      setImportError(null)
      const parsed = JSON.parse(importText)
      if (!Array.isArray(parsed)) throw new Error("JSON phải là một mảng các câu hỏi")
      
      await apiRequest(`/api/admin/program/sub-events/${eventId}/question-bank`, {
        method: 'POST',
        body: { items: parsed }
      })
      
      setImportText('')
      setImporting(false)
      
      // Refresh
      const res = await apiRequest(`/api/admin/program/sub-events/${eventId}/question-bank`)
      setItems(res.items || [])
    } catch (err) {
      setImportError(err.message || 'Lỗi nhập dữ liệu')
    }
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
        <button
          type="button"
          disabled={!canEdit}
          onClick={() => setImporting(!importing)}
          className="rounded-lg bg-paper px-3 py-1.5 text-sm font-medium text-ink transition hover:bg-stone/50 disabled:opacity-50"
        >
          {importing ? 'Đóng' : 'Nhập JSON'}
        </button>
      </div>

      {importing && (
        <div className="border-b border-stone p-5 bg-paper/50">
          <p className="text-sm font-medium text-ink mb-2">Nhập mảng JSON câu hỏi</p>
          <p className="text-xs text-ink/60 mb-3">
            Cấu trúc: <code>{`[{"question": "...", "options": ["A", "B"], "correctOption": 0, "points": 1}]`}</code>
          </p>
          <textarea
            className="w-full rounded-lg border border-stone bg-white px-3 py-2 text-sm font-mono"
            rows={5}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder={`[\n  {\n    "question": "Câu 1?",\n    "options": ["A", "B"],\n    "correctOption": 0\n  }\n]`}
          />
          {importError && <p className="text-xs text-clay mt-2">{importError}</p>}
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={handleImport}
              disabled={!importText.trim()}
              className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:brightness-90 disabled:opacity-50"
            >
              Thêm vào bộ
            </button>
          </div>
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
