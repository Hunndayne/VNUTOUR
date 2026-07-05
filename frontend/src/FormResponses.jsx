import { useEffect, useMemo, useState } from 'react'
import { apiRequest, logoutAndRedirect } from './api.js'
import { Icon } from './ui.jsx'

function renderInlineMarkdown(text, keyPrefix = 'md') {
  const pattern = /(\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`|\*([^*]+)\*)/g
  const nodes = []
  let cursor = 0
  let match

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index))

    if (match[2] && /^https?:\/\//i.test(match[3])) {
      nodes.push(
        <a
          key={`${keyPrefix}-${nodes.length}`}
          href={match[3]}
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-trail underline underline-offset-2"
        >
          {match[2]}
        </a>,
      )
    } else if (match[4]) {
      nodes.push(<strong key={`${keyPrefix}-${nodes.length}`} className="font-semibold text-ink">{match[4]}</strong>)
    } else if (match[5]) {
      nodes.push(
        <code key={`${keyPrefix}-${nodes.length}`} className="rounded-md bg-ink/[0.06] px-1.5 py-0.5 font-mono text-[0.92em] text-ink">
          {match[5]}
        </code>,
      )
    } else if (match[6]) {
      nodes.push(<em key={`${keyPrefix}-${nodes.length}`} className="italic text-ink/70">{match[6]}</em>)
    } else if (match[2]) {
      nodes.push(match[2])
    }

    cursor = pattern.lastIndex
  }

  if (cursor < text.length) nodes.push(text.slice(cursor))
  return nodes.length > 0 ? nodes : text
}

function MarkdownBlock({ content }) {
  const normalized = String(content || '').replace(/\r\n/g, '\n').trim()
  if (!normalized) return null

  const lines = normalized.split('\n')
  const blocks = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index].trim()
    if (!line) {
      index += 1
      continue
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.*)$/)
    if (headingMatch) {
      const level = headingMatch[1].length
      const className = level === 1
        ? 'font-display text-3xl font-semibold tracking-[-0.03em] text-ink'
        : level === 2
          ? 'font-display text-xl font-semibold text-ink'
          : 'font-display text-lg font-semibold text-ink'
      blocks.push(
        <div key={`h-${blocks.length}`} className={className}>
          {renderInlineMarkdown(headingMatch[2], `h-${blocks.length}`)}
        </div>,
      )
      index += 1
      continue
    }

    if (/^>\s?/.test(line)) {
      const quoteLines = []
      while (index < lines.length && /^>\s?/.test(lines[index].trim())) {
        quoteLines.push(lines[index].trim().replace(/^>\s?/, ''))
        index += 1
      }
      blocks.push(
        <blockquote key={`q-${blocks.length}`} className="rounded-2xl border border-gold bg-gold/10 px-4 py-3 text-sm leading-7 text-ink/70">
          {quoteLines.map((quoteLine, quoteIndex) => (
            <p key={`q-line-${quoteIndex}`}>{renderInlineMarkdown(quoteLine, `q-${blocks.length}-${quoteIndex}`)}</p>
          ))}
        </blockquote>,
      )
      continue
    }

    if (/^[-*+]\s+/.test(line)) {
      const items = []
      while (index < lines.length && /^[-*+]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^[-*+]\s+/, ''))
        index += 1
      }
      blocks.push(
        <ul key={`ul-${blocks.length}`} className="space-y-2 pl-5 text-sm leading-7 text-ink/70">
          {items.map((item, itemIndex) => <li key={`ul-item-${itemIndex}`} className="list-disc">{renderInlineMarkdown(item)}</li>)}
        </ul>,
      )
      continue
    }

    if (/^\d+\.\s+/.test(line)) {
      const items = []
      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^\d+\.\s+/, ''))
        index += 1
      }
      blocks.push(
        <ol key={`ol-${blocks.length}`} className="space-y-2 pl-5 text-sm leading-7 text-ink/70">
          {items.map((item, itemIndex) => <li key={`ol-item-${itemIndex}`} className="list-decimal">{renderInlineMarkdown(item)}</li>)}
        </ol>,
      )
      continue
    }

    const paragraphLines = []
    while (index < lines.length && lines[index].trim()) {
      const current = lines[index].trim()
      if (/^(#{1,3})\s+/.test(current) || /^>\s?/.test(current) || /^[-*+]\s+/.test(current) || /^\d+\.\s+/.test(current)) break
      paragraphLines.push(current)
      index += 1
    }

    blocks.push(
      <p key={`p-${blocks.length}`} className="text-sm leading-7 text-ink/70">
        {renderInlineMarkdown(paragraphLines.join(' '), `p-${blocks.length}`)}
      </p>,
    )
  }

  return <div className="space-y-4">{blocks}</div>
}

function inferFieldKind(field) {
  const source = `${field.label || ''} ${field.placeholder || ''}`.toLowerCase()
  if (source.includes('mô tả') || source.includes('chia sẻ') || source.includes('giải thích') || source.includes('cam nhan')) {
    return 'textarea'
  }
  return 'text'
}

function Card({ children, radius = 28, className = '', style = {} }) {
  return (
    <section className={className} style={{ borderRadius: radius, ...style }}>
      {children}
    </section>
  )
}

function FormFieldCard({ index, label, required, helper, children }) {
  return (
    <Card className="relative overflow-hidden border border-stone bg-white px-5 py-5 sm:px-6" style={{ boxShadow: '0 14px 40px rgba(84,72,49,0.08)' }}>
      <div className="absolute right-0 top-0 border-b border-l border-stone bg-paper/70" style={{ height: 96, width: 96, borderBottomLeftRadius: 32 }} />
      <div className="relative">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="max-w-2xl">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-stone bg-paper/70 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.24em] text-ink/55">
              Muc {String(index).padStart(2, '0')}
            </div>
            <h2 className="font-display text-xl font-semibold leading-tight text-ink">
              {label}
              {required ? <span className="ml-1 text-clay">*</span> : null}
            </h2>
            {helper ? <p className="mt-2 text-sm leading-6 text-ink/55">{helper}</p> : null}
          </div>
        </div>
        {children}
      </div>
    </Card>
  )
}

function FieldInput({ field, value, onChange }) {
  const kind = inferFieldKind(field)
  const baseClass = 'w-full rounded-2xl border border-stone bg-paper/50 px-4 py-3 text-sm text-ink outline-none transition placeholder:text-ink/35 focus:border-trail focus:bg-white focus:ring-4 focus:ring-trail/10'
  if (kind === 'textarea') {
    return (
      <textarea
        rows={6}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={field.placeholder || 'Nhap cau tra loi cua ban'}
        className={`${baseClass} leading-7`}
      />
    )
  }

  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={field.placeholder || 'Nhap cau tra loi cua ban'}
      className={baseClass}
    />
  )
}

function QuizChoice({ active, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-start gap-3 rounded-2xl border px-4 py-3 text-left transition ${
        active ? 'border-trail bg-trail/10 shadow-[0_10px_24px_rgba(39,102,93,0.12)]' : 'border-stone bg-paper/50 hover:border-ink/25 hover:bg-white'
      }`}
    >
      <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border transition ${active ? 'border-trail bg-trail text-white' : 'border-stone bg-white text-transparent'}`}>
        <Icon name="checkPlain" className="h-3.5 w-3.5" />
      </span>
      <span className="text-sm leading-6 text-ink">{label}</span>
    </button>
  )
}

function AttachmentBox({ attachment, files, onChange }) {
  return (
    <label className="block cursor-pointer border-2 border-dashed border-gold bg-gold/10 px-5 py-6 transition hover:bg-gold/15" style={{ borderRadius: 26 }}>
      <input
        type="file"
        className="hidden"
        multiple={Number(attachment.maxFiles) > 1}
        onChange={(event) => {
          const selectedFiles = Array.from(event.target.files || []).map((file) => ({
            name: file.name,
            size: file.size,
            type: file.type,
            lastModified: file.lastModified,
          }))
          onChange(selectedFiles)
        }}
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white text-clay shadow-sm">
            <Icon name="paperclip" className="h-6 w-6" />
          </span>
          <div>
            <p className="font-display text-lg font-semibold text-ink">Chon tep minh chung</p>
            <p className="mt-1 text-sm leading-6 text-ink/55">
              Toi da {attachment.maxFiles || 1} file. Cho phep: {attachment.allowedTypes || 'Chua cau hinh'}.
            </p>
          </div>
        </div>
        <span className="inline-flex items-center justify-center rounded-full border border-stone bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-ink/55">
          Browse
        </span>
      </div>
      {attachment.note ? <p className="mt-4 text-sm leading-6 text-ink/65">{attachment.note}</p> : null}
      {files.length > 0 ? (
        <div className="mt-4 space-y-2">
          {files.map((file) => (
            <div key={`${file.name}-${file.lastModified}`} className="rounded-2xl border border-stone bg-white px-3 py-2 text-xs text-ink/60">
              <span className="font-semibold text-ink">{file.name}</span>
              <span className="ml-2 font-mono text-ink/35">{Math.ceil(file.size / 1024)} KB</span>
            </div>
          ))}
        </div>
      ) : null}
    </label>
  )
}

export default function FormResponses() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [forms, setForms] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [answers, setAnswers] = useState({})
  const [attachments, setAttachments] = useState([])
  const [submitState, setSubmitState] = useState('idle')
  const [submitMessage, setSubmitMessage] = useState('')

  useEffect(() => {
    let cancelled = false
    async function loadForms() {
      try {
        setLoading(true)
        setError('')
        const payload = await apiRequest('/my-team/forms')
        if (cancelled) return
        const accessibleForms = payload?.accessible_forms || []
        setForms(accessibleForms)
        const params = new URLSearchParams(window.location.search)
        const preferredId = params.get('stationId')
        const initialId = accessibleForms.some((item) => String(item.station_id) === preferredId)
          ? preferredId
          : accessibleForms[0]?.station_id
            ? String(accessibleForms[0].station_id)
            : ''
        setSelectedId(initialId)
      } catch (err) {
        if (cancelled) return
        if (err?.status === 401) {
          logoutAndRedirect('/')
          return
        }
        if (err?.status === 403) {
          setError('Ban khong co quyen truy cap bieu mau nay.')
          return
        }
        if (err?.status === 404) {
          setError('Ban chua co doi hoac chua co bieu mau phu hop voi phase hien tai.')
          return
        }
        setError('Khong tai duoc danh sach bieu mau.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void loadForms()
    return () => {
      cancelled = true
    }
  }, [])

  const selectedForm = useMemo(
    () => forms.find((item) => String(item.station_id) === String(selectedId)) || null,
    [forms, selectedId],
  )

  const submissionConfig = selectedForm?.submission_config || {}
  const activeFormFields = submissionConfig.form?.enabled ? submissionConfig.form.fields || [] : []
  const activeQuizItems = submissionConfig.quiz?.enabled ? submissionConfig.quiz.items || [] : []
  const attachmentConfig = submissionConfig.attachment?.enabled ? submissionConfig.attachment : null

  useEffect(() => {
    setAnswers({})
    setAttachments([])
    setSubmitState('idle')
    setSubmitMessage('')
  }, [selectedId])

  const setAnswer = (key, value) => {
    setAnswers((current) => ({ ...current, [key]: value }))
  }

  const handleSubmit = async () => {
    const missingRequiredField = activeFormFields.some((field, index) => {
      if (!field.required) return false
      return !String(answers[`form:${field.id || index}`] || '').trim()
    })
    const missingQuizAnswer = activeQuizItems.some((item, index) => {
      if (item.required === false) return false
      return answers[`quiz:${item.id || index}`] === undefined
    })
    if (missingRequiredField || missingQuizAnswer) {
      setSubmitState('error')
      setSubmitMessage('Vui lòng hoàn tất các mục bắt buộc trước khi gửi.')
      return
    }

    const responsePayload = {
      form: activeFormFields.map((field, index) => ({
        id: field.id || `field-${index}`,
        label: field.label || '',
        value: answers[`form:${field.id || index}`] || '',
      })),
      quiz: activeQuizItems.map((item, index) => ({
        id: item.id || `quiz-${index}`,
        question: item.question || '',
        selectedOption: answers[`quiz:${item.id || index}`],
      })),
    }

    try {
      setSubmitState('submitting')
      setSubmitMessage('')
      await apiRequest(`/my-team/forms/${selectedId}/submit`, {
        method: 'POST',
        body: {
          response_payload: responsePayload,
          attachment_payload: { files: attachments },
        },
      })
      setSubmitState('success')
      setSubmitMessage('Đã gửi bài nộp thành công.')
    } catch (submitError) {
      if (submitError?.status === 401) {
        logoutAndRedirect('/')
        return
      }
      setSubmitState('error')
      const code = submitError?.data?.error || submitError?.message
      const messageMap = {
        team_not_approved: 'Đội của bạn chưa được duyệt nên chưa thể gửi bài.',
        team_not_in_phase: 'Đội của bạn không thuộc phase của biểu mẫu này.',
        form_not_found: 'Biểu mẫu này không còn khả dụng.',
        event_not_found: 'Biểu mẫu không thuộc event đang mở.',
      }
      setSubmitMessage(messageMap[code] || 'Không gửi được bài nộp. Vui lòng thử lại.')
    }
  }

  if (loading) {
    return <div className="min-h-screen bg-paper px-6 py-16 text-center text-sm text-ink/45">Dang tai bieu mau...</div>
  }

  if (error) {
    return <div className="min-h-screen bg-paper px-6 py-16 text-center text-sm text-clay">{error}</div>
  }

  if (!selectedForm) {
    return <div className="min-h-screen bg-paper px-6 py-16 text-center text-sm text-ink/45">Khong co bieu mau nao kha dung cho phase hien tai.</div>
  }

  return (
    <div className="min-h-screen text-ink" style={{ backgroundColor: '#efe5d4' }}>
      <div
        className="absolute inset-x-0 top-0 h-[420px]"
        style={{
          background:
            'radial-gradient(circle at top left, rgba(255,250,244,0.96), rgba(239,229,212,0) 55%), linear-gradient(135deg, #1d5b52 0%, #2c7568 35%, #d88a52 100%)',
        }}
      />

      <div className="relative mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <a href="/" className="inline-flex items-center gap-2 rounded-full border border-white/35 bg-white/10 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.24em] text-white backdrop-blur-sm transition hover:bg-white/15">
          <Icon name="chevronR" className="h-3.5 w-3.5 rotate-180" />
          Participant
        </a>

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_320px] lg:items-start">
          <main className="space-y-5">
            <Card radius={36} className="overflow-hidden border border-white/30" style={{ backgroundColor: '#f7f1e8', boxShadow: '0 30px 80px rgba(52,42,28,0.16)' }}>
              <div className="grid gap-8 px-5 py-6 sm:px-7 sm:py-8 lg:grid-cols-[minmax(0,1fr)_220px]">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-stone bg-white/85 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.24em] text-ink/55">
                    Form theo tram / phase
                  </div>
                  <h1 className="mt-4 max-w-2xl font-display text-4xl font-semibold leading-[0.96] tracking-[-0.05em] text-ink sm:text-5xl">
                    {selectedForm.station_name}
                  </h1>
                  <p className="mt-3 text-sm leading-7 text-ink/70">
                    {selectedForm.event_name} · {selectedForm.phase_label}
                  </p>
                  {selectedForm.station_location ? <p className="mt-2 max-w-2xl text-sm leading-7 text-ink/55">{selectedForm.station_location}</p> : null}
                </div>

                <Card radius={28} className="border border-stone bg-white px-5 py-5">
                  <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-ink/55">Pham vi truy cap</p>
                  <p className="mt-4 font-display text-2xl font-semibold text-ink">{selectedForm.phase_label}</p>
                  <p className="mt-2 text-sm leading-6 text-ink/55">
                    Chi nhung doi nam trong phase nay moi thay duoc bieu mau tuong ung.
                  </p>
                </Card>
              </div>
            </Card>

            {submissionConfig.brief ? (
              <Card radius={32} className="border border-stone bg-white px-5 py-5 sm:px-6" style={{ boxShadow: '0 18px 54px rgba(84,72,49,0.08)' }}>
                <MarkdownBlock content={submissionConfig.brief} />
              </Card>
            ) : null}

            {activeFormFields.map((field, index) => (
              <FormFieldCard
                key={field.id || `${field.label}-${index}`}
                index={index + 1}
                label={field.label || `Truong ${index + 1}`}
                required={field.required}
                helper={field.placeholder}
              >
                <FieldInput
                  field={field}
                  value={answers[`form:${field.id || index}`] || ''}
                  onChange={(value) => setAnswer(`form:${field.id || index}`, value)}
                />
              </FormFieldCard>
            ))}

            {activeQuizItems.map((item, index) => (
              <FormFieldCard
                key={item.id || `quiz-${index}`}
                index={activeFormFields.length + index + 1}
                label={item.question || `Cau hoi ${index + 1}`}
                helper="Chon mot dap an"
              >
                <div className="grid gap-3">
                  {(item.options || []).map((option, optionIndex) => (
                    <QuizChoice
                      key={`${item.id || index}-${optionIndex}`}
                      label={option || `Lua chon ${optionIndex + 1}`}
                      active={answers[`quiz:${item.id || index}`] === optionIndex}
                      onClick={() => setAnswer(`quiz:${item.id || index}`, optionIndex)}
                    />
                  ))}
                </div>
              </FormFieldCard>
            ))}

            {attachmentConfig ? (
              <FormFieldCard
                index={activeFormFields.length + activeQuizItems.length + 1}
                label="Tep minh chung"
                helper="Tai len theo cau hinh cua tram"
              >
                <AttachmentBox attachment={attachmentConfig} files={attachments} onChange={setAttachments} />
              </FormFieldCard>
            ) : null}

            <Card radius={32} className="border border-ink bg-ink px-5 py-5 text-white sm:px-6" style={{ boxShadow: '0 18px 50px rgba(32,49,43,0.3)' }}>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-display text-2xl font-semibold">Da noi voi cau hinh admin</p>
                  <p className="mt-2 max-w-xl text-sm leading-7 text-white/70">
                    Trang nay dang doc cau hinh bai nop tu quan ly tram va tu dong an cac form khong thuoc phase cua doi.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={submitState === 'submitting'}
                  className="rounded-full bg-gold px-5 py-3 text-sm font-semibold text-ink transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-55"
                >
                  {submitState === 'submitting' ? 'Dang gui...' : 'Gui bai nop'}
                </button>
              </div>
              {submitMessage ? (
                <p className={`mt-4 rounded-2xl px-4 py-3 text-sm ${
                  submitState === 'success'
                    ? 'bg-trail/15 text-white'
                    : 'bg-clay/20 text-white'
                }`}>
                  {submitMessage}
                </p>
              ) : null}
            </Card>
          </main>

          <aside className="space-y-5 lg:sticky lg:top-6">
            <Card radius={28} className="border border-white/25 bg-white/90 p-5 backdrop-blur" style={{ boxShadow: '0 18px 50px rgba(52,42,28,0.12)' }}>
              <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-ink/55">Bieu mau kha dung</p>
              <div className="mt-4 space-y-3">
                {forms.map((item) => (
                  <button
                    key={item.station_id}
                    type="button"
                    onClick={() => setSelectedId(String(item.station_id))}
                    className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                      String(item.station_id) === String(selectedId)
                        ? 'border-trail bg-trail/10'
                        : 'border-stone bg-white hover:bg-paper'
                    }`}
                  >
                    <p className="text-sm font-semibold text-ink">{item.station_name}</p>
                    <p className="mt-1 text-xs text-ink/50">{item.event_name} · {item.phase_label}</p>
                  </button>
                ))}
              </div>
            </Card>
          </aside>
        </div>
      </div>
    </div>
  )
}
