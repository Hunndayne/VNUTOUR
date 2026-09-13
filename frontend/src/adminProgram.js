export const PROGRAM_STORAGE_KEY = 'vnutour:admin:program'
export const STATIONS_STORAGE_KEY = 'vnutour:admin:stations-by-phase-event'

export const FIXED_PHASES = [
  { key: 'registration', label: 'Đăng ký', hint: 'Duyệt đội, hồ sơ và tài khoản trước ngày thi.' },
  { key: 'qualifying', label: 'Vòng loại', hint: 'Gồm các event nhỏ như social, chạy trạm, quiz, nộp file.' },
  { key: 'final', label: 'Vòng chung kết', hint: 'Tổng hợp các event của đêm chung kết và chọn top cuối.' },
  { key: 'ended', label: 'Kết thúc', hint: 'Tổng kết, đối chiếu và khóa kết quả.' },
]

export const SUB_EVENT_TYPE_META = {
  workflow: { label: 'Vận hành', icon: 'doc', cls: 'bg-ink/[0.07] text-ink/55' },
  social: { label: 'Social', icon: 'chat', cls: 'bg-gold/15 text-gold' },
  station_run: { label: 'Chạy trạm', icon: 'flag', cls: 'bg-[#3E7CA8]/12 text-[#3E7CA8]' },
  quiz: { label: 'Quiz', icon: 'listBullet', cls: 'bg-trail/12 text-trail' },
  submission: { label: 'Nộp file', icon: 'paperclip', cls: 'bg-[#B07D4A]/15 text-[#B07D4A]' },
  // Form của event khảo sát là per-person: mỗi thí sinh tự trả lời, nháp KHÔNG
  // đồng bộ theo đội (khác với form trạm vốn là một bài chung của cả đội).
  survey: { label: 'Khảo sát', icon: 'listBullet', cls: 'bg-trail/12 text-trail' },
  custom: { label: 'Khác', icon: 'ticket', cls: 'bg-ink/[0.07] text-ink/55' },
}

function cloneSubEvent(subEvent = {}) {
  return {
    id: subEvent.id || makeId('sub'),
    name: subEvent.name || 'Event mới',
    type: Object.prototype.hasOwnProperty.call(SUB_EVENT_TYPE_META, subEvent.type) ? subEvent.type : 'custom',
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
      name: 'Duyệt hồ sơ',
      type: 'workflow',
      startDate: '2026-06-01',
      endDate: '2026-06-10',
      usesStations: false,
      note: 'Kiểm tra thông tin đội và xác nhận điều kiện tham gia.',
    }),
    cloneSubEvent({
      id: 'reg-briefing',
      name: 'Briefing trước ngày thi',
      type: 'workflow',
      startDate: '2026-06-12',
      endDate: '2026-06-15',
      usesStations: false,
      note: 'Thông báo lịch, quy chế và các đầu việc cuối trước khi vào vòng loại.',
    }),
  ],
  qualifying: [
    cloneSubEvent({
      id: 'qual-social',
      name: 'Vòng social',
      type: 'social',
      startDate: '2026-06-16',
      endDate: '2026-06-18',
      usesStations: false,
      note: 'Mini game online và điểm cộng tương tác mạng xã hội.',
    }),
    cloneSubEvent({
      id: 'qual-station-map',
      name: 'Chạy trạm bản đồ',
      type: 'station_run',
      startDate: '2026-06-18',
      endDate: '2026-06-19',
      usesStations: true,
      note: 'Event chính của vòng loại. Điểm các trạm được cộng vào event này.',
    }),
    cloneSubEvent({
      id: 'qual-quiz',
      name: 'Trả lời câu hỏi',
      type: 'quiz',
      startDate: '2026-06-18',
      endDate: '2026-06-19',
      usesStations: false,
      note: 'Quiz clue, câu hỏi nhanh và các bộ câu hỏi phụ.',
    }),
    cloneSubEvent({
      id: 'qual-submission',
      name: 'Nộp file bổ sung',
      type: 'submission',
      startDate: '2026-06-18',
      endDate: '2026-06-19',
      usesStations: false,
      note: 'Ảnh, file minh chứng, bảng tổng hợp cần nộp sau khi chạy trạm.',
    }),
  ],
  final: [
    cloneSubEvent({
      id: 'final-stage',
      name: 'Thi sân khấu',
      type: 'quiz',
      startDate: '2026-06-22',
      endDate: '2026-06-22',
      usesStations: false,
      note: 'Hỏi đáp trực tiếp và thi tình huống trên sân khấu.',
    }),
    cloneSubEvent({
      id: 'final-station-map',
      name: 'Trạm chung kết',
      type: 'station_run',
      startDate: '2026-06-22',
      endDate: '2026-06-22',
      usesStations: true,
      note: 'Điểm các trạm chung kết sẽ cộng vào event này.',
    }),
    cloneSubEvent({
      id: 'final-vote',
      name: 'Bình chọn online',
      type: 'social',
      startDate: '2026-06-22',
      endDate: '2026-06-22',
      usesStations: false,
      note: 'Event phụ cộng điểm vào bảng điểm chung kết.',
    }),
  ],
  ended: [
    cloneSubEvent({
      id: 'ended-summary',
      name: 'Tổng kết và công bố',
      type: 'workflow',
      startDate: '2026-06-23',
      endDate: '2026-06-23',
      usesStations: false,
      note: 'Tổng hợp kết quả, đối chiếu và khóa dữ liệu mùa hiện tại.',
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
