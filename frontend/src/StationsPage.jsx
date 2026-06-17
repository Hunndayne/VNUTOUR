import { useEffect, useMemo, useRef, useState } from 'react'
import { STATIONS_STORAGE_KEY, SUB_EVENT_TYPE_META } from './adminProgram.js'
import { Icon, CARD, Badge } from './ui.jsx'

const LEGACY_STATIONS_STORAGE_KEY = 'vnutour:admin:stations-by-phase'

const STATUS = {
  active: { label: 'Đang hoạt động', cls: 'bg-trail/12 text-trail' },
  inactive: { label: 'Chưa mở', cls: 'bg-ink/[0.07] text-ink/50' },
}

const PHASE_META = {
  registration: {
    label: 'Đăng ký',
    badgeCls: 'bg-gold/15 text-gold',
    selectedCls: 'border-gold/30 bg-gold/10 text-gold',
    description: 'Giai đoạn này dùng để chuẩn bị hồ sơ vận hành và lên bản nháp bộ trạm trước ngày thi.',
  },
  qualifying: {
    label: 'Vòng loại',
    badgeCls: 'bg-trail/12 text-trail',
    selectedCls: 'border-trail/30 bg-trail/10 text-trail',
    description: 'Mỗi trạm của vòng loại được quản lý riêng, phù hợp cho lượng đội đông và các bài nộp theo trạm.',
  },
  final: {
    label: 'Chung kết',
    badgeCls: 'bg-[#3E7CA8]/12 text-[#3E7CA8]',
    selectedCls: 'border-[#3E7CA8]/25 bg-[#3E7CA8]/10 text-[#3E7CA8]',
    description: 'Chung kết có bộ trạm riêng, và mỗi trạm có thể yêu cầu quiz, câu trả lời hoặc tệp minh chứng.',
  },
  ended: {
    label: 'Kết thúc',
    badgeCls: 'bg-ink/[0.07] text-ink/55',
    selectedCls: 'border-stone bg-paper text-ink/70',
    description: 'Dữ liệu không bị xoá khi sự kiện kết thúc. Bạn có thể mở lại từng giai đoạn để đối chiếu lịch sử.',
  },
}

const PHASE_PREFIX = {
  registration: 'REG',
  qualifying: 'VL',
  final: 'CK',
  ended: 'ARC',
}

const DEFAULT_PHASE_OPTIONS = [
  { key: 'registration', label: 'Đăng ký' },
  { key: 'qualifying', label: 'Vòng loại' },
  { key: 'final', label: 'Chung kết' },
  { key: 'ended', label: 'Kết thúc' },
]

const MODE_META = {
  form: {
    label: 'Biểu mẫu',
    hint: 'Thu thập câu trả lời tự do theo từng trường.',
    icon: 'doc',
    cls: 'bg-[#3E7CA8]/12 text-[#3E7CA8]',
    selectedCls: 'border-[#3E7CA8]/25 bg-[#3E7CA8]/10 text-[#3E7CA8]',
  },
  quiz: {
    label: 'Trắc nghiệm',
    hint: 'Câu hỏi có đáp án lựa chọn và đáp án đúng.',
    icon: 'listBullet',
    cls: 'bg-gold/15 text-gold',
    selectedCls: 'border-gold/30 bg-gold/10 text-gold',
  },
  attachment: {
    label: 'Tệp',
    hint: 'Yêu cầu đội nộp ảnh, PDF hoặc tệp minh chứng.',
    icon: 'paperclip',
    cls: 'bg-trail/12 text-trail',
    selectedCls: 'border-trail/30 bg-trail/10 text-trail',
  },
}

const CHECKIN_POLICY_META = {
  staff_scan: {
    label: 'Can coop scan',
    hint: 'Doi phai duoc check-in/check-out boi admin hoac co-op.',
    cls: 'bg-gold/15 text-gold',
  },
  free_play: {
    label: 'Tu do vao choi',
    hint: 'Khong bat buoc admin/co-op scan check-in tai tram nay.',
    cls: 'bg-ink/[0.07] text-ink/55',
  },
}

const CAPACITY_MODE_META = {
  unlimited: {
    label: 'Khong gioi han',
    hint: 'Khong gioi han so doi choi cung luc.',
  },
  limited: {
    label: 'Gioi han dong thoi',
    hint: 'Chi mot so doi duoc choi cung luc.',
  },
}

