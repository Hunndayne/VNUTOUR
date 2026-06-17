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

function PhaseCard({ phase, schedule, isCurrent, isSelected, onSelect, onSetCurrent, onDateChange }) {
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
            {isCurrent && <Badge label="Dang hien tai" cls="bg-gold/15 text-gold" />}
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
            className="rounded-lg border border-stone bg-white px-3 py-1.5 text-xs font-semibold text-ink/60 transition hover:bg-paper hover:text-ink"
          >
            Chuyen phase
          </button>
        )}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40">
            Bat dau
          </label>
          <input
            type="date"
            value={schedule.startDate}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => onDateChange({ startDate: event.target.value })}
            className="w-full rounded-lg border border-stone bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
          />
        </div>
        <div>
          <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40">
            Ket thuc
          </label>
          <input
            type="date"
            value={schedule.endDate}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => onDateChange({ endDate: event.target.value })}
            className="w-full rounded-lg border border-stone bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
          />
        </div>
      </div>
    </div>
  )
}

function SubEventCard({ subEvent, isSelected, onSelect, onDelete }) {
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
            {subEvent.usesStations && <Badge label="Co tram" cls="bg-[#3E7CA8]/12 text-[#3E7CA8]" />}
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
          className="rounded-lg p-1.5 text-ink/30 transition hover:bg-paper hover:text-clay"
          title="Xoa event"
        >
          <Icon name="trash" className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

function SubEventEditor({ initialEvent, phaseLabel, submitLabel, onSave, onCancel }) {
  const [form, setForm] = useState(() => ({ ...initialEvent }))

  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }))

  const handleSave = () => {
    onSave({
      ...form,
      name: form.name.trim(),
      note: form.note.trim(),
    })
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-stone bg-paper px-4 py-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/35">Phase dang sua</p>
        <p className="mt-1 text-sm font-medium text-ink">{phaseLabel}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40">
            Ten event con
          </label>
          <input
            value={form.name}
            onChange={(event) => set('name', event.target.value)}
            className="w-full rounded-lg border border-stone bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
            placeholder="Vi du: Chay tram ban do"
          />
        </div>

        <div>
          <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40">
            Loai event
          </label>
          <select
            value={form.type}
            onChange={(event) => set('type', event.target.value)}
            className="w-full rounded-lg border border-stone bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
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
              onChange={(event) => set('usesStations', event.target.checked)}
              className="h-4 w-4 rounded border-stone text-trail focus:ring-trail/20"
            />
            Event nay co tram
          </label>
        </div>

        <div>
          <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40">
            Bat dau
          </label>
          <input
            type="date"
            value={form.startDate}
            onChange={(event) => set('startDate', event.target.value)}
            className="w-full rounded-lg border border-stone bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
          />
        </div>

        <div>
          <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40">
            Ket thuc
          </label>
          <input
            type="date"
            value={form.endDate}
            onChange={(event) => set('endDate', event.target.value)}
            className="w-full rounded-lg border border-stone bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
          />
        </div>
      </div>

      <div>
        <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40">
          Ghi chu van hanh
        </label>
        <textarea
          rows={4}
          value={form.note}
          onChange={(event) => set('note', event.target.value)}
          className="w-full rounded-lg border border-stone bg-white px-3 py-2.5 text-sm leading-6 text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
          placeholder="Mo ta event nay dung de lam gi, cach cham diem, va moi lien he voi tram neu co."
        />
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-lg border border-stone bg-white py-2.5 text-sm font-semibold text-ink/60 transition hover:bg-paper"
        >
          Huy
        </button>
        <button
          type="button"
          onClick={handleSave}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-ink py-2.5 text-sm font-semibold text-white transition hover:brightness-[0.9]"
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
  phaseSchedule,
  subEventsByPhase,
  onSetCurrentPhase,
  onUpdatePhaseSchedule,
  onCreateSubEvent,
  onUpdateSubEvent,
  onDeleteSubEvent,
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
      setSelectedSubEventId(visibleSubEvents[0].id)
    }
  }, [selectedSubEventId, visibleSubEvents])

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
                Phase co dinh · event ben trong
              </p>
              <h2 className="mt-2 font-display text-xl font-semibold text-ink">
                Chi sua lich phase, con event nho se nam ben trong phase
              </h2>
              <p className="mt-2 text-sm leading-6 text-ink/60">
                Phase cua mua hien tai la co dinh: Dang ky, Vong loai, Vong chung ket, Ket thuc.
                BTC chi doi ngay bat dau, ngay ket thuc, va chuyen phase hien tai. Moi event nho
                nhu social, chay tram, quiz, nop file se duoc tao trong phase dang chon.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setCreating(true)}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-[0.9]"
            >
              <Icon name="plus" className="h-4 w-4" />
              Tao event trong phase
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricCard value={String(FIXED_PHASES.length)} label="Phase co dinh" />
        <MetricCard value={String(allEventCount)} label="Tong event con" accent="sky" />
        <MetricCard value={String(visibleSubEvents.length)} label={`Event trong ${selectedPhaseInfo.label.toLowerCase()}`} accent="trail" />
        <MetricCard value={String(stationEventCount)} label="Event co tram trong phase" accent="gold" />
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
          />
        ))}
      </section>

      <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-3">
          <div className={`${CARD} px-4 py-3`}>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/35">Phase dang xem</p>
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
            />
          ))}

          {visibleSubEvents.length === 0 && (
            <div className={`${CARD} border-dashed px-4 py-10 text-sm text-ink/35`}>
              Phase nay chua co event nao. Hay tao event dau tien de sau do gan tram va diem.
            </div>
          )}
        </div>

        <div className="space-y-5">
          {creating && (
            <div className={`${CARD} overflow-hidden`}>
              <div className="border-b border-stone px-5 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-display text-lg font-semibold text-ink">Tao event con</p>
                    <p className="mt-1 text-sm text-ink/45">Event nay se nam ben trong phase {selectedPhaseInfo.label.toLowerCase()}.</p>
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
                  submitLabel="Tao event"
                  onSave={(draft) => {
                    onCreateSubEvent(selectedPhase, draft)
                    setCreating(false)
                  }}
                  onCancel={() => setCreating(false)}
                />
              </div>
            </div>
          )}

          {selectedSubEvent && (
            <div className={`${CARD} overflow-hidden`}>
              <div className="border-b border-stone px-5 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-display text-lg font-semibold text-ink">Chi tiet event con</p>
                    <p className="mt-1 text-sm text-ink/45">Sua event con trong phase ma khong lam thay doi cau truc phase co dinh.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <PhaseEventBadge type={selectedSubEvent.type} />
                    {selectedSubEvent.usesStations && <Badge label="Co tram" cls="bg-[#3E7CA8]/12 text-[#3E7CA8]" />}
                  </div>
                </div>
              </div>

              <div className="p-5">
                <SubEventEditor
                  key={`${selectedSubEvent.id}-${detailSeed}`}
                  initialEvent={selectedSubEvent}
                  phaseLabel={selectedPhaseInfo.label}
                  submitLabel="Luu event"
                  onSave={(draft) => onUpdateSubEvent(selectedPhase, selectedSubEvent.id, draft)}
                  onCancel={() => setDetailSeed(value => value + 1)}
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
