import { useEffect, useMemo, useState } from 'react'
import { Badge, CARD, Icon } from './ui.jsx'
import { FIXED_PHASES, SUB_EVENT_TYPE_META, createSubEvent, getPhaseInfo } from './adminProgram.js'

function MetricCard({ value, label, accent = 'default' }) {
  const valueClass = accent === 'trail'
    ? 'text-trail'
    : accent === 'gold'
      ? 'text-gold'
      : accent === 'sky'
        ? 'text-[#3E7CA8]'
        : 'text-ink'

  return (
    <div className={`${CARD} px-4 py-3`}>
      <p className={`font-mono text-2xl font-bold leading-none ${valueClass}`}>{value}</p>
      <p className="mt-1.5 text-xs text-ink/40">{label}</p>
    </div>
  )
}

function PhaseCard({ phase, schedule, isCurrent, isSelected, onSelect, onSetCurrent, onDateChange, canEdit = true }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect()
        }
      }}
      className={`rounded-xl border px-4 py-4 text-left transition ${
        isSelected
          ? 'border-gold/30 bg-gold/10 shadow-[0_3px_10px_rgba(32,49,43,0.08)]'
          : 'border-stone bg-white hover:bg-paper'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              label={phase.label}
              cls={isCurrent ? 'bg-trail/12 text-trail' : 'bg-ink/[0.07] text-ink/55'}
            />
            {isCurrent && <Badge label="Đang hiện tại" cls="bg-gold/15 text-gold" />}
          </div>
          <p className="mt-3 text-sm leading-6 text-ink/55">{phase.hint}</p>
        </div>

        {!isCurrent && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onSetCurrent()
            }}
            disabled={!canEdit}
            className="rounded-lg border border-stone bg-white px-3 py-1.5 text-xs font-semibold text-ink/60 transition hover:bg-paper hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            Chuyển phase
          </button>
        )}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40">
            Bắt đầu
          </label>
          <input
            type="date"
            value={schedule.startDate}
            disabled={!canEdit}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => onDateChange({ startDate: event.target.value })}
            className="w-full rounded-lg border border-stone bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10 disabled:cursor-not-allowed disabled:opacity-40"
          />
        </div>
        <div>
          <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40">
            Kết thúc
          </label>
          <input
            type="date"
            value={schedule.endDate}
            disabled={!canEdit}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => onDateChange({ endDate: event.target.value })}
            className="w-full rounded-lg border border-stone bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10 disabled:cursor-not-allowed disabled:opacity-40"
          />
        </div>
      </div>
    </div>
  )
}

function SubEventCard({ subEvent, isSelected, onSelect, onDelete, canEdit = true }) {
  const typeMeta = SUB_EVENT_TYPE_META[subEvent.type] ?? SUB_EVENT_TYPE_META.custom

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect()
        }
      }}
      className={`w-full rounded-xl border px-4 py-4 text-left transition ${
        isSelected
          ? 'border-gold/30 bg-gold/10 shadow-[0_3px_10px_rgba(32,49,43,0.08)]'
          : 'border-stone bg-white hover:bg-paper'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge label={typeMeta.label} cls={typeMeta.cls} />
            {subEvent.usesStations && <Badge label="Có trạm" cls="bg-[#3E7CA8]/12 text-[#3E7CA8]" />}
            {subEvent.isCurrent && <Badge label="Đang mở" cls="bg-trail/12 text-trail" />}
          </div>
          <h3 className="mt-2 truncate text-base font-semibold text-ink">{subEvent.name}</h3>
          <p className="mt-1 text-xs text-ink/45">
            {subEvent.startDate || '--'} {'->'} {subEvent.endDate || '--'}
          </p>
          {subEvent.note && (
            <p className="mt-2 line-clamp-2 text-sm leading-6 text-ink/50">{subEvent.note}</p>
          )}
        </div>

        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onDelete()
          }}
          disabled={!canEdit}
          className="rounded-lg p-1.5 text-ink/30 transition hover:bg-paper hover:text-clay disabled:cursor-not-allowed disabled:opacity-40"
          title={canEdit ? 'Xóa event' : 'Chỉ master admin mới xóa được event'}
        >
          <Icon name="trash" className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

