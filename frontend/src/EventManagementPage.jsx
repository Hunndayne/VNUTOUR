import { useMemo, useState } from 'react'
import { Badge, CARD, Icon } from './ui.jsx'
import { FIXED_PHASES, SUB_EVENT_TYPE_META, createSubEvent, getPhaseInfo } from './adminProgram.js'
import { buildUrl, navigate, useLocation, useSearchParam } from './router.js'
import { DraftNotice, useDraftState } from './drafts.jsx'
import QuestionBankPanel from './QuestionBankPanel.jsx'

const PHASE_KEYS = FIXED_PHASES.map(phase => phase.key)

const FIELD_LABEL = 'mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40'
const FIELD_INPUT = 'w-full rounded-lg border border-stone bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10 disabled:cursor-not-allowed disabled:opacity-40'

function formatDate(value) {
  if (!value) return null
  const [year, month, day] = String(value).split('-')
  return day && month && year ? `${day}/${month}/${year}` : value
}

function formatDateRange(schedule) {
  const start = formatDate(schedule?.startDate)
  const end = formatDate(schedule?.endDate)
  if (!start && !end) return 'Chưa đặt lịch'
  return `${start || '--'} → ${end || '--'}`
}

function BackLink({ label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-ink/50 transition hover:text-ink"
    >
      <Icon name="chevronR" className="h-3.5 w-3.5 rotate-180" />
      {label}
    </button>
  )
}

