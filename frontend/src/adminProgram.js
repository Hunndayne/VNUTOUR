export const PROGRAM_STORAGE_KEY = 'vnutour:admin:program'
export const STATIONS_STORAGE_KEY = 'vnutour:admin:stations-by-phase-event'

export const FIXED_PHASES = [
  { key: 'registration', label: 'Dang ky', hint: 'Duyet doi, ho so va tai khoan truoc ngay thi.' },
  { key: 'qualifying', label: 'Vong loai', hint: 'Gom cac event nho nhu social, chay tram, quiz, nop file.' },
  { key: 'final', label: 'Vong chung ket', hint: 'Tong hop cac event cua dem chung ket va chon top cuoi.' },
  { key: 'ended', label: 'Ket thuc', hint: 'Tong ket, doi chieu va khoa ket qua.' },
]

export const SUB_EVENT_TYPE_META = {
  workflow: { label: 'Van hanh', icon: 'doc', cls: 'bg-ink/[0.07] text-ink/55' },
  social: { label: 'Social', icon: 'chat', cls: 'bg-gold/15 text-gold' },
  station_run: { label: 'Chay tram', icon: 'flag', cls: 'bg-[#3E7CA8]/12 text-[#3E7CA8]' },
  quiz: { label: 'Quiz', icon: 'listBullet', cls: 'bg-trail/12 text-trail' },
  submission: { label: 'Nop file', icon: 'paperclip', cls: 'bg-[#B07D4A]/15 text-[#B07D4A]' },
  custom: { label: 'Khac', icon: 'ticket', cls: 'bg-ink/[0.07] text-ink/55' },
}

function cloneSubEvent(subEvent = {}) {
  return {
    id: subEvent.id || makeId('sub'),
    name: subEvent.name || 'Event moi',
    type: Object.hasOwn(SUB_EVENT_TYPE_META, subEvent.type) ? subEvent.type : 'custom',
    startDate: subEvent.startDate || '',
    endDate: subEvent.endDate || '',
    usesStations: Boolean(subEvent.usesStations),
    note: subEvent.note || '',
  }
}

export function makeId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function createSubEvent(partial = {}) {
  return cloneSubEvent(partial)
}

const DEFAULT_PHASE_SCHEDULE = {
  registration: { startDate: '2026-06-01', endDate: '2026-06-15' },
  qualifying: { startDate: '2026-06-18', endDate: '2026-06-19' },
  final: { startDate: '2026-06-22', endDate: '2026-06-22' },
  ended: { startDate: '2026-06-23', endDate: '2026-06-23' },
}

const DEFAULT_SUB_EVENTS = {
  registration: [
    cloneSubEvent({
      id: 'reg-approval',
      name: 'Duyet ho so',
      type: 'workflow',
      startDate: '2026-06-01',
      endDate: '2026-06-10',
      usesStations: false,
      note: 'Kiem tra thong tin doi va xac nhan dieu kien tham gia.',
    }),
    cloneSubEvent({
      id: 'reg-briefing',
      name: 'Briefing truoc ngay thi',
      type: 'workflow',
      startDate: '2026-06-12',
      endDate: '2026-06-15',
      usesStations: false,
      note: 'Thong bao lich, quy che va cac dau viec cuoi truoc khi vao vong loai.',
    }),
  ],
  qualifying: [
    cloneSubEvent({
      id: 'qual-social',
      name: 'Vong social',
      type: 'social',
      startDate: '2026-06-16',
      endDate: '2026-06-18',
      usesStations: false,
      note: 'Mini game online va diem cong tuong tac mang xa hoi.',
    }),
    cloneSubEvent({
      id: 'qual-station-map',
      name: 'Chay tram ban do',
      type: 'station_run',
      startDate: '2026-06-18',
      endDate: '2026-06-19',
      usesStations: true,
      note: 'Event chinh cua vong loai. Diem cac tram duoc cong vao event nay.',
    }),
    cloneSubEvent({
      id: 'qual-quiz',
      name: 'Tra loi cau hoi',
      type: 'quiz',
      startDate: '2026-06-18',
      endDate: '2026-06-19',
      usesStations: false,
      note: 'Quiz clue, cau hoi nhanh va cac bo cau hoi phu.',
    }),
    cloneSubEvent({
      id: 'qual-submission',
      name: 'Nop file bo sung',
      type: 'submission',
      startDate: '2026-06-18',
      endDate: '2026-06-19',
      usesStations: false,
      note: 'Anh, file minh chung, bang tong hop can nop sau khi chay tram.',
    }),
  ],
  final: [
    cloneSubEvent({
      id: 'final-stage',
      name: 'Thi san khau',
      type: 'quiz',
      startDate: '2026-06-22',
      endDate: '2026-06-22',
      usesStations: false,
      note: 'Hoi dap truc tiep va thi tinh huong tren san khau.',
    }),
    cloneSubEvent({
      id: 'final-station-map',
      name: 'Tram chung ket',
      type: 'station_run',
      startDate: '2026-06-22',
      endDate: '2026-06-22',
      usesStations: true,
      note: 'Diem cac tram chung ket se cong vao event nay.',
    }),
    cloneSubEvent({
      id: 'final-vote',
      name: 'Binh chon online',
      type: 'social',
      startDate: '2026-06-22',
      endDate: '2026-06-22',
      usesStations: false,
      note: 'Event phu cong diem vao bang diem chung ket.',
    }),
  ],
  ended: [
    cloneSubEvent({
      id: 'ended-summary',
      name: 'Tong ket va cong bo',
      type: 'workflow',
      startDate: '2026-06-23',
      endDate: '2026-06-23',
      usesStations: false,
      note: 'Tong hop ket qua, doi chieu va khoa du lieu mua hien tai.',
    }),
  ],
}

export function getPhaseInfo(phaseKey) {
  return FIXED_PHASES.find(item => item.key === phaseKey) ?? FIXED_PHASES[0]
}

export function normalizeProgramState(state) {
  const phaseSchedule = Object.fromEntries(
    FIXED_PHASES.map((phase) => {
      const incoming = state?.phaseSchedule?.[phase.key] ?? {}
      const defaults = DEFAULT_PHASE_SCHEDULE[phase.key] ?? { startDate: '', endDate: '' }
      return [
        phase.key,
        {
          startDate: incoming.startDate || defaults.startDate,
          endDate: incoming.endDate || defaults.endDate,
        },
      ]
    }),
  )

  const subEventsByPhase = Object.fromEntries(
    FIXED_PHASES.map((phase) => {
      const incoming = Array.isArray(state?.subEventsByPhase?.[phase.key]) && state.subEventsByPhase[phase.key].length > 0
        ? state.subEventsByPhase[phase.key]
        : DEFAULT_SUB_EVENTS[phase.key]
      return [phase.key, incoming.map(cloneSubEvent)]
    }),
  )

  const currentPhase = FIXED_PHASES.some(phase => phase.key === state?.currentPhase)
    ? state.currentPhase
    : 'qualifying'

  return {
    currentPhase,
    phaseSchedule,
    subEventsByPhase,
  }
}

export function loadProgramState() {
  if (typeof window === 'undefined') {
    return normalizeProgramState(null)
  }

  try {
    const raw = JSON.parse(window.localStorage.getItem(PROGRAM_STORAGE_KEY) || 'null')
    return normalizeProgramState(raw)
  } catch {
    return normalizeProgramState(null)
  }
}