function SubEventEditor({ initialEvent, phaseLabel, submitLabel, onSave, onCancel, canEdit = true }) {
  const [form, setForm] = useState(() => ({ ...initialEvent }))
  const [error, setError] = useState('')

  const set = (key, value) => {
    setError('')
    setForm((current) => ({ ...current, [key]: value }))
  }

  const handleSave = () => {
    if (!form.name.trim()) {
      setError('Event cần có tên trước khi lưu.')
      return
    }
    onSave({
      ...form,
      name: form.name.trim(),
      note: form.note.trim(),
    })
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-stone bg-paper px-4 py-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/35">Phase đang sửa</p>
        <p className="mt-1 text-sm font-medium text-ink">{phaseLabel}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40">
            Tên event con
          </label>
          <input
            value={form.name}
            disabled={!canEdit}
            onChange={(event) => set('name', event.target.value)}
            className="w-full rounded-lg border border-stone bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10 disabled:cursor-not-allowed disabled:opacity-40"
            placeholder="Ví dụ: Chạy trạm bản đồ"
          />
        </div>
        {error && (
          <p className="sm:col-span-2 rounded-lg border border-clay/25 bg-clay/[0.06] px-3 py-2 text-sm text-clay">
            {error}
          </p>
        )}

        <div>
          <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40">
            Loại event
          </label>
          <select
            value={form.type}
            disabled={!canEdit}
            onChange={(event) => set('type', event.target.value)}
            className="w-full rounded-lg border border-stone bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {Object.entries(SUB_EVENT_TYPE_META).map(([key, meta]) => (
              <option key={key} value={key}>{meta.label}</option>
            ))}
          </select>
        </div>

        <div className="flex items-end">
          <label className="inline-flex items-center gap-2 text-sm text-ink/65">
            <input
              type="checkbox"
              checked={form.usesStations}
              disabled={!canEdit}
              onChange={(event) => set('usesStations', event.target.checked)}
              className="h-4 w-4 rounded border-stone text-trail focus:ring-trail/20 disabled:cursor-not-allowed disabled:opacity-40"
            />
            Event này có trạm
          </label>
        </div>

        <div>
          <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40">
            Bắt đầu
          </label>
          <input
            type="date"
            value={form.startDate}
            disabled={!canEdit}
            onChange={(event) => set('startDate', event.target.value)}
            className="w-full rounded-lg border border-stone bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10 disabled:cursor-not-allowed disabled:opacity-40"
          />
        </div>

        <div>
          <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40">
            Kết thúc
          </label>
          <input
            type="date"
            value={form.endDate}
            disabled={!canEdit}
            onChange={(event) => set('endDate', event.target.value)}
            className="w-full rounded-lg border border-stone bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10 disabled:cursor-not-allowed disabled:opacity-40"
          />
        </div>
      </div>

      <div>
        <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40">
          Ghi chú vận hành
        </label>
        <textarea
          rows={4}
          value={form.note}
          disabled={!canEdit}
          onChange={(event) => set('note', event.target.value)}
          className="w-full rounded-lg border border-stone bg-white px-3 py-2.5 text-sm leading-6 text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10 disabled:cursor-not-allowed disabled:opacity-40"
          placeholder="Mô tả event này dùng để làm gì, cách chấm điểm, và mối liên hệ với trạm nếu có."
        />
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-lg border border-stone bg-white py-2.5 text-sm font-semibold text-ink/60 transition hover:bg-paper"
        >
          Hủy
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!canEdit}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-ink py-2.5 text-sm font-semibold text-white transition hover:brightness-[0.9] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Icon name="checkPlain" className="h-4 w-4" />
          {submitLabel}
        </button>
      </div>
    </div>
  )
}