function LockedNote() {
  return (
    <p className="text-xs leading-5 text-ink/45">
      Bạn đang ở quyền admin thường nên chỉ xem được cấu trúc chương trình. Chuyển phase, sửa lịch
      phase và tạo/sửa/xóa event là quyền của master admin.
    </p>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Mức 1 — danh sách phase
// ─────────────────────────────────────────────────────────────────────
function PhaseRow({ phase, schedule, isCurrent, events, onOpen, onSetCurrent, canEdit }) {
  const stationEventCount = events.filter(item => item.usesStations).length

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
      className={`group flex items-center gap-4 rounded-xl border px-5 py-4 text-left transition ${
        isCurrent
          ? 'border-gold/30 bg-gold/[0.07] hover:bg-gold/10'
          : 'border-stone bg-white hover:bg-paper'
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-display text-base font-semibold text-ink">{phase.label}</h3>
          {isCurrent && <Badge label="Đang hiện tại" cls="bg-trail/12 text-trail" />}
        </div>
        <p className="mt-1.5 text-sm leading-6 text-ink/50">{phase.hint}</p>
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-ink/40">
          <span>{formatDateRange(schedule)}</span>
          <span aria-hidden="true">·</span>
          <span>
            {events.length} event
            {stationEventCount > 0 && ` · ${stationEventCount} có trạm`}
          </span>
        </p>
      </div>

      {!isCurrent && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onSetCurrent()
          }}
          disabled={!canEdit}
          className="shrink-0 rounded-lg border border-stone bg-white px-3 py-1.5 text-xs font-semibold text-ink/60 transition hover:bg-paper hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
        >
          Chuyển phase
        </button>
      )}

      <Icon name="chevronR" className="h-4 w-4 shrink-0 text-ink/25 transition group-hover:text-ink/50" />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Mức 2 — một phase và các event bên trong
// ─────────────────────────────────────────────────────────────────────
function SubEventCard({ subEvent, onOpen, onDelete, canEdit }) {
  const typeMeta = SUB_EVENT_TYPE_META[subEvent.type] ?? SUB_EVENT_TYPE_META.custom

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
      className="group flex w-full items-start gap-3 rounded-xl border border-stone bg-white px-4 py-4 text-left transition hover:bg-paper"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge label={typeMeta.label} cls={typeMeta.cls} />
          {subEvent.usesStations && <Badge label="Có trạm" cls="bg-[#3E7CA8]/12 text-[#3E7CA8]" />}
          {subEvent.isCurrent && <Badge label="Đang mở" cls="bg-trail/12 text-trail" />}
        </div>
        <h3 className="mt-2 truncate text-base font-semibold text-ink">{subEvent.name}</h3>
        <p className="mt-1 font-mono text-[11px] text-ink/40">
          {formatDate(subEvent.startDate) || '--'} → {formatDate(subEvent.endDate) || '--'}
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
        className="shrink-0 rounded-lg p-1.5 text-ink/25 transition hover:bg-paper hover:text-clay disabled:cursor-not-allowed disabled:opacity-40"
        title={canEdit ? 'Xóa event' : 'Chỉ master admin mới xóa được event'}
      >
        <Icon name="trash" className="h-4 w-4" />
      </button>
    </div>
  )
}

function PhaseSchedule({ schedule, onDateChange, canEdit }) {
  return (
    <div className={`${CARD} px-5 py-4`}>
      <p className={FIELD_LABEL}>Lịch phase</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={FIELD_LABEL} htmlFor="phase-start">Bắt đầu</label>
          <input
            id="phase-start"
            type="date"
            value={schedule?.startDate || ''}
            disabled={!canEdit}
            onChange={(event) => onDateChange({ startDate: event.target.value })}
            className={FIELD_INPUT}
          />
        </div>
        <div>
          <label className={FIELD_LABEL} htmlFor="phase-end">Kết thúc</label>
          <input
            id="phase-end"
            type="date"
            value={schedule?.endDate || ''}
            disabled={!canEdit}
            onChange={(event) => onDateChange({ endDate: event.target.value })}
            className={FIELD_INPUT}
          />
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Mức 3 — soạn một event
// ─────────────────────────────────────────────────────────────────────
function SubEventEditor({ initialEvent, submitLabel, onSave, onCancel, canEdit, draftKey }) {
  const [form, setForm, draft] = useDraftState(draftKey, () => ({ ...initialEvent }))
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
    // Đã lưu lên server nên không còn gì để khôi phục nữa.
    draft.clear()
  }

  const handleCancel = () => {
    // "Hủy" là ý định rõ ràng bỏ thay đổi đang gõ dở — khác với nút quay lại,
    // vốn vẫn nên giữ nháp để mở lại còn thấy.
    draft.discard()
    onCancel()
  }

  return (
    <div className="space-y-4">
      <DraftNotice draft={draft} label="event đang soạn dở" />

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={FIELD_LABEL} htmlFor="event-name">Tên event</label>
          <input
            id="event-name"
            value={form.name}
            disabled={!canEdit}
            onChange={(event) => set('name', event.target.value)}
            className={FIELD_INPUT}
            placeholder="Ví dụ: Chạy trạm bản đồ"
          />
        </div>
        {error && (
          <p className="rounded-lg border border-clay/25 bg-clay/[0.06] px-3 py-2 text-sm text-clay sm:col-span-2">
            {error}
          </p>
        )}

        <div>
          <label className={FIELD_LABEL} htmlFor="event-type">Loại event</label>
          <select
            id="event-type"
            value={form.type}
            disabled={!canEdit}
            onChange={(event) => set('type', event.target.value)}
            className={FIELD_INPUT}
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

        {form.usesStations && (
          <div className="sm:col-span-2">
            <label className="inline-flex items-start gap-2 text-sm text-ink/65">
              <input
                type="checkbox"
                checked={form.replayAfterAll}
                disabled={!canEdit}
                onChange={(event) => set('replayAfterAll', event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-stone text-trail focus:ring-trail/20 disabled:cursor-not-allowed disabled:opacity-40"
              />
              <span>
                Cho phép chơi lại trạm sau khi đã đi hết
                <span className="mt-0.5 block text-xs font-normal text-ink/40">
                  Đội phải đi hết tất cả các trạm rồi mới được quay lại trạm chưa qua.
                </span>
              </span>
            </label>
          </div>
        )}

        <div>
          <label className={FIELD_LABEL} htmlFor="event-start">Bắt đầu</label>
          <input
            id="event-start"
            type="date"
            value={form.startDate}
            disabled={!canEdit}
            onChange={(event) => set('startDate', event.target.value)}
            className={FIELD_INPUT}
          />
        </div>

        <div>
          <label className={FIELD_LABEL} htmlFor="event-end">Kết thúc</label>
          <input
            id="event-end"
            type="date"
            value={form.endDate}
            disabled={!canEdit}
            onChange={(event) => set('endDate', event.target.value)}
            className={FIELD_INPUT}
          />
        </div>
      </div>

      <div>
        <label className={FIELD_LABEL} htmlFor="event-note">Ghi chú vận hành</label>
        <textarea
          id="event-note"
          rows={4}
          value={form.note}
          disabled={!canEdit}
          onChange={(event) => set('note', event.target.value)}
          className={`${FIELD_INPUT} leading-6`}
          placeholder="Mô tả event này dùng để làm gì, cách chấm điểm, và mối liên hệ với trạm nếu có."
        />
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleCancel}
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

// ─────────────────────────────────────────────────────────────────────
// Trang
// ─────────────────────────────────────────────────────────────────────
// Ba mức, điều khiển hoàn toàn bằng query param nên back/forward của trình
// duyệt đi ngược đúng đường người dùng đã bấm:
//   /admin/events                       danh sách 4 phase
//   ?phase=<key>                        các event bên trong một phase
//   ?phase=<key>&event=<id> | &new=1    soạn một event
// Trước đây cả ba nằm chồng trên một màn hình và không mức nào có URL riêng.
function EventManagementPage({
  currentPhase,
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
  const { path } = useLocation()
  const [phaseParam] = useSearchParam('phase', '')
  const [selectedSubEventId] = useSearchParam('event', '')
  const [creatingParam] = useSearchParam('new', '')

  // Một key lạ (gõ tay, link cũ) đọc lại thành "chưa chọn phase" — tức là về
  // danh sách, chứ không kẹt ở một màn hình chi tiết không khớp phase nào.
  const selectedPhase = PHASE_KEYS.includes(phaseParam) ? phaseParam : ''
  const creating = Boolean(selectedPhase) && creatingParam === '1'

  // Điều hướng giữa các mức đổi nhiều param cùng lúc, nên dựng thẳng URL thay
  // vì gọi ba setter liên tiếp — mỗi setter là một nấc lịch sử.
  const goToPhaseList = () => navigate(path)
  const goToPhase = (key, options) => navigate(buildUrl(path, { phase: key }), options)
  const goToEvent = (id) => navigate(buildUrl(path, { phase: selectedPhase, event: id }))
  const goToCreate = () => navigate(buildUrl(path, { phase: selectedPhase, new: '1' }))

  const visibleSubEvents = useMemo(
    () => subEventsByPhase[selectedPhase] ?? [],
    [selectedPhase, subEventsByPhase],
  )

  // Không tự chọn event nào khi vừa vào một phase: mức 2 là danh sách, người
  // dùng phải chủ động bấm mới xuống mức 3. Một id không giải được (event vừa
  // bị xóa, hoặc dữ liệu chương trình chưa tải xong) cũng chỉ đơn giản là ở
  // lại mức 2 — không xóa param, vì lúc mới mount danh sách còn rỗng và xóa
  // ngay sẽ giết chết link sâu `?event=`.
  const selectedSubEvent = visibleSubEvents.find(item => item.id === selectedSubEventId) ?? null
  const [detailSeed, setDetailSeed] = useState(0)

  const phaseInfo = selectedPhase ? getPhaseInfo(selectedPhase) : null
  const totalEventCount = Object.values(subEventsByPhase).reduce((sum, items) => sum + items.length, 0)

  // ── Mức 1 ──────────────────────────────────────────────────────────
  if (!selectedPhase) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-lg font-semibold text-ink">Phase của mùa này</h2>
          <p className="font-mono text-[11px] text-ink/40">
            {totalEventCount} event trong {FIXED_PHASES.length} phase
          </p>
        </div>

        {!canEditProgram && <LockedNote />}

        <div className="space-y-3">
          {FIXED_PHASES.map((phase) => (
            <PhaseRow
              key={phase.key}
              phase={phase}
              schedule={phaseSchedule[phase.key]}
              isCurrent={currentPhase === phase.key}
              events={subEventsByPhase[phase.key] ?? []}
              onOpen={() => goToPhase(phase.key)}
              onSetCurrent={() => onSetCurrentPhase(phase.key)}
              canEdit={canEditProgram}
            />
          ))}
        </div>
      </div>
    )
  }

  // ── Mức 3 ──────────────────────────────────────────────────────────
  if (creating || selectedSubEvent) {
    const isCreate = creating
    const typeMeta = selectedSubEvent
      ? SUB_EVENT_TYPE_META[selectedSubEvent.type] ?? SUB_EVENT_TYPE_META.custom
      : null

    return (
      <div className="space-y-4">
        <BackLink label={phaseInfo.label} onClick={() => goToPhase(selectedPhase)} />

        <div className={`${CARD} overflow-hidden`}>
          <div className="border-b border-stone px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-lg font-semibold text-ink">
                {isCreate ? `Tạo event trong ${phaseInfo.label.toLowerCase()}` : selectedSubEvent.name}
              </h2>
              {!isCreate && (
                <div className="flex flex-wrap items-center gap-2">
                  <Badge label={typeMeta.label} cls={typeMeta.cls} />
                  {selectedSubEvent.usesStations && <Badge label="Có trạm" cls="bg-[#3E7CA8]/12 text-[#3E7CA8]" />}
                  {selectedSubEvent.isCurrent && <Badge label="Đang mở" cls="bg-trail/12 text-trail" />}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4 p-5">
            {!canEditProgram && <LockedNote />}

            {!isCreate && selectedPhase === currentPhase && (
              <div className="flex flex-col gap-3 rounded-lg border border-stone bg-paper px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-ink/60">
                  Chỉ event đang mở mới hiện trên dashboard của thí sinh.
                </p>
                {selectedSubEvent.isCurrent ? (
                  <span className="shrink-0 rounded-full bg-trail/12 px-3 py-1.5 text-xs font-semibold text-trail">
                    Đang là event hiện tại
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onSetCurrentSubEvent(selectedSubEvent.id)}
                    disabled={!canEditProgram}
                    className="shrink-0 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:brightness-[0.9] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Mở event này
                  </button>
                )}
              </div>
            )}

            {isCreate ? (
              <SubEventEditor
                key={`create-${selectedPhase}`}
                draftKey={`sub-event:new:${selectedPhase}`}
                initialEvent={{
                  ...createSubEvent({
                    startDate: phaseSchedule[selectedPhase]?.startDate || '',
                    endDate: phaseSchedule[selectedPhase]?.endDate || '',
                    type: selectedPhase === 'registration' ? 'workflow' : 'social',
                    usesStations: false,
                  }),
                  // adminProgram.js createSubEvent() chưa mang field này (không được sửa
                  // ở đây) — thêm tay để form luật chơi lại có chỗ bám.
                  replayAfterAll: false,
                }}
                submitLabel="Tạo event"
                onSave={(draft) => {
                  onCreateSubEvent(selectedPhase, draft)
                  goToPhase(selectedPhase, { replace: true })
                }}
                onCancel={() => goToPhase(selectedPhase, { replace: true })}
                canEdit={canEditProgram}
              />
            ) : (
              <SubEventEditor
                key={`${selectedSubEvent.id}-${detailSeed}`}
                draftKey={`sub-event:${selectedSubEvent.id}`}
                initialEvent={{
                  ...selectedSubEvent,
                  // api.js normalizeProgramForFrontend() cũng chưa map field này (không
                  // được sửa ở đây) — đọc thẳng field thô nếu server đã trả về.
                  replayAfterAll: selectedSubEvent.replay_after_all
                    ?? selectedSubEvent.replayAfterAll
                    ?? false,
                }}
                submitLabel="Lưu event"
                onSave={(draft) => {
                  onUpdateSubEvent(selectedPhase, selectedSubEvent.id, draft)
                  goToPhase(selectedPhase, { replace: true })
                }}
                // Hủy chỉ dựng lại form từ dữ liệu server, giữ người dùng ở
                // lại đây phòng khi họ muốn sửa tiếp.
                onCancel={() => setDetailSeed(value => value + 1)}
                canEdit={canEditProgram}
              />
            )}
          </div>
        </div>

        {!isCreate && (
          <QuestionBankPanel 
            eventId={selectedSubEvent.id} 
            canEdit={canEditProgram} 
          />
        )}
      </div>
    )
  }

  // ── Mức 2 ──────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <BackLink label="Tất cả phase" onClick={goToPhaseList} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-lg font-semibold text-ink">{phaseInfo.label}</h2>
            {currentPhase === selectedPhase
              ? <Badge label="Đang hiện tại" cls="bg-trail/12 text-trail" />
              : (
                <button
                  type="button"
                  onClick={() => onSetCurrentPhase(selectedPhase)}
                  disabled={!canEditProgram}
                  className="rounded-lg border border-stone bg-white px-3 py-1.5 text-xs font-semibold text-ink/60 transition hover:bg-paper hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Chuyển phase
                </button>
              )}
          </div>
          <p className="mt-1.5 text-sm leading-6 text-ink/50">{phaseInfo.hint}</p>
        </div>

        <button
          type="button"
          onClick={goToCreate}
          disabled={!canEditProgram}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-[0.9] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Icon name="plus" className="h-4 w-4" />
          Tạo event
        </button>
      </div>

      {!canEditProgram && <LockedNote />}

      <PhaseSchedule
        schedule={phaseSchedule[selectedPhase]}
        onDateChange={(patch) => onUpdatePhaseSchedule(selectedPhase, patch)}
        canEdit={canEditProgram}
      />

      {visibleSubEvents.length === 0 ? (
        <div className={`${CARD} border-dashed px-5 py-12 text-center text-sm text-ink/35`}>
          Phase này chưa có event nào. Tạo event đầu tiên để sau đó gắn trạm và điểm.
        </div>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {visibleSubEvents.map((subEvent) => (
            <SubEventCard
              key={subEvent.id}
              subEvent={subEvent}
              onOpen={() => goToEvent(subEvent.id)}
              onDelete={() => onDeleteSubEvent(selectedPhase, subEvent.id)}
              canEdit={canEditProgram}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default EventManagementPage