function makeLocalId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`
}

function createFormField(field = {}) {
  return {
    id: field.id ?? makeLocalId('field'),
    label: field.label ?? '',
    placeholder: field.placeholder ?? '',
    required: field.required ?? true,
  }
}

function createQuizItem(item = {}) {
  const nextOptions = Array.isArray(item.options) ? [...item.options] : []
  while (nextOptions.length < 4) nextOptions.push('')

  return {
    id: item.id ?? makeLocalId('quiz'),
    question: item.question ?? '',
    options: nextOptions.slice(0, 4),
    correctOption: Number.isInteger(item.correctOption) ? item.correctOption : 0,
  }
}

function createAttachmentConfig(attachment = {}) {
  return {
    enabled: attachment.enabled ?? false,
    maxFiles: Math.max(1, Number(attachment.maxFiles) || 1),
    allowedTypes: attachment.allowedTypes ?? 'JPG, PNG, PDF',
    note: attachment.note ?? '',
  }
}

function createSubmissionConfig(submission = {}) {
  const formFields = Array.isArray(submission.form?.fields) && submission.form.fields.length > 0
    ? submission.form.fields.map(createFormField)
    : [createFormField()]
  const quizItems = Array.isArray(submission.quiz?.items) && submission.quiz.items.length > 0
    ? submission.quiz.items.map(createQuizItem)
    : [createQuizItem()]

  return {
    brief: submission.brief ?? '',
    form: {
      enabled: submission.form?.enabled ?? false,
      fields: formFields,
    },
    quiz: {
      enabled: submission.quiz?.enabled ?? false,
      items: quizItems,
    },
    attachment: createAttachmentConfig(submission.attachment),
  }
}

function createBlankStation() {
  return {
    id: '',
    order: 0,
    name: '',
    location: '',
    active: true,
    checkinPolicy: 'staff_scan',
    capacityMode: 'unlimited',
    maxConcurrentTeams: 2,
    teamsHere: [],
    teamsDone: [],
    submission: createSubmissionConfig(),
  }
}

function createStation(station = {}) {
  const next = {
    ...createBlankStation(),
    ...station,
  }

  next.teamsHere = Array.isArray(station.teamsHere) ? station.teamsHere.map(team => ({ ...team })) : []
  next.teamsDone = Array.isArray(station.teamsDone)
    ? station.teamsDone.map((team, index) => ({
      ...team,
      score: Number.isFinite(Number(team.score)) ? Number(team.score) : Math.max(5, 25 - index * 5),
    }))
    : []
  next.checkinPolicy = Object.hasOwn(CHECKIN_POLICY_META, station.checkinPolicy) ? station.checkinPolicy : 'staff_scan'
  next.capacityMode = station.capacityMode === 'limited' ? 'limited' : 'unlimited'
  next.maxConcurrentTeams = Math.max(1, Number(station.maxConcurrentTeams) || 2)
  next.submission = createSubmissionConfig(station.submission)

  return next
}

const REGISTRATION_STATIONS = [
  createStation({
    id: 'REG01',
    order: 1,
    name: 'Bàn hồ sơ · UIT',
    location: 'Sảnh toà nhà E, UIT',
    active: true,
    teamsHere: [
      { id: 'T0012', name: 'Northern Lights', arrivedAt: '08:30' },
      { id: 'T0018', name: 'Next Horizon', arrivedAt: '08:42' },
    ],
    teamsDone: [
      { id: 'T0003', name: 'Những chiến binh', doneAt: '08:12' },
      { id: 'T0007', name: 'Dark Matter', doneAt: '08:18' },
      { id: 'T0010', name: 'Nova', doneAt: '08:24' },
    ],
    submission: {
      brief: 'Điểm tiếp nhận hồ sơ đội và xác nhận thông tin liên hệ trước khi vào thi.',
      form: {
        enabled: true,
        fields: [
          { label: 'Số điện thoại đội trưởng', placeholder: 'Nhập số điện thoại đang dùng', required: true },
          { label: 'Tên cố vấn / liên hệ khẩn cấp', placeholder: 'Nếu có', required: false },
        ],
      },
    },
  }),
  createStation({
    id: 'REG02',
    order: 2,
    name: 'Quầy phát số báo danh',
    location: 'Sảnh hội trường A',
    active: false,
    submission: {
      brief: 'Nhận bản scan thẻ sinh viên hoặc giấy tờ đối chiếu để cấp số báo danh.',
      attachment: {
        enabled: true,
        maxFiles: 1,
        allowedTypes: 'JPG, PNG, PDF',
        note: 'Một tệp minh chứng giấy tờ đối chiếu.',
      },
    },
  }),
  createStation({
    id: 'REG03',
    order: 3,
    name: 'Khu briefing đội thi',
    location: 'Phong 201 · UIT',
    active: false,
  }),
]

const QUALIFYING_STATIONS = [
  createStation({
    id: 'VL01',
    order: 1,
    name: 'Tram 1 · UIT',
    location: 'Khu pho 6, P. Linh Trung, TP. Thu Duc',
    active: true,
    teamsHere: [
      { id: 'T0003', name: 'Những chiến binh', arrivedAt: '14:20' },
      { id: 'T0005', name: 'Thunder', arrivedAt: '14:35' },
      { id: 'T0009', name: 'Red Storm', arrivedAt: '14:48' },
      { id: 'T0011', name: 'Doi moi', arrivedAt: '15:01' },
    ],
    teamsDone: [
      { id: 'T0001', name: 'Sky Walker', doneAt: '12:10' },
      { id: 'T0002', name: 'Fire Phoenix', doneAt: '12:45' },
      { id: 'T0004', name: 'Ice Breaker', doneAt: '13:02' },
      { id: 'T0006', name: 'Blue Ocean', doneAt: '13:30' },
      { id: 'T0007', name: 'Dark Matter', doneAt: '13:55' },
    ],
    submission: {
      brief: 'Tìm mật mã và giải thích cách đội giải được clue trong 2-3 câu ngắn.',
      form: {
        enabled: true,
        fields: [
          { label: 'Mật mã tìm được', placeholder: 'VD: UIT-314', required: true },
          { label: 'Tóm tắt cách giải', placeholder: 'Mô tả ngắn gọn cách đội suy luận', required: true },
        ],
      },
    },
  }),
  createStation({
    id: 'VL02',
    order: 2,
    name: 'Tram 2 · Thu vien Khoa hoc Tong hop',
    location: '69 Dinh Tien Hoang, Q.1, TP. HCM',
    active: true,
    teamsHere: [
      { id: 'T0001', name: 'Sky Walker', arrivedAt: '14:55' },
      { id: 'T0002', name: 'Fire Phoenix', arrivedAt: '15:05' },
    ],
    teamsDone: [
      { id: 'T0006', name: 'Blue Ocean', doneAt: '13:20' },
      { id: 'T0007', name: 'Dark Matter', doneAt: '13:48' },
      { id: 'T0008', name: 'Green Wave', doneAt: '14:10' },
    ],
    submission: {
      brief: 'Trả lời nhanh các câu hỏi kiến thức tại trạm.',
      quiz: {
        enabled: true,
        items: [
          {
            question: 'Nhân vật nào được đặt tên cho thư viện?',
            options: ['Le Quy Don', 'Nguyen Dinh Chieu', 'Tran Hung Dao', 'Ho Xuan Huong'],
            correctOption: 1,
          },
          {
            question: 'Khu vuc doc mo cua thu vien nam o tang nao?',
            options: ['Tang 1', 'Tang 2', 'Tang 3', 'Tang 4'],
            correctOption: 2,
          },
        ],
      },
    },
  }),
  createStation({
    id: 'VL03',
    order: 3,
    name: 'Tram 3 · Trung tam GDQP&AN',
    location: 'Duong so 6, KDT Dai hoc Quoc gia, TP. Thu Duc',
    active: true,
    teamsHere: [
      { id: 'T0004', name: 'Ice Breaker', arrivedAt: '14:30' },
      { id: 'T0006', name: 'Blue Ocean', arrivedAt: '14:50' },
      { id: 'T0010', name: 'Nova', arrivedAt: '15:10' },
    ],
    teamsDone: [
      { id: 'T0001', name: 'Sky Walker', doneAt: '11:30' },
      { id: 'T0002', name: 'Fire Phoenix', doneAt: '12:00' },
    ],
    submission: {
      brief: 'Nop anh minh chung sau khi doi vuot qua bai tap van dong.',
      attachment: {
        enabled: true,
        maxFiles: 2,
        allowedTypes: 'JPG, PNG',
        note: 'Can ro mat doi va bang ten tram trong anh.',
      },
    },
  }),
  createStation({
    id: 'VL04',
    order: 4,
    name: 'Tram 4 · Dai hoc Bach Khoa',
    location: '268 Ly Thuong Kiet, Q.10, TP. HCM',
    active: true,
    teamsHere: [
      { id: 'T0007', name: 'Dark Matter', arrivedAt: '15:00' },
    ],
    teamsDone: [
      { id: 'T0001', name: 'Sky Walker', doneAt: '13:10' },
    ],
    submission: {
      brief: 'Tram ket hop tra loi va nop file minh chung.',
      form: {
        enabled: true,
        fields: [
          { label: 'Số vật phẩm thu thập được', placeholder: 'Nhập tổng số', required: true },
        ],
      },
      attachment: {
        enabled: true,
        maxFiles: 1,
        allowedTypes: 'JPG, PNG, PDF',
        note: 'Nop anh chup vat pham tai diem ket thuc.',
      },
    },
  }),
  createStation({
    id: 'VL05',
    order: 5,
    name: 'Tram 5 · Nha Van hoa Thanh nien',
    location: '4 Pham Ngoc Thach, Q.1, TP. HCM',
    active: false,
  }),
  createStation({
    id: 'VL06',
    order: 6,
    name: 'Tram dich · SVD Thong Nhat',
    location: '138 Dao Duy Tu, Q.10, TP. HCM',
    active: false,
    submission: {
      brief: 'Tong hop bai nop cuoi cung de cham diem ve dich.',
      form: {
        enabled: true,
        fields: [
          { label: 'Cảm nhận ngắn sau hành trình', placeholder: '2-3 câu ngắn', required: false },
        ],
      },
      attachment: {
        enabled: true,
        maxFiles: 3,
        allowedTypes: 'JPG, PNG, MP4',
        note: 'Co the nop anh hoac clip tong ket hanh trinh.',
      },
    },
  }),
]

const FINAL_STATIONS = [
  createStation({
    id: 'CK01',
    order: 1,
    name: 'Final · San khoi dong',
    location: 'Khu vuc xuat phat · Cong vien phia dong',
    active: true,
    teamsHere: [
      { id: 'T0001', name: 'Sky Walker', arrivedAt: '17:20' },
      { id: 'T0003', name: 'Những chiến binh', arrivedAt: '17:25' },
    ],
    teamsDone: [
      { id: 'T0002', name: 'Fire Phoenix', doneAt: '17:05' },
    ],
    submission: {
      brief: 'Quiz mo man chung ket de kich hoat clue tiep theo.',
      quiz: {
        enabled: true,
        items: [
          {
            question: 'Manh clue dau tien dan doi den khu vuc nao?',
            options: ['San khau', 'Khu trung tam', 'Leu checkpoint', 'Cong chinh'],
            correctOption: 1,
          },
        ],
      },
    },
  }),
  createStation({
    id: 'CK02',
    order: 2,
    name: 'Final · Tram giai ma',
    location: 'Nha dieu hanh trung tam',
    active: true,
    teamsHere: [
      { id: 'T0002', name: 'Fire Phoenix', arrivedAt: '17:28' },
    ],
    teamsDone: [
      { id: 'T0001', name: 'Sky Walker', doneAt: '17:18' },
      { id: 'T0004', name: 'Ice Breaker', doneAt: '17:23' },
    ],
    submission: {
      brief: 'Can nop dap an cuoi va file chup manh ghep sau khi giai xong.',
      form: {
        enabled: true,
        fields: [
          { label: 'Đáp án cuối', placeholder: 'Nhập đáp án của đội', required: true },
        ],
      },
      attachment: {
        enabled: true,
        maxFiles: 1,
        allowedTypes: 'JPG, PNG',
        note: 'Anh chup manh ghep hoan chinh.',
      },
    },
  }),
  createStation({
    id: 'CK03',
    order: 3,
    name: 'Final · Tram but toc',
    location: 'Duong chay noi khu',
    active: false,
    teamsDone: [
      { id: 'T0003', name: 'Những chiến binh', doneAt: '17:15' },
      { id: 'T0005', name: 'Thunder', doneAt: '17:19' },
    ],
    submission: {
      brief: 'Anh minh chung qua vach dong thoi tra loi cau hoi an tuong.',
      form: {
        enabled: true,
        fields: [
          { label: 'Mô tả vật cản đặc biệt', placeholder: 'Nhập một mô tả ngắn', required: true },
        ],
      },
      attachment: {
        enabled: true,
        maxFiles: 2,
        allowedTypes: 'JPG, PNG',
        note: 'Mot anh toan doi va mot anh checkpoint neu can.',
      },
    },
  }),
  createStation({
    id: 'CK04',
    order: 4,
    name: 'Final · Vach dich',
    location: 'San khau chung ket',
    active: false,
  }),
]

const ENDED_STATIONS = [
  createStation({
    id: 'ARC01',
    order: 1,
    name: 'Tong ket · Vong loai',
    location: 'Kho minh chung su kien',
    active: false,
    teamsDone: [
      { id: 'T0001', name: 'Sky Walker', doneAt: '18:00' },
      { id: 'T0002', name: 'Fire Phoenix', doneAt: '18:00' },
      { id: 'T0003', name: 'Những chiến binh', doneAt: '18:00' },
    ],
    submission: {
      brief: 'Luu metadata cua tat ca bai nop vong loai de doi chieu sau su kien.',
      form: {
        enabled: true,
        fields: [
          { label: 'Ghi chú đối soát', placeholder: 'Ghi chú nội bộ nếu cần', required: false },
        ],
      },
      attachment: {
        enabled: true,
        maxFiles: 5,
        allowedTypes: 'ZIP, PDF, JPG, PNG',
        note: 'Kho minh chung tong hop sau vong loai.',
      },
    },
  }),
  createStation({
    id: 'ARC02',
    order: 2,
    name: 'Tong ket · Chung ket',
    location: 'Phong dieu hanh',
    active: false,
    teamsDone: [
      { id: 'T0001', name: 'Sky Walker', doneAt: '19:20' },
      { id: 'T0002', name: 'Fire Phoenix', doneAt: '19:20' },
    ],
    submission: {
      brief: 'Luu ket qua quiz va tep minh chung cua chung ket.',
      quiz: {
        enabled: true,
        items: [
          {
            question: 'Da xac nhan ket qua chung ket?',
            options: ['Chua', 'Da xac nhan', 'Can doi soat', 'Khac'],
            correctOption: 1,
          },
        ],
      },
      attachment: {
        enabled: true,
        maxFiles: 2,
        allowedTypes: 'PDF, XLSX',
        note: 'Bien ban cham diem va bang tong hop ket qua.',
      },
    },
  }),
]

function normalizeStations(stations = []) {
  return [...stations]
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
    .map((station, index) => ({
      ...createStation(station),
      order: Number.isFinite(station.order) ? station.order : index + 1,
    }))
}

function reindexStations(stations = []) {
  return normalizeStations(stations).map((station, index) => ({
    ...station,
    order: index + 1,
  }))
}

function sumStationScore(station) {
  return (station?.teamsDone ?? []).reduce((total, team) => total + (Number(team.score) || 0), 0)
}

function formatCapacitySummary(station) {
  if (station?.capacityMode === 'limited') {
    return `${station.maxConcurrentTeams} doi cung luc`
  }
  return 'Khong gioi han'
}

function getDefaultStationsByPhaseEvent() {
  return {
    registration: {
      'reg-approval': normalizeStations(REGISTRATION_STATIONS),
    },
    qualifying: {
      'qual-station-map': normalizeStations(QUALIFYING_STATIONS),
    },
    final: {
      'final-station-map': normalizeStations(FINAL_STATIONS),
    },
    ended: {
      'ended-summary': normalizeStations(ENDED_STATIONS),
    },
  }
}

const LEGACY_MIGRATION_TARGET = {
  registration: 'reg-approval',
  qualifying: 'qual-station-map',
  final: 'final-station-map',
  ended: 'ended-summary',
}

function normalizePhaseEventBucket(bucket = {}) {
  if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) return {}

  return Object.fromEntries(
    Object.entries(bucket)
      .filter(([, stations]) => Array.isArray(stations))
      .map(([eventId, stations]) => [eventId, normalizeStations(stations)]),
  )
}

function buildEmptyPhaseBuckets(phaseKeys) {
  return Object.fromEntries(phaseKeys.map(phaseKey => [phaseKey, {}]))
}

function readStationStore(storageKey) {
  try {
    const raw = JSON.parse(window.localStorage.getItem(storageKey) || 'null')
    return raw && typeof raw === 'object' ? raw : null
  } catch {
    return null
  }
}

function normalizeStoreShape(rawStore, phaseKeys) {
  return phaseKeys.reduce((result, phaseKey) => {
    const phaseBucket = rawStore?.[phaseKey]
    if (Array.isArray(phaseBucket)) {
      const targetEventId = LEGACY_MIGRATION_TARGET[phaseKey]
      result[phaseKey] = targetEventId ? { [targetEventId]: normalizeStations(phaseBucket) } : {}
      return result
    }

    result[phaseKey] = normalizePhaseEventBucket(phaseBucket)
    return result
  }, buildEmptyPhaseBuckets(phaseKeys))
}

function loadStationsByPhaseEvent(phaseKeys) {
  const defaults = getDefaultStationsByPhaseEvent()
  if (typeof window === 'undefined') return defaults

  const currentStore = readStationStore(STATIONS_STORAGE_KEY)
  if (currentStore) {
    return normalizeStoreShape(currentStore, phaseKeys)
  }

  const legacyStore = readStationStore(LEGACY_STATIONS_STORAGE_KEY)
  if (legacyStore) {
    return normalizeStoreShape(legacyStore, phaseKeys)
  }

  return defaults
}

function makeStationId(phase, stations) {
  const prefix = PHASE_PREFIX[phase] ?? 'ST'
  const nextNumber = stations.reduce((max, station) => {
    const matched = String(station.id).match(/(\d+)$/)
    return Math.max(max, matched ? Number(matched[1]) : 0)
  }, 0) + 1

  return `${prefix}${String(nextNumber).padStart(2, '0')}`
}

function getSubmissionModes(submission) {
  const modes = []
  if (submission?.form?.enabled) modes.push({ key: 'form', ...MODE_META.form })
  if (submission?.quiz?.enabled) modes.push({ key: 'quiz', ...MODE_META.quiz })
  if (submission?.attachment?.enabled) modes.push({ key: 'attachment', ...MODE_META.attachment })
  return modes
}

function hasSubmissionConfig(submission) {
  return getSubmissionModes(submission).length > 0
}

function stripMarkdown(markdown = '') {
  return markdown
    .replace(/\r\n/g, '\n')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/^>\s?/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/[>*_~]/g, '')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeUrl(url = '') {
  const trimmed = url.trim()
  if (/^https?:\/\//i.test(trimmed) || /^mailto:/i.test(trimmed)) return trimmed
  return null
}

function renderInlineMarkdown(text, keyPrefix = 'md') {
  const pattern = /(\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`|\*([^*]+)\*)/g
  const nodes = []
  let cursor = 0
  let match

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) {
      nodes.push(text.slice(cursor, match.index))
    }

    if (match[2]) {
      const href = normalizeUrl(match[3])
      if (href) {
        nodes.push(
          <a
            key={`${keyPrefix}-${nodes.length}`}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-[#3E7CA8] underline underline-offset-2"
          >
            {match[2]}
          </a>,
        )
      } else {
        nodes.push(match[2])
      }
    } else if (match[4]) {
      nodes.push(<strong key={`${keyPrefix}-${nodes.length}`} className="font-semibold text-ink">{match[4]}</strong>)
    } else if (match[5]) {
      nodes.push(
        <code
          key={`${keyPrefix}-${nodes.length}`}
          className="rounded bg-ink/[0.06] px-1.5 py-0.5 font-mono text-[0.92em] text-ink"
        >
          {match[5]}
        </code>,
      )
    } else if (match[6]) {
      nodes.push(<em key={`${keyPrefix}-${nodes.length}`} className="italic text-ink">{match[6]}</em>)
    }

    cursor = pattern.lastIndex
  }

  if (cursor < text.length) {
    nodes.push(text.slice(cursor))
  }

  return nodes.length > 0 ? nodes : text
}