function EventManagementPage({
  currentPhase,
  currentSubEventId,
  phaseSchedule,
  subEventsByPhase,
  onSetCurrentPhase,
  onSetCurrentSubEvent,
  onUpdatePhaseSchedule,
  onCreateSubEvent,
  onUpdateSubEvent,
  onDeleteSubEvent,
  canEditProgram = true,
}) {
  const [selectedPhase, setSelectedPhase] = useState(currentPhase)
  const [selectedSubEventId, setSelectedSubEventId] = useState('')
  const [creating, setCreating] = useState(false)
  const [detailSeed, setDetailSeed] = useState(0)

  useEffect(() => {
    if (!FIXED_PHASES.some(phase => phase.key === selectedPhase)) {
      setSelectedPhase(currentPhase)
    }
  }, [currentPhase, selectedPhase])

  const visibleSubEvents = useMemo(
    () => subEventsByPhase[selectedPhase] ?? [],
    [selectedPhase, subEventsByPhase],
  )

  useEffect(() => {
    if (visibleSubEvents.length === 0) {
      setSelectedSubEventId('')
      return
    }

    if (!selectedSubEventId || !visibleSubEvents.some(item => item.id === selectedSubEventId)) {
      const currentEvent = selectedPhase === currentPhase
        ? visibleSubEvents.find(item => item.id === String(currentSubEventId))
        : null
      setSelectedSubEventId(currentEvent?.id || visibleSubEvents[0].id)
    }
  }, [currentPhase, currentSubEventId, selectedPhase, selectedSubEventId, visibleSubEvents])

  const selectedPhaseInfo = getPhaseInfo(selectedPhase)
  const selectedSubEvent = visibleSubEvents.find(item => item.id === selectedSubEventId) ?? null
  const stationEventCount = visibleSubEvents.filter(item => item.usesStations).length
  const allEventCount = Object.values(subEventsByPhase).reduce((sum, items) => sum + items.length, 0)

  return (
    <div className="space-y-5">
      <div className={`${CARD} overflow-hidden`}>
        <div className="border-b border-stone px-5 py-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-3xl">
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/40">
                Phase cố định · event bên trong
              </p>
              <h2 className="mt-2 font-display text-xl font-semibold text-ink">
                Chỉ sửa lịch phase, còn event nhỏ sẽ nằm bên trong phase
              </h2>
              <p className="mt-2 text-sm leading-6 text-ink/60">
                Phase của mùa hiện tại là cố định: Đăng ký, Vòng loại, Vòng chung kết, Kết thúc.
                BTC chỉ đổi ngày bắt đầu, ngày kết thúc, và chuyển phase hiện tại. Mỗi event nhỏ
                như social, chạy trạm, quiz, nộp file sẽ được tạo trong phase đang chọn.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setCreating(true)}
              disabled={!canEditProgram}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-[0.9] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Icon name="plus" className="h-4 w-4" />
              Tạo event trong phase
            </button>
          </div>

          {!canEditProgram && (
            <p className="mt-3 text-xs leading-5 text-ink/45">
              Bạn đang ở quyền admin thường nên chỉ xem được cấu trúc chương trình. Chuyển phase,
              sửa lịch phase và tạo/sửa/xóa event con là quyền của master admin.
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricCard value={String(FIXED_PHASES.length)} label="Phase cố định" />
        <MetricCard value={String(allEventCount)} label="Tổng event con" accent="sky" />
        <MetricCard value={String(visibleSubEvents.length)} label={`Event trong ${selectedPhaseInfo.label.toLowerCase()}`} accent="trail" />
        <MetricCard value={String(stationEventCount)} label="Event có trạm trong phase" accent="gold" />
      </div>

      <section className="grid gap-4 xl:grid-cols-2">
        {FIXED_PHASES.map((phase) => (
          <PhaseCard
            key={phase.key}
            phase={phase}
            schedule={phaseSchedule[phase.key]}
            isCurrent={currentPhase === phase.key}
            isSelected={selectedPhase === phase.key}
            onSelect={() => setSelectedPhase(phase.key)}
            onSetCurrent={() => onSetCurrentPhase(phase.key)}
            onDateChange={(patch) => onUpdatePhaseSchedule(phase.key, patch)}
            canEdit={canEditProgram}
          />
        ))}
      </section>

      <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-3">
          <div className={`${CARD} px-4 py-3`}>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/35">Phase đang xem</p>
            <p className="mt-1 text-sm font-semibold text-ink">{selectedPhaseInfo.label}</p>
            <p className="mt-2 text-sm leading-6 text-ink/50">{selectedPhaseInfo.hint}</p>
          </div>

          {visibleSubEvents.map((subEvent) => (
            <SubEventCard
              key={subEvent.id}
              subEvent={subEvent}
              isSelected={selectedSubEvent?.id === subEvent.id}
              onSelect={() => {
                setSelectedSubEventId(subEvent.id)
                setCreating(false)
              }}
              onDelete={() => {
                onDeleteSubEvent(selectedPhase, subEvent.id)
                setSelectedSubEventId('')
              }}
              canEdit={canEditProgram}
            />
          ))}

          {visibleSubEvents.length === 0 && (
            <div className={`${CARD} border-dashed px-4 py-10 text-sm text-ink/35`}>
              Phase này chưa có event nào. Hãy tạo event đầu tiên để sau đó gắn trạm và điểm.
            </div>
          )}
        </div>

        <div className="space-y-5">
          {creating && (
            <div className={`${CARD} overflow-hidden`}>
              <div className="border-b border-stone px-5 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-display text-lg font-semibold text-ink">Tạo event con</p>
                    <p className="mt-1 text-sm text-ink/45">Event này sẽ nằm bên trong phase {selectedPhaseInfo.label.toLowerCase()}.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCreating(false)}
                    className="rounded-lg p-1.5 text-ink/35 transition hover:bg-paper hover:text-ink"
                  >
                    <Icon name="close" className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="p-5">
                <SubEventEditor
                  initialEvent={createSubEvent({
                    startDate: phaseSchedule[selectedPhase]?.startDate || '',
                    endDate: phaseSchedule[selectedPhase]?.endDate || '',
                    type: selectedPhase === 'registration' ? 'workflow' : 'social',
                    usesStations: false,
                  })}
                  phaseLabel={selectedPhaseInfo.label}
                  submitLabel="Tạo event"
                  onSave={(draft) => {
                    onCreateSubEvent(selectedPhase, draft)
                    setCreating(false)
                  }}
                  onCancel={() => setCreating(false)}
                  canEdit={canEditProgram}
                />
              </div>
            </div>
          )}

          {selectedSubEvent && (
            <div className={`${CARD} overflow-hidden`}>
              <div className="border-b border-stone px-5 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-display text-lg font-semibold text-ink">Chi tiết event con</p>
                    <p className="mt-1 text-sm text-ink/45">Sửa event con trong phase mà không làm thay đổi cấu trúc phase cố định.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <PhaseEventBadge type={selectedSubEvent.type} />
                    {selectedSubEvent.usesStations && <Badge label="Có trạm" cls="bg-[#3E7CA8]/12 text-[#3E7CA8]" />}
                    {selectedSubEvent.isCurrent && <Badge label="Đang mở cho thí sinh" cls="bg-trail/12 text-trail" />}
                  </div>
                </div>
              </div>

              <div className="p-5">
                {selectedPhase === currentPhase && (
                  <div className="mb-4 rounded-lg border border-stone bg-paper px-4 py-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/35">Event hiện tại</p>
                        <p className="mt-1 text-sm text-ink/60">
                          Chỉ event đang mở trong phase hiện tại mới được hiển thị trên dashboard participant.
                        </p>
                      </div>
                      {!selectedSubEvent.isCurrent ? (
                        <button
                          type="button"
                          onClick={() => onSetCurrentSubEvent(selectedSubEvent.id)}
                          disabled={!canEditProgram}
                          className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:brightness-[0.9] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Mở event này
                        </button>
                      ) : (
                        <span className="rounded-full bg-trail/12 px-3 py-1.5 text-xs font-semibold text-trail">
                          Đang là event hiện tại
                        </span>
                      )}
                    </div>
                  </div>
                )}
                <SubEventEditor
                  key={`${selectedSubEvent.id}-${detailSeed}`}
                  initialEvent={selectedSubEvent}
                  phaseLabel={selectedPhaseInfo.label}
                  submitLabel="Lưu event"
                  onSave={(draft) => onUpdateSubEvent(selectedPhase, selectedSubEvent.id, draft)}
                  onCancel={() => setDetailSeed(value => value + 1)}
                  canEdit={canEditProgram}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function PhaseEventBadge({ type }) {
  const meta = SUB_EVENT_TYPE_META[type] ?? SUB_EVENT_TYPE_META.custom
  return <Badge label={meta.label} cls={meta.cls} />
}

export default EventManagementPage