function MarkdownPreview({ content, emptyMessage = 'Chua co mo ta markdown.' }) {
  const normalized = content.replace(/\r\n/g, '\n').trim()
  if (!normalized) {
    return <p className="text-sm italic text-ink/35">{emptyMessage}</p>
  }

  const lines = normalized.split('\n')
  const blocks = []
  let index = 0

  const isBlockStart = (line) => (
    /^#{1,6}\s+/.test(line)
    || /^>\s?/.test(line)
    || /^[-*+]\s+/.test(line)
    || /^\d+\.\s+/.test(line)
    || line.trim().startsWith('```')
  )

  while (index < lines.length) {
    const line = lines[index]
    const trimmed = line.trim()

    if (!trimmed) {
      index += 1
      continue
    }

    if (trimmed.startsWith('```')) {
      const codeLines = []
      index += 1
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        codeLines.push(lines[index])
        index += 1
      }
      if (index < lines.length) index += 1

      blocks.push(
        <pre
          key={`code-${blocks.length}`}
          className="overflow-x-auto rounded-xl bg-ink px-4 py-3 font-mono text-xs leading-6 text-white"
        >
          <code>{codeLines.join('\n')}</code>
        </pre>,
      )
      continue
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.*)$/)
    if (headingMatch) {
      const level = headingMatch[1].length
      const headingText = headingMatch[2]
      const className = level === 1
        ? 'font-display text-xl font-semibold text-ink'
        : level === 2
          ? 'font-display text-lg font-semibold text-ink'
          : 'font-display text-base font-semibold text-ink'

      blocks.push(
        <div key={`heading-${blocks.length}`} className={className}>
          {renderInlineMarkdown(headingText, `heading-${blocks.length}`)}
        </div>,
      )
      index += 1
      continue
    }

    if (/^>\s?/.test(line)) {
      const quoteLines = []
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/, ''))
        index += 1
      }

      blocks.push(
        <blockquote
          key={`quote-${blocks.length}`}
          className="border-l-4 border-gold/50 bg-gold/10 px-4 py-3 text-sm leading-6 text-ink/75"
        >
          {quoteLines.map((quoteLine, quoteIndex) => (
            <p key={`quote-line-${quoteIndex}`}>
              {renderInlineMarkdown(quoteLine, `quote-${blocks.length}-${quoteIndex}`)}
            </p>
          ))}
        </blockquote>,
      )
      continue
    }

    if (/^[-*+]\s+/.test(line)) {
      const items = []
      while (index < lines.length && /^[-*+]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^[-*+]\s+/, ''))
        index += 1
      }

      blocks.push(
        <ul key={`ul-${blocks.length}`} className="space-y-2 pl-5 text-sm leading-6 text-ink/75">
          {items.map((item, itemIndex) => (
            <li key={`ul-item-${itemIndex}`} className="list-disc">
              {renderInlineMarkdown(item, `ul-${blocks.length}-${itemIndex}`)}
            </li>
          ))}
        </ul>,
      )
      continue
    }

    if (/^\d+\.\s+/.test(line)) {
      const items = []
      while (index < lines.length && /^\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\d+\.\s+/, ''))
        index += 1
      }

      blocks.push(
        <ol key={`ol-${blocks.length}`} className="space-y-2 pl-5 text-sm leading-6 text-ink/75">
          {items.map((item, itemIndex) => (
            <li key={`ol-item-${itemIndex}`} className="list-decimal">
              {renderInlineMarkdown(item, `ol-${blocks.length}-${itemIndex}`)}
            </li>
          ))}
        </ol>,
      )
      continue
    }

    const paragraphLines = []
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index])) {
      paragraphLines.push(lines[index].trim())
      index += 1
    }

    blocks.push(
      <p key={`p-${blocks.length}`} className="text-sm leading-7 text-ink/75">
        {renderInlineMarkdown(paragraphLines.join(' '), `p-${blocks.length}`)}
      </p>,
    )
  }

  return <div className="space-y-3">{blocks}</div>
}

function sanitizeSubmission(submission) {
  const next = createSubmissionConfig(submission)
  next.brief = next.brief.trim()
  next.form.fields = next.form.fields.map(field => ({
    ...field,
    label: field.label.trim(),
    placeholder: field.placeholder.trim(),
  }))
  next.quiz.items = next.quiz.items.map(item => ({
    ...item,
    question: item.question.trim(),
    options: item.options.map(option => option.trim()),
  }))
  next.attachment.allowedTypes = next.attachment.allowedTypes.trim()
  next.attachment.note = next.attachment.note.trim()
  return next
}

function PhaseSwitcher({ phase, phaseOptions, onChange }) {
  return (
    <div className="flex flex-wrap gap-2">
      {phaseOptions.map(option => {
        const active = option.key === phase
        const meta = PHASE_META[option.key] ?? PHASE_META.registration
        return (
          <button
            key={option.key}
            type="button"
            onClick={() => onChange(option.key)}
            className={`rounded-full border px-3 py-2 text-sm font-semibold transition ${
              active
                ? meta.selectedCls
                : 'border-stone bg-white text-ink/55 hover:bg-paper hover:text-ink'
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

function ModeBadge({ mode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${mode.cls}`}>
      <Icon name={mode.icon} className="h-3.5 w-3.5" />
      {mode.label}
    </span>
  )
}

function SubmissionModeList({ submission, compact = false }) {
  const modes = getSubmissionModes(submission)

  if (modes.length === 0) {
    return <span className="text-xs text-ink/35">Khong co bai nop</span>
  }

  return (
    <div className={`flex flex-wrap gap-1.5 ${compact ? 'max-w-[240px]' : ''}`}>
      {modes.map(mode => <ModeBadge key={mode.key} mode={mode} />)}
    </div>
  )
}

function SummaryCard({ value, label, accent }) {
  const valueClass = accent === 'trail'
    ? 'text-trail'
    : accent === 'gold'
      ? 'text-gold'
      : accent === 'sky'
        ? 'text-[#3E7CA8]'
        : 'text-ink/70'

  return (
    <div className={`${CARD} px-4 py-3`}>
      <p className={`font-mono text-2xl font-bold leading-none ${valueClass}`}>{value}</p>
      <p className="mt-1.5 text-xs text-ink/40">{label}</p>
    </div>
  )
}

function StationEventSwitcher({ selectedEventId, events, stationsByEvent, onChange }) {
  return (
    <div className="grid gap-2 lg:grid-cols-2">
      {events.map((eventItem) => {
        const active = eventItem.id === selectedEventId
        const typeMeta = SUB_EVENT_TYPE_META[eventItem.type] ?? SUB_EVENT_TYPE_META.custom
        const stationCount = (stationsByEvent[eventItem.id] ?? []).length

        return (
          <button
            key={eventItem.id}
            type="button"
            onClick={() => onChange(eventItem.id)}
            className={`rounded-xl border px-4 py-3 text-left transition ${
              active
                ? 'border-gold/30 bg-gold/10 shadow-[0_3px_10px_rgba(32,49,43,0.08)]'
                : 'border-stone bg-white hover:bg-paper'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge label={typeMeta.label} cls={typeMeta.cls} />
                  <Badge label={`${stationCount} tram`} cls="bg-ink/[0.07] text-ink/55" />
                </div>
                <p className="mt-2 truncate text-sm font-semibold text-ink">{eventItem.name}</p>
                {eventItem.note && (
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-ink/45">{stripMarkdown(eventItem.note)}</p>
                )}
              </div>
              {active && (
                <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gold text-white">
                  <Icon name="checkPlain" className="h-3.5 w-3.5" />
                </span>
              )}
            </div>
          </button>
        )
      })}
    </div>
  )
}

function SectionTitle({ title, action }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/35">{title}</p>
      {action}
    </div>
  )
}

function MarkdownComposer({ value, onChange, placeholder }) {
  const [tab, setTab] = useState('write')
  const textareaRef = useRef(null)

  const updateWithSelection = (nextValue, selectionStart, selectionEnd) => {
    onChange(nextValue)
    window.requestAnimationFrame(() => {
      if (!textareaRef.current) return
      textareaRef.current.focus()
      textareaRef.current.setSelectionRange(selectionStart, selectionEnd)
    })
  }

  const wrapSelection = (before, after, fallback) => {
    const textarea = textareaRef.current
    if (!textarea) {
      onChange(`${value}${before}${fallback}${after}`)
      return
    }

    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const hasSelection = end > start
    const selected = hasSelection ? value.slice(start, end) : fallback
    const nextValue = `${value.slice(0, start)}${before}${selected}${after}${value.slice(end)}`
    const selectionFrom = start + before.length
    const selectionTo = selectionFrom + selected.length
    updateWithSelection(nextValue, selectionFrom, selectionTo)
  }

  const insertSnippet = (snippet, caretOffset = 0) => {
    const textarea = textareaRef.current
    if (!textarea) {
      onChange(`${value}${snippet}`)
      return
    }

    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const nextValue = `${value.slice(0, start)}${snippet}${value.slice(end)}`
    const caret = start + snippet.length + caretOffset
    updateWithSelection(nextValue, caret, caret)
  }

  const toolButton = 'rounded-lg border border-stone bg-white px-2 py-1 font-mono text-[11px] font-semibold text-ink/55 transition hover:bg-paper hover:text-ink'

  return (
    <div className="overflow-hidden rounded-xl border border-stone bg-white">
      <div className="flex flex-col gap-3 border-b border-stone px-3 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="inline-flex rounded-lg border border-stone bg-paper p-1">
          <button
            type="button"
            onClick={() => setTab('write')}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
              tab === 'write' ? 'bg-white text-ink shadow-sm' : 'text-ink/50 hover:text-ink'
            }`}
          >
            Soan thao
          </button>
          <button
            type="button"
            onClick={() => setTab('preview')}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
              tab === 'preview' ? 'bg-white text-ink shadow-sm' : 'text-ink/50 hover:text-ink'
            }`}
          >
            Xem truoc
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => insertSnippet('# ')} className={toolButton}>#</button>
          <button type="button" onClick={() => insertSnippet('## ')} className={toolButton}>##</button>
          <button type="button" onClick={() => insertSnippet('- ')} className={toolButton}>-</button>
          <button type="button" onClick={() => wrapSelection('**', '**', 'dam')} className={toolButton}>**</button>
          <button type="button" onClick={() => wrapSelection('`', '`', 'code')} className={toolButton}>`</button>
          <button type="button" onClick={() => wrapSelection('[', '](https://example.com)', 'link')} className={toolButton}>[]</button>
          <button type="button" onClick={() => insertSnippet('> ')} className={toolButton}>&gt;</button>
          <button type="button" onClick={() => insertSnippet('\n```\n\n```\n', -5)} className={toolButton}>```</button>
        </div>
      </div>

      {tab === 'write' ? (
        <textarea
          ref={textareaRef}
          rows={7}
          value={value}
          onChange={event => onChange(event.target.value)}
          placeholder={placeholder}
          className="w-full resize-y border-0 bg-white px-4 py-3 font-mono text-sm leading-6 text-ink outline-none placeholder:text-ink/30"
        />
      ) : (
        <div className="bg-paper px-4 py-4">
          <MarkdownPreview content={value} emptyMessage="Chua co mo ta de xem truoc." />
        </div>
      )}
    </div>
  )
}

function ModeCard({ modeKey, enabled, onToggle }) {
  const mode = MODE_META[modeKey]
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`rounded-xl border p-3 text-left transition ${
        enabled
          ? mode.selectedCls
          : 'border-stone bg-white text-ink/60 hover:bg-paper hover:text-ink'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <span className={`flex h-10 w-10 items-center justify-center rounded-lg ${enabled ? mode.cls : 'bg-paper text-ink/35'}`}>
          <Icon name={mode.icon} className="h-5 w-5" />
        </span>
        <span className={`mt-1 h-2.5 w-2.5 rounded-full ${enabled ? 'bg-trail' : 'bg-ink/20'}`} />
      </div>
      <p className="mt-3 text-sm font-semibold text-ink">{mode.label}</p>
      <p className="mt-1 text-xs leading-5 text-ink/50">{mode.hint}</p>
    </button>
  )
}

function StationSubmissionOverview({ submission }) {
  const modes = getSubmissionModes(submission)

  return (
    <div className="px-4 pb-4">
      <SectionTitle title="Cau hinh bai nop" action={<SubmissionModeList submission={submission} />} />

      {modes.length === 0 ? (
        <div className={`${CARD} px-4 py-4 text-sm italic text-ink/35`}>
          Tram nay hien chua yeu cau doi nop form, trac nghiem hay file dinh kem.
        </div>
      ) : (
        <div className="space-y-3">
          {submission.brief && (
            <div className={`${CARD} px-4 py-3`}>
              <MarkdownPreview content={submission.brief} />
            </div>
          )}

          {submission.form.enabled && (
            <div className={`${CARD} px-4 py-4`}>
              <SectionTitle title="Form tra loi" />
              <div className="space-y-2.5">
                {submission.form.fields.map((field, index) => (
                  <div key={field.id} className="rounded-lg border border-stone bg-paper px-3 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-ink">{field.label || `Truong ${index + 1}`}</p>
                        <p className="mt-1 text-xs text-ink/45">{field.placeholder || 'Chua co goi y nhap lieu'}</p>
                      </div>
                      <Badge
                        label={field.required ? 'Bat buoc' : 'Tuy chon'}
                        cls={field.required ? 'bg-[#3E7CA8]/12 text-[#3E7CA8]' : 'bg-ink/[0.07] text-ink/45'}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {submission.quiz.enabled && (
            <div className={`${CARD} px-4 py-4`}>
              <SectionTitle title="Cau hoi trac nghiem" />
              <div className="space-y-3">
                {submission.quiz.items.map((item, index) => (
                  <div key={item.id} className="rounded-lg border border-stone bg-paper px-3 py-3">
                    <p className="text-sm font-medium text-ink">{index + 1}. {item.question || 'Chua dat noi dung cau hoi'}</p>
                    <div className="mt-3 grid gap-2">
                      {item.options.map((option, optionIndex) => (
                        <div
                          key={`${item.id}-${optionIndex}`}
                          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                            optionIndex === item.correctOption
                              ? 'border-gold/40 bg-gold/10 text-ink'
                              : 'border-stone bg-white text-ink/55'
                          }`}
                        >
                          <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold ${
                            optionIndex === item.correctOption
                              ? 'bg-gold text-white'
                              : 'bg-paper text-ink/40'
                          }`}>
                            {String.fromCharCode(65 + optionIndex)}
                          </span>
                          <span>{option || 'Chua nhap lua chon'}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {submission.attachment.enabled && (
            <div className={`${CARD} px-4 py-4`}>
              <SectionTitle title="File dinh kem" />
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-stone bg-paper px-3 py-3">
                  <p className="text-xs text-ink/40">So file toi da</p>
                  <p className="mt-1 text-sm font-semibold text-ink">{submission.attachment.maxFiles} file</p>
                </div>
                <div className="rounded-lg border border-stone bg-paper px-3 py-3">
                  <p className="text-xs text-ink/40">Loai file cho phep</p>
                  <p className="mt-1 text-sm font-semibold text-ink">{submission.attachment.allowedTypes || 'Chua cau hinh'}</p>
                </div>
              </div>
              {submission.attachment.note && (
                <div className="mt-3 rounded-lg border border-stone bg-paper px-3 py-3 text-sm leading-6 text-ink/70">
                  {submission.attachment.note}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function StationFlowOverview({ station }) {
  const policyMeta = CHECKIN_POLICY_META[station.checkinPolicy] ?? CHECKIN_POLICY_META.staff_scan

  return (
    <div className="px-4 pb-4">
      <SectionTitle title="Van hanh check-in" />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className={`${CARD} px-4 py-3`}>
          <div className="flex items-center gap-2">
            <Badge label={policyMeta.label} cls={policyMeta.cls} />
          </div>
          <p className="mt-2 text-sm leading-6 text-ink/60">{policyMeta.hint}</p>
        </div>
        <div className={`${CARD} px-4 py-3`}>
          <p className="text-xs text-ink/40">Cong suat</p>
          <p className="mt-1 text-sm font-semibold text-ink">{formatCapacitySummary(station)}</p>
          <p className="mt-2 text-sm leading-6 text-ink/50">
            {station.capacityMode === 'limited'
              ? `He thong can chan them doi moi khi da co ${station.maxConcurrentTeams} doi dang choi.`
              : 'Tram nay khong can gioi han so doi dang choi cung luc.'}
          </p>
        </div>
      </div>
    </div>
  )
}

function StationForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(() => createStation(initial))

  const set = (key, value) => setForm(current => ({ ...current, [key]: value }))
  const updateSubmission = (updater) => {
    setForm(current => ({
      ...current,
      submission: updater(createSubmissionConfig(current.submission)),
    }))
  }

  const toggleMode = (modeKey) => {
    updateSubmission(submission => {
      const next = createSubmissionConfig(submission)
      if (modeKey === 'form') next.form.enabled = !next.form.enabled
      if (modeKey === 'quiz') next.quiz.enabled = !next.quiz.enabled
      if (modeKey === 'attachment') next.attachment.enabled = !next.attachment.enabled
      return next
    })
  }

  const updateField = (fieldId, key, value) => {
    updateSubmission(submission => ({
      ...submission,
      form: {
        ...submission.form,
        fields: submission.form.fields.map(field => (
          field.id === fieldId
            ? { ...field, [key]: value }
            : field
        )),
      },
    }))
  }

  const addField = () => {
    updateSubmission(submission => ({
      ...submission,
      form: {
        ...submission.form,
        fields: [...submission.form.fields, createFormField()],
      },
    }))
  }

  const removeField = (fieldId) => {
    updateSubmission(submission => ({
      ...submission,
      form: {
        ...submission.form,
        fields: submission.form.fields.length > 1
          ? submission.form.fields.filter(field => field.id !== fieldId)
          : submission.form.fields,
      },
    }))
  }

  const updateQuizItem = (itemId, key, value) => {
    updateSubmission(submission => ({
      ...submission,
      quiz: {
        ...submission.quiz,
        items: submission.quiz.items.map(item => (
          item.id === itemId
            ? { ...item, [key]: value }
            : item
        )),
      },
    }))
  }

  const updateQuizOption = (itemId, optionIndex, value) => {
    updateSubmission(submission => ({
      ...submission,
      quiz: {
        ...submission.quiz,
        items: submission.quiz.items.map(item => {
          if (item.id !== itemId) return item
          const nextOptions = [...item.options]
          nextOptions[optionIndex] = value
          return { ...item, options: nextOptions }
        }),
      },
    }))
  }

  const addQuizItem = () => {
    updateSubmission(submission => ({
      ...submission,
      quiz: {
        ...submission.quiz,
        items: [...submission.quiz.items, createQuizItem()],
      },
    }))
  }

  const removeQuizItem = (itemId) => {
    updateSubmission(submission => ({
      ...submission,
      quiz: {
        ...submission.quiz,
        items: submission.quiz.items.length > 1
          ? submission.quiz.items.filter(item => item.id !== itemId)
          : submission.quiz.items,
      },
    }))
  }

  const updateAttachment = (key, value) => {
    updateSubmission(submission => ({
      ...submission,
      attachment: {
        ...submission.attachment,
        [key]: value,
      },
    }))
  }

  const handleSave = () => {
    if (!form.name.trim()) return
    onSave({
      ...form,
      name: form.name.trim(),
      location: form.location.trim(),
      submission: sanitizeSubmission(form.submission),
    })
  }

  return (
    <div className="space-y-5 px-4 py-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40">
            Ten tram
          </label>
          <input
            value={form.name}
            onChange={event => set('name', event.target.value)}
            placeholder="Tram 1 · UIT"
            className="w-full rounded-lg border border-stone bg-paper px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
          />
        </div>

        <div className="sm:col-span-2">
          <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40">
            Dia diem
          </label>
          <input
            value={form.location}
            onChange={event => set('location', event.target.value)}
            placeholder="Dia chi tram..."
            className="w-full rounded-lg border border-stone bg-paper px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
          />
        </div>

        <div className="sm:col-span-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => set('active', !form.active)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${form.active ? 'bg-trail' : 'bg-stone'}`}
          >
            <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${form.active ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
          </button>
          <span className="text-sm text-ink/60">{form.active ? 'Đang hoạt động' : 'Chưa mở'}</span>
        </div>

        <div>
          <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40">
            Luong vao tram
          </label>
          <select
            value={form.checkinPolicy}
            onChange={event => set('checkinPolicy', event.target.value)}
            className="w-full rounded-lg border border-stone bg-paper px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
          >
            {Object.entries(CHECKIN_POLICY_META).map(([key, meta]) => (
              <option key={key} value={key}>{meta.label}</option>
            ))}
          </select>
          <p className="mt-1 text-xs leading-5 text-ink/45">
            {(CHECKIN_POLICY_META[form.checkinPolicy] ?? CHECKIN_POLICY_META.staff_scan).hint}
          </p>
        </div>

        <div>
          <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40">
            Cong suat dong thoi
          </label>
          <select
            value={form.capacityMode}
            onChange={event => set('capacityMode', event.target.value)}
            className="w-full rounded-lg border border-stone bg-paper px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
          >
            {Object.entries(CAPACITY_MODE_META).map(([key, meta]) => (
              <option key={key} value={key}>{meta.label}</option>
            ))}
          </select>
          <p className="mt-1 text-xs leading-5 text-ink/45">
            {(CAPACITY_MODE_META[form.capacityMode] ?? CAPACITY_MODE_META.unlimited).hint}
          </p>
        </div>

        {form.capacityMode === 'limited' && (
          <div className="sm:col-span-2">
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40">
              So doi toi da cung luc
            </label>
            <input
              type="number"
              min={1}
              value={form.maxConcurrentTeams}
              onChange={event => set('maxConcurrentTeams', Math.max(1, Number(event.target.value) || 1))}
              className="w-full rounded-lg border border-stone bg-paper px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
            />
          </div>
        )}
      </div>

      <div className="space-y-3">
        <SectionTitle
          title="Nhiem vu tram"
          action={<Badge label="Markdown" cls="bg-[#3E7CA8]/12 text-[#3E7CA8]" />}
        />
        <MarkdownComposer
          value={form.submission.brief}
          onChange={value => updateSubmission(submission => ({ ...submission, brief: value }))}
          placeholder="Mo ta nhiem vu, checklist, clue, luat tinh diem... bang Markdown."
        />
      </div>

      <div className="space-y-3">
        <SectionTitle title="Kieu bai nop" />
        <div className="grid gap-3 lg:grid-cols-3">
          <ModeCard modeKey="form" enabled={form.submission.form.enabled} onToggle={() => toggleMode('form')} />
          <ModeCard modeKey="quiz" enabled={form.submission.quiz.enabled} onToggle={() => toggleMode('quiz')} />
          <ModeCard modeKey="attachment" enabled={form.submission.attachment.enabled} onToggle={() => toggleMode('attachment')} />
        </div>
      </div>

      {form.submission.form.enabled && (
        <div className={`${CARD} p-4`}>
          <SectionTitle
            title="Cau hinh form"
            action={(
              <button
                type="button"
                onClick={addField}
                className="inline-flex items-center gap-1 rounded-lg border border-stone bg-white px-2.5 py-1.5 text-xs font-semibold text-ink/60 transition hover:bg-paper hover:text-ink"
              >
                <Icon name="plus" className="h-3.5 w-3.5" />
                Them truong
              </button>
            )}
          />
          <div className="space-y-3">
            {form.submission.form.fields.map((field, index) => (
              <div key={field.id} className="rounded-lg border border-stone bg-paper px-3 py-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-ink">Truong {index + 1}</p>
                  <button
                    type="button"
                    onClick={() => removeField(field.id)}
                    className="rounded-lg p-1.5 text-ink/35 transition hover:bg-white hover:text-clay"
                    title="Xoa truong"
                  >
                    <Icon name="trash" className="h-4 w-4" />
                  </button>
                </div>
                <div className="grid gap-3">
                  <input
                    value={field.label}
                    onChange={event => updateField(field.id, 'label', event.target.value)}
                    placeholder="Noi dung truong, vd: Mat ma tim duoc"
                    className="w-full rounded-lg border border-stone bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
                  />
                  <input
                    value={field.placeholder}
                    onChange={event => updateField(field.id, 'placeholder', event.target.value)}
                    placeholder="Goi y cach nhap du lieu"
                    className="w-full rounded-lg border border-stone bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
                  />
                  <label className="inline-flex items-center gap-2 text-sm text-ink/60">
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={event => updateField(field.id, 'required', event.target.checked)}
                      className="h-4 w-4 rounded border-stone text-trail focus:ring-trail/20"
                    />
                    Bat buoc
                  </label>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {form.submission.quiz.enabled && (
        <div className={`${CARD} p-4`}>
          <SectionTitle
            title="Cau hinh trac nghiem"
            action={(
              <button
                type="button"
                onClick={addQuizItem}
                className="inline-flex items-center gap-1 rounded-lg border border-stone bg-white px-2.5 py-1.5 text-xs font-semibold text-ink/60 transition hover:bg-paper hover:text-ink"
              >
                <Icon name="plus" className="h-3.5 w-3.5" />
                Them cau hoi
              </button>
            )}
          />
          <div className="space-y-3">
            {form.submission.quiz.items.map((item, index) => (
              <div key={item.id} className="rounded-lg border border-stone bg-paper px-3 py-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-ink">Cau hoi {index + 1}</p>
                  <button
                    type="button"
                    onClick={() => removeQuizItem(item.id)}
                    className="rounded-lg p-1.5 text-ink/35 transition hover:bg-white hover:text-clay"
                    title="Xoa cau hoi"
                  >
                    <Icon name="trash" className="h-4 w-4" />
                  </button>
                </div>

                <textarea
                  rows={2}
                  value={item.question}
                  onChange={event => updateQuizItem(item.id, 'question', event.target.value)}
                  placeholder="Nhap noi dung cau hoi"
                  className="w-full rounded-lg border border-stone bg-white px-3 py-2.5 text-sm leading-6 text-ink outline-none transition placeholder:text-ink/30 focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
                />

                <div className="mt-3 space-y-2.5">
                  {item.options.map((option, optionIndex) => (
                    <div key={`${item.id}-${optionIndex}`} className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => updateQuizItem(item.id, 'correctOption', optionIndex)}
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border text-xs font-semibold transition ${
                          optionIndex === item.correctOption
                            ? 'border-gold/40 bg-gold/10 text-gold'
                            : 'border-stone bg-white text-ink/40 hover:bg-paper'
                        }`}
                        title="Danh dau dap an dung"
                      >
                        {String.fromCharCode(65 + optionIndex)}
                      </button>
                      <input
                        value={option}
                        onChange={event => updateQuizOption(item.id, optionIndex, event.target.value)}
                        placeholder={`Lua chon ${String.fromCharCode(65 + optionIndex)}`}
                        className="w-full rounded-lg border border-stone bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {form.submission.attachment.enabled && (
        <div className={`${CARD} p-4`}>
          <SectionTitle title="Cau hinh file dinh kem" />
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40">
                So file toi da
              </label>
              <input
                type="number"
                min={1}
                value={form.submission.attachment.maxFiles}
                onChange={event => updateAttachment('maxFiles', Math.max(1, Number(event.target.value) || 1))}
                className="w-full rounded-lg border border-stone bg-paper px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
              />
            </div>
            <div>
              <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40">
                Dinh dang cho phep
              </label>
              <input
                value={form.submission.attachment.allowedTypes}
                onChange={event => updateAttachment('allowedTypes', event.target.value)}
                placeholder="JPG, PNG, PDF"
                className="w-full rounded-lg border border-stone bg-paper px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40">
                Ghi chu cho file dinh kem
              </label>
              <textarea
                rows={3}
                value={form.submission.attachment.note}
                onChange={event => updateAttachment('note', event.target.value)}
                placeholder="Huong dan doi can chup gi, dat ten file ra sao, can bao nhieu anh..."
                className="w-full rounded-lg border border-stone bg-paper px-3 py-2.5 text-sm leading-6 text-ink outline-none transition placeholder:text-ink/30 focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
              />
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-2 pt-1">
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
          Luu tram
        </button>
      </div>
    </div>
  )
}

function StationDrawer({
  station,
  phaseLabel,
  phaseBadgeCls,
  eventName,
  eventType,
  onClose,
  onToggleActive,
  onSave,
  onDelete,
}) {
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  if (!station) return null
  const status = STATUS[station.active ? 'active' : 'inactive']
  const eventMeta = SUB_EVENT_TYPE_META[eventType] ?? SUB_EVENT_TYPE_META.custom
  const totalScore = sumStationScore(station)

  const handleSave = (form) => {
    onSave(station.id, form)
    setEditing(false)
  }

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-ink/25 backdrop-blur-[2px]" onClick={onClose} />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-[560px] flex-col border-l border-stone bg-paper shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-stone bg-white px-5 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-xs font-semibold text-ink/40">{station.id}</span>
              <Badge {...status} />
              <Badge label={phaseLabel} cls={phaseBadgeCls} />
              {eventName && <Badge label={eventName} cls={eventMeta.cls} />}
            </div>
            <h2 className="mt-1 truncate font-display text-xl font-bold text-ink">{station.name}</h2>
            {station.location && (
              <div className="mt-0.5 flex items-start gap-1 text-sm text-ink/50">
                <Icon name="pin" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{station.location}</span>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-ink/40 transition hover:bg-paper hover:text-ink"
          >
            <Icon name="close" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {editing ? (
            <StationForm
              initial={station}
              onSave={handleSave}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2 px-4 py-4">
                <div className={`${CARD} px-3 py-2.5`}>
                  <p className="font-mono text-lg font-bold leading-none text-gold">{station.teamsHere.length}</p>
                  <p className="mt-1 text-[11px] text-ink/40">Đang ở đây</p>
                </div>
                <div className={`${CARD} px-3 py-2.5`}>
                  <p className="font-mono text-lg font-bold leading-none text-trail">{station.teamsDone.length}</p>
                  <p className="mt-1 text-[11px] text-ink/40">Đã hoàn thành</p>
                </div>
                <div className={`${CARD} px-3 py-2.5`}>
                  <p className="font-mono text-lg font-bold leading-none text-[#3E7CA8]">{totalScore}</p>
                  <p className="mt-1 text-[11px] text-ink/40">Tong diem tram</p>
                </div>
              </div>

              <StationFlowOverview station={station} />
              <StationSubmissionOverview submission={station.submission} />

              <div className="px-4 pb-4">
                <SectionTitle title={`Đang ở đây · ${station.teamsHere.length} đội`} />
                <div className={`${CARD} overflow-hidden divide-y divide-stone/50`}>
                  {station.teamsHere.length > 0 ? station.teamsHere.map(team => (
                    <div key={team.id} className="flex items-center justify-between px-4 py-2.5">
                      <div>
                        <p className="text-sm font-medium text-ink">{team.name}</p>
                        <p className="font-mono text-[11px] text-ink/40">{team.id}</p>
                      </div>
                      <span className="font-mono text-xs text-gold">{team.arrivedAt}</span>
                    </div>
                  )) : (
                    <p className="px-4 py-4 text-sm italic text-ink/30">Chua co doi nao o day.</p>
                  )}
                </div>
              </div>

              <div className="px-4 pb-5">
                <SectionTitle title={`Đã hoàn thành · ${station.teamsDone.length} đội`} />
                <div className={`${CARD} overflow-hidden divide-y divide-stone/50`}>
                  {station.teamsDone.length > 0 ? station.teamsDone.map(team => (
                    <div key={team.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink">{team.name}</p>
                        <p className="font-mono text-[11px] text-ink/40">{team.id}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="font-mono text-sm font-semibold text-[#3E7CA8]">{Number(team.score) || 0} diem</p>
                        <p className="font-mono text-[11px] text-trail">{team.doneAt}</p>
                      </div>
                    </div>
                  )) : (
                    <p className="px-4 py-4 text-sm italic text-ink/30">Chua co doi nao hoan thanh.</p>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {!editing && (
          <div className="border-t border-stone bg-white">
            {confirmDelete ? (
              <div className="space-y-3 px-4 py-4">
                <p className="text-sm text-ink">
                  Xoa tram <span className="font-semibold">{station.name}</span>?
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="flex-1 rounded-lg border border-stone bg-white py-2.5 text-sm font-semibold text-ink/60 transition hover:bg-paper"
                  >
                    Huy
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onDelete(station.id)
                      setConfirmDelete(false)
                    }}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-clay py-2.5 text-sm font-semibold text-white transition hover:brightness-[0.96]"
                  >
                    <Icon name="trash" className="h-4 w-4" />
                    Xac nhan xoa
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2 px-4 py-4">
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="rounded-lg border border-stone p-2.5 text-ink/35 transition hover:border-clay/30 hover:text-clay"
                  title="Xoa tram"
                >
                  <Icon name="trash" className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onToggleActive(station.id)}
                  className={`flex-1 rounded-lg border py-2.5 text-sm font-semibold transition ${
                    station.active
                      ? 'border-ink/15 bg-white text-ink/60 hover:bg-paper'
                      : 'border-trail/30 bg-trail/[0.06] text-trail hover:bg-trail/10'
                  }`}
                >
                  {station.active ? 'Tam ngung tram' : 'Kich hoat tram'}
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-ink py-2.5 text-sm font-semibold text-white transition hover:brightness-[0.9]"
                >
                  Chinh sua
                </button>
              </div>
            )}
          </div>
        )}
      </aside>
    </div>
  )
}

function StationsPage({
  phase = 'registration',
  phaseOptions = DEFAULT_PHASE_OPTIONS,
  phaseEvents = [],
  onPhaseChange = () => {},
}) {
  const phaseKeys = useMemo(
    () => phaseOptions.map(option => option.key),
    [phaseOptions],
  )
  const phaseStationEvents = useMemo(
    () => phaseEvents.filter(eventItem => eventItem.usesStations),
    [phaseEvents],
  )

  const [stationsByPhaseEvent, setStationsByPhaseEvent] = useState(() => loadStationsByPhaseEvent(phaseKeys))
  const [selectedEventId, setSelectedEventId] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    setStationsByPhaseEvent((current) => {
      let changed = false
      const next = { ...current }

      phaseKeys.forEach((phaseKey) => {
        if (!next[phaseKey] || typeof next[phaseKey] !== 'object' || Array.isArray(next[phaseKey])) {
          next[phaseKey] = {}
          changed = true
        }
      })

      const currentPhaseBucket = { ...(next[phase] ?? {}) }
      phaseStationEvents.forEach((eventItem) => {
        if (!Array.isArray(currentPhaseBucket[eventItem.id])) {
          currentPhaseBucket[eventItem.id] = []
          changed = true
        }
      })
      next[phase] = currentPhaseBucket

      return changed ? next : current
    })
  }, [phase, phaseKeys, phaseStationEvents])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(STATIONS_STORAGE_KEY, JSON.stringify(stationsByPhaseEvent))
  }, [stationsByPhaseEvent])

  useEffect(() => {
    if (phaseStationEvents.length === 0) {
      setSelectedEventId('')
      return
    }

    if (!selectedEventId || !phaseStationEvents.some(eventItem => eventItem.id === selectedEventId)) {
      setSelectedEventId(phaseStationEvents[0].id)
    }
  }, [phaseStationEvents, selectedEventId])

  useEffect(() => {
    setSelectedId(null)
    setAdding(false)
  }, [phase, selectedEventId])

  const phaseBucket = useMemo(
    () => stationsByPhaseEvent[phase] ?? {},
    [phase, stationsByPhaseEvent],
  )
  const selectedEvent = phaseStationEvents.find(eventItem => eventItem.id === selectedEventId) ?? null
  const stations = useMemo(
    () => (selectedEventId ? phaseBucket[selectedEventId] ?? [] : []),
    [phaseBucket, selectedEventId],
  )
  const phaseInfo = phaseOptions.find(option => option.key === phase) ?? DEFAULT_PHASE_OPTIONS[0]
  const phaseMeta = PHASE_META[phase] ?? PHASE_META.registration

  useEffect(() => {
    if (selectedId && !stations.some(station => station.id === selectedId)) {
      setSelectedId(null)
    }
  }, [selectedId, stations])

  const selected = stations.find(station => station.id === selectedId) ?? null
  const active = stations.filter(station => station.active)
  const inactive = stations.filter(station => !station.active)
  const totalHere = stations.reduce((total, station) => total + station.teamsHere.length, 0)
  const totalDone = stations.reduce((total, station) => total + station.teamsDone.length, 0)
  const configured = stations.filter(station => hasSubmissionConfig(station.submission))
  const attachmentRequired = stations.filter(station => station.submission.attachment.enabled)
  const totalScore = stations.reduce((total, station) => total + sumStationScore(station), 0)

  const updatePhaseEventStations = (updater) => {
    if (!selectedEventId) return
    setStationsByPhaseEvent(current => ({
      ...current,
      [phase]: {
        ...(current[phase] ?? {}),
        [selectedEventId]: updater(current[phase]?.[selectedEventId] ?? []),
      },
    }))
  }

  const toggleActive = (id) => {
    updatePhaseEventStations(current =>
      current.map(station => (
        station.id === id
          ? { ...station, active: !station.active }
          : station
      )),
    )
  }

  const saveStation = (id, form) => {
    updatePhaseEventStations(current =>
      current.map(station => (
        station.id === id
          ? { ...createStation(form), id: station.id, order: station.order }
          : station
      )),
    )
  }

  const deleteStation = (id) => {
    updatePhaseEventStations(current => reindexStations(current.filter(station => station.id !== id)))
    setSelectedId(null)
  }

  const addStation = (form) => {
    updatePhaseEventStations(current => {
      const nextStations = reindexStations(current)
      return [
        ...nextStations,
        {
          ...createStation(form),
          id: makeStationId(phase, nextStations),
          order: nextStations.length + 1,
          teamsHere: [],
          teamsDone: [],
        },
      ]
    })
    setAdding(false)
  }

  return (
    <div className="space-y-4">
      <div className={`${CARD} overflow-hidden`}>
        <div className="border-b border-stone px-5 py-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-3xl">
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/40">
                Tram nam ben trong event con
              </p>
              <h2 className="mt-2 font-display text-xl font-semibold text-ink">
                Quan ly bo tram theo phase va event
              </h2>
              <p className="mt-2 text-sm leading-6 text-ink/60">
                {phaseMeta.description}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Badge label={phaseInfo.label} cls={phaseMeta.badgeCls} />
              <span className="rounded-full bg-paper px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-ink/45">
                Frontend state
              </span>
            </div>
          </div>
        </div>

        <div className="space-y-3 px-5 py-4">
          <PhaseSwitcher
            phase={phase}
            phaseOptions={phaseOptions}
            onChange={onPhaseChange}
          />
          {phaseStationEvents.length > 0 ? (
            <>
              <StationEventSwitcher
                selectedEventId={selectedEventId}
                events={phaseStationEvents}
                stationsByEvent={phaseBucket}
                onChange={setSelectedEventId}
              />
              <p className="text-xs leading-5 text-ink/45">
                Chi cac event con bat "Co tram" moi xuat hien o day. Moi tram co the cau hinh bai nop dang form,
                trac nghiem, file dinh kem, hoac ket hop nhieu loai cung luc.
              </p>
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-stone bg-paper px-4 py-4 text-sm leading-6 text-ink/45">
              Phase nay chua co event nao bat "Co tram". Hay vao tab Quan ly su kien, tao event con va bat tuy chon do truoc khi them tram.
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <SummaryCard value={String(phaseStationEvents.length)} label="Event co tram" />
        <SummaryCard value={String(stations.length)} label="Tram cua event" />
        <SummaryCard value={String(active.length)} label="Đang hoạt động" accent="trail" />
        <SummaryCard value={String(configured.length)} label="Co bai nop" accent="sky" />
        <SummaryCard value={String(totalScore)} label="Tong diem tram" accent="gold" />
        <SummaryCard value={String(totalDone)} label="Luot hoan thanh" accent="trail" />
      </div>

      <div className={`${CARD} px-4 py-3`}>
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <p className="font-mono text-xs text-ink/40">
            {selectedEvent ? `${selectedEvent.name} · ` : ''}{active.length} tram hoat dong · {inactive.length} chua mo · {attachmentRequired.length} tram yeu cau tep · {totalHere} doi dang o tram
          </p>
          <button
            type="button"
            onClick={() => setAdding(true)}
            disabled={!selectedEvent}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-[0.9] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Icon name="plus" className="h-4 w-4" />
            Them tram
          </button>
        </div>
      </div>

      {adding && selectedEvent && (
        <div className={`${CARD} overflow-hidden`}>
          <div className="flex items-center justify-between gap-3 border-b border-stone px-5 py-3">
            <p className="font-display font-semibold text-ink">Them tram moi</p>
            <div className="flex flex-wrap items-center gap-2">
              <Badge label={phaseInfo.label} cls={phaseMeta.badgeCls} />
              <Badge
                label={selectedEvent.name}
                cls={(SUB_EVENT_TYPE_META[selectedEvent.type] ?? SUB_EVENT_TYPE_META.custom).cls}
              />
            </div>
          </div>
          <StationForm
            initial={createBlankStation()}
            onSave={addStation}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

      {selectedEvent ? (
        <div className={`${CARD} overflow-hidden`}>
          <div className="overflow-x-auto">
          <table className="w-full min-w-[1020px] text-left">
            <thead>
              <tr className="border-b border-stone font-mono text-[10px] uppercase tracking-wider text-ink/35">
                <th className="w-12 px-4 py-3 font-medium">STT</th>
                <th className="px-4 py-3 font-medium">Ten tram</th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">Dia diem</th>
                <th className="px-4 py-3 font-medium">Bai nop</th>
                <th className="px-4 py-3 text-center font-medium">Dang o</th>
                <th className="px-4 py-3 text-center font-medium">Xong</th>
                <th className="px-4 py-3 text-right font-medium">Diem</th>
                <th className="px-4 py-3 font-medium">Trang thai</th>
                <th className="w-8 px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-stone/60">
              {stations.map(station => {
                const status = STATUS[station.active ? 'active' : 'inactive']
                const stationScore = sumStationScore(station)
                return (
                  <tr
                    key={station.id}
                    onClick={() => setSelectedId(station.id)}
                    className={`cursor-pointer transition hover:bg-paper/70 ${selectedId === station.id ? 'bg-paper/60' : ''}`}
                  >
                    <td className="px-4 py-3.5">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink/[0.07] font-mono text-xs font-semibold text-ink/60">
                        {station.order}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <p className="text-sm font-medium text-ink">{station.name}</p>
                      <p className="font-mono text-xs text-ink/40">{station.id}</p>
                    </td>
                    <td className="hidden px-4 py-3.5 md:table-cell">
                      <p className="max-w-[220px] truncate text-sm text-ink/55">{station.location || '-'}</p>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="space-y-1">
                        <SubmissionModeList submission={station.submission} compact />
                        {station.submission.brief && (
                          <p className="max-w-[260px] truncate text-xs text-ink/40">{stripMarkdown(station.submission.brief)}</p>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-center">
                      <span className={`font-mono text-sm font-semibold ${station.teamsHere.length > 0 ? 'text-gold' : 'text-ink/25'}`}>
                        {station.teamsHere.length}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-center">
                      <span className={`font-mono text-sm font-semibold ${station.teamsDone.length > 0 ? 'text-trail' : 'text-ink/25'}`}>
                        {station.teamsDone.length}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <span className={`font-mono text-sm font-semibold ${stationScore > 0 ? 'text-[#3E7CA8]' : 'text-ink/25'}`}>
                        {stationScore}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <Badge {...status} />
                    </td>
                    <td className="px-4 py-3.5 text-ink/25">
                      <Icon name="chevronR" className="h-4 w-4" />
                    </td>
                  </tr>
                )
              })}

              {stations.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-16 text-center text-sm text-ink/35">
                    Chua co tram nao cho event {selectedEvent.name.toLowerCase()}. Bam "Them tram" de bat dau.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        </div>
      ) : null}

      <StationDrawer
        key={selectedId}
        station={selected}
        phaseLabel={phaseInfo.label}
        phaseBadgeCls={phaseMeta.badgeCls}
        eventName={selectedEvent?.name}
        eventType={selectedEvent?.type}
        onClose={() => setSelectedId(null)}
        onToggleActive={toggleActive}
        onSave={saveStation}
        onDelete={deleteStation}
      />
    </div>
  )
}

export default StationsPage
