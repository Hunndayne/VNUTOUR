import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { STATIONS_STORAGE_KEY, SUB_EVENT_TYPE_META } from './adminProgram.js'
import { Icon, CARD, Badge } from './ui.jsx'
import { apiRequest, formatDateTime, isMasterAdmin, logoutAndRedirect, API_BASE_URL } from './api.js'
import { useSearchParam } from './router.js'
import { useDraftState, DraftNotice } from './drafts.jsx'
import { exportToJson, exportQuizToExcel, importFromFile, downloadSampleExcel, downloadSampleJson } from './importExportUtils.js'
import StationAssignmentsPanel from './StationAssignmentsPanel.jsx'
import CheckinQrToggle from './CheckinQrToggle.jsx'

const LEGACY_STATIONS_STORAGE_KEY = 'vnutour:admin:stations-by-phase'

// QR điểm danh tạm ẩn khỏi trang Trạm — bật lại bằng đổi cờ này, không xoá gì thêm.
const SHOW_CHECKIN_QR = false

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
  text: {
    label: 'Tự luận',
    hint: 'Thu thập câu trả lời tự do theo từng trường.',
    addLabel: 'Câu tự luận',
    icon: 'doc',
    cls: 'bg-[#3E7CA8]/12 text-[#3E7CA8]',
    selectedCls: 'border-[#3E7CA8]/25 bg-[#3E7CA8]/10 text-[#3E7CA8]',
  },
  quiz: {
    label: 'Trắc nghiệm',
    hint: 'Câu hỏi có đáp án lựa chọn và đáp án đúng.',
    addLabel: 'Câu trắc nghiệm',
    icon: 'listBullet',
    cls: 'bg-gold/15 text-gold',
    selectedCls: 'border-gold/30 bg-gold/10 text-gold',
  },
  attachment: {
    label: 'Tệp',
    hint: 'Yêu cầu đội nộp ảnh, PDF hoặc tệp minh chứng.',
    addLabel: 'Ô nộp tệp',
    icon: 'paperclip',
    cls: 'bg-trail/12 text-trail',
    selectedCls: 'border-trail/30 bg-trail/10 text-trail',
  },
}

const CHECKIN_POLICY_META = {
  staff_scan: {
    label: 'Cần coop scan',
    hint: 'Đội phải được check-in/check-out bởi admin hoặc co-op.',
    cls: 'bg-gold/15 text-gold',
  },
  free_play: {
    label: 'Tự do vào chơi',
    hint: 'Không bắt buộc admin/co-op scan check-in tại trạm này.',
    cls: 'bg-ink/[0.07] text-ink/55',
  },
}

const CAPACITY_MODE_META = {
  unlimited: {
    label: 'Không giới hạn',
    hint: 'Không giới hạn số đội chơi cùng lúc.',
  },
  limited: {
    label: 'Giới hạn đồng thời',
    hint: 'Chỉ một số đội được chơi cùng lúc.',
  },
}

const SCORING_MODE_META = {
  score_only: {
    label: 'Chỉ nhập điểm',
    hint: 'Coop nhập điểm cho mỗi lượt chơi; không có khái niệm đạt/trượt.',
    cls: 'bg-ink/[0.07] text-ink/55',
    selectedCls: 'border-ink/25 bg-ink/[0.06] text-ink',
  },
  threshold: {
    label: 'Ngưỡng điểm đạt',
    hint: 'Coop nhập điểm; đạt từ ngưỡng trở lên mới tính là qua trạm.',
    cls: 'bg-gold/15 text-gold',
    selectedCls: 'border-gold/30 bg-gold/10 text-gold',
  },
  pass_fail: {
    label: 'Đạt / Không đạt',
    hint: 'Coop chỉ bấm đạt hay không, không nhập điểm số; đạt được cộng điểm cấu hình sẵn.',
    cls: 'bg-trail/12 text-trail',
    selectedCls: 'border-trail/30 bg-trail/10 text-trail',
  },
}

function makeLocalId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`
}

function createTextItem(field = {}) {
  return {
    id: field.id ?? makeLocalId('field'),
    type: 'text',
    label: field.label ?? '',
    placeholder: field.placeholder ?? '',
    required: field.required ?? true,
  }
}

function createQuizItem(item = {}) {
  const nextOptions = Array.isArray(item.options) ? [...item.options] : []
  while (nextOptions.length < 4) nextOptions.push('')
  const rawPoints = Number(item.points)

  return {
    id: item.id ?? makeLocalId('quiz'),
    type: 'quiz',
    question: item.question ?? '',
    options: nextOptions.slice(0, 4),
    correctOption: Number.isInteger(item.correctOption) ? item.correctOption : 0,
    points: Number.isFinite(rawPoints) && rawPoints >= 0 ? Math.round(rawPoints) : 1,
  }
}

function createAttachmentItem(attachment = {}) {
  return {
    id: attachment.id ?? makeLocalId('file'),
    type: 'attachment',
    maxFiles: Math.max(1, Number(attachment.maxFiles) || 1),
    maxSizeMb: Math.max(1, Number(attachment.maxSizeMb) || 20),
    allowedTypes: attachment.allowedTypes ?? 'JPG, PNG, PDF',
    note: attachment.note ?? '',
  }
}

const ITEM_FACTORIES = {
  text: createTextItem,
  quiz: createQuizItem,
  attachment: createAttachmentItem,
}

function createSubmissionItem(type, raw = {}) {
  const factory = ITEM_FACTORIES[type] ?? createTextItem
  return factory(raw)
}

/** Convert the old three-section config into one ordered list, keeping its order. */
function itemsFromLegacyConfig(submission) {
  const items = []
  if (submission.form?.enabled) {
    for (const field of submission.form.fields ?? []) items.push(createTextItem(field))
  }
  if (submission.quiz?.enabled) {
    for (const entry of submission.quiz.items ?? []) items.push(createQuizItem(entry))
  }
  if (submission.attachment?.enabled) {
    items.push(createAttachmentItem(submission.attachment))
  }
  return items
}

function createSubmissionLimits(limits = {}) {
  return {
    maxSubmissions: Math.max(0, Number(limits.maxSubmissions) || 0),
    closeOnCorrect: limits.closeOnCorrect ?? false,
    manualClosed: limits.manualClosed ?? false,
    opensAt: limits.opensAt ?? '',
    closesAt: limits.closesAt ?? '',
    durationMinutes: Math.max(0, Number(limits.durationMinutes) || 0),
  }
}

function createSubmissionConfig(submission = {}) {
  const rawItems = Array.isArray(submission.items)
    ? submission.items
    : itemsFromLegacyConfig(submission)

  // Only one file-upload block is meaningful: uploads arrive as a single list.
  let seenAttachment = false
  const items = []
  for (const raw of rawItems) {
    if (!raw || typeof raw !== 'object') continue
    const type = ITEM_FACTORIES[raw.type] ? raw.type : 'text'
    if (type === 'attachment') {
      if (seenAttachment) continue
      seenAttachment = true
    }
    items.push(createSubmissionItem(type, raw))
  }

  return {
    antiCheat: submission.antiCheat ?? true,
    brief: submission.brief ?? '',
    items,
    quiz: {
      autoScore: submission.quiz?.autoScore ?? false,
      // 0 = phát hết bộ đề; N > 0 = mỗi đội nhận N câu bốc ngẫu nhiên (cố định theo đội).
      randomCount: Math.max(0, Math.trunc(Number(submission.quiz?.randomCount)) || 0),
      randomizeOptions: submission.quiz?.randomizeOptions ?? false,
    },
    bank: {
      itemIds: submission.bank?.itemIds ?? [],
      useAll: submission.bank?.useAll ?? false,
      mixStationQuiz: submission.bank?.mixStationQuiz ?? false,
    },
    limits: createSubmissionLimits(submission.limits),
    flow: {
      // Mặc định bật: mỗi lượt vào trạm nên có một lượt ra tương ứng, nếu không
      // số đội đang ở trạm sẽ sai. Tắt khi nộp bài đã coi như xong việc ở trạm.
      checkoutAfterSubmit: submission.flow?.checkoutAfterSubmit !== false,
    },
  }
}

function createBlankStation() {
  return {
    id: '',
    code: '',
    order: 0,
    name: '',
    location: '',
    active: true,
    checkinPolicy: 'staff_scan',
    capacityMode: 'unlimited',
    maxConcurrentTeams: 2,
    scoringMode: 'score_only',
    passThreshold: 0,
    passPoints: 0,
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
  next.checkinPolicy = Object.prototype.hasOwnProperty.call(CHECKIN_POLICY_META, station.checkinPolicy) ? station.checkinPolicy : 'staff_scan'
  next.capacityMode = station.capacityMode === 'limited' ? 'limited' : 'unlimited'
  next.maxConcurrentTeams = Math.max(1, Number(station.maxConcurrentTeams) || 2)
  next.scoringMode = Object.prototype.hasOwnProperty.call(SCORING_MODE_META, station.scoringMode) ? station.scoringMode : 'score_only'
  const rawThreshold = Number(station.passThreshold)
  next.passThreshold = Number.isFinite(rawThreshold) && rawThreshold >= 0 ? Math.round(rawThreshold) : 0
  const rawPoints = Number(station.passPoints)
  next.passPoints = Number.isFinite(rawPoints) && rawPoints >= 0 ? Math.round(rawPoints) : 0
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
    location: 'Phòng 201 · UIT',
    active: false,
  }),
]

const QUALIFYING_STATIONS = [
  createStation({
    id: 'VL01',
    order: 1,
    name: 'Trạm 1 · UIT',
    location: 'Khu phố 6, P. Linh Trung, TP. Thủ Đức',
    active: true,
    teamsHere: [
      { id: 'T0003', name: 'Những chiến binh', arrivedAt: '14:20' },
      { id: 'T0005', name: 'Thunder', arrivedAt: '14:35' },
      { id: 'T0009', name: 'Red Storm', arrivedAt: '14:48' },
      { id: 'T0011', name: 'Đội mới', arrivedAt: '15:01' },
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
    name: 'Trạm 2 · Thư viện Khoa học Tổng hợp',
    location: '69 Đinh Tiên Hoàng, Q.1, TP. HCM',
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
            options: ['Lê Quý Đôn', 'Nguyễn Đình Chiểu', 'Trần Hưng Đạo', 'Hồ Xuân Hương'],
            correctOption: 1,
          },
          {
            question: 'Khu vực đọc mở cửa thư viện nằm ở tầng nào?',
            options: ['Tầng 1', 'Tầng 2', 'Tầng 3', 'Tầng 4'],
            correctOption: 2,
          },
        ],
      },
    },
  }),
  createStation({
    id: 'VL03',
    order: 3,
    name: 'Trạm 3 · Trung tâm GDQP&AN',
    location: 'Đường số 6, KDT Đại học Quốc gia, TP. Thủ Đức',
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
      brief: 'Nộp ảnh minh chứng sau khi đội vượt qua bài tập vận động.',
      attachment: {
        enabled: true,
        maxFiles: 2,
        allowedTypes: 'JPG, PNG',
        note: 'Cần rõ mặt đội và bảng tên trạm trong ảnh.',
      },
    },
  }),
  createStation({
    id: 'VL04',
    order: 4,
    name: 'Trạm 4 · Đại học Bách Khoa',
    location: '268 Lý Thường Kiệt, Q.10, TP. HCM',
    active: true,
    teamsHere: [
      { id: 'T0007', name: 'Dark Matter', arrivedAt: '15:00' },
    ],
    teamsDone: [
      { id: 'T0001', name: 'Sky Walker', doneAt: '13:10' },
    ],
    submission: {
      brief: 'Trạm kết hợp trả lời và nộp file minh chứng.',
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
        note: 'Nộp ảnh chụp vật phẩm tại điểm kết thúc.',
      },
    },
  }),
  createStation({
    id: 'VL05',
    order: 5,
    name: 'Trạm 5 · Nhà Văn hoá Thanh niên',
    location: '4 Phạm Ngọc Thạch, Q.1, TP. HCM',
    active: false,
  }),
  createStation({
    id: 'VL06',
    order: 6,
    name: 'Trạm đích · SVĐ Thống Nhất',
    location: '138 Đào Duy Từ, Q.10, TP. HCM',
    active: false,
    submission: {
      brief: 'Tổng hợp bài nộp cuối cùng để chấm điểm về đích.',
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
        note: 'Có thể nộp ảnh hoặc clip tổng kết hành trình.',
      },
    },
  }),
]

const FINAL_STATIONS = [
  createStation({
    id: 'CK01',
    order: 1,
    name: 'Final · Sân khởi động',
    location: 'Khu vực xuất phát · Công viên phía đông',
    active: true,
    teamsHere: [
      { id: 'T0001', name: 'Sky Walker', arrivedAt: '17:20' },
      { id: 'T0003', name: 'Những chiến binh', arrivedAt: '17:25' },
    ],
    teamsDone: [
      { id: 'T0002', name: 'Fire Phoenix', doneAt: '17:05' },
    ],
    submission: {
      brief: 'Quiz mở màn chung kết để kích hoạt clue tiếp theo.',
      quiz: {
        enabled: true,
        items: [
          {
            question: 'Mảnh clue đầu tiên dẫn đội đến khu vực nào?',
            options: ['Sân khấu', 'Khu trung tâm', 'Lều checkpoint', 'Cổng chính'],
            correctOption: 1,
          },
        ],
      },
    },
  }),
  createStation({
    id: 'CK02',
    order: 2,
    name: 'Final · Trạm giải mã',
    location: 'Nhà điều hành trung tâm',
    active: true,
    teamsHere: [
      { id: 'T0002', name: 'Fire Phoenix', arrivedAt: '17:28' },
    ],
    teamsDone: [
      { id: 'T0001', name: 'Sky Walker', doneAt: '17:18' },
      { id: 'T0004', name: 'Ice Breaker', doneAt: '17:23' },
    ],
    submission: {
      brief: 'Cần nộp đáp án cuối và file chụp mảnh ghép sau khi giải xong.',
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
        note: 'Ảnh chụp mảnh ghép hoàn chỉnh.',
      },
    },
  }),
  createStation({
    id: 'CK03',
    order: 3,
    name: 'Final · Trạm bứt tốc',
    location: 'Đường chạy nội khu',
    active: false,
    teamsDone: [
      { id: 'T0003', name: 'Những chiến binh', doneAt: '17:15' },
      { id: 'T0005', name: 'Thunder', doneAt: '17:19' },
    ],
    submission: {
      brief: 'Ảnh minh chứng qua vạch đồng thời trả lời câu hỏi ấn tượng.',
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
        note: 'Một ảnh toàn đội và một ảnh checkpoint nếu cần.',
      },
    },
  }),
  createStation({
    id: 'CK04',
    order: 4,
    name: 'Final · Vạch đích',
    location: 'Sân khấu chung kết',
    active: false,
  }),
]

const ENDED_STATIONS = [
  createStation({
    id: 'ARC01',
    order: 1,
    name: 'Tổng kết · Vòng loại',
    location: 'Kho minh chứng sự kiện',
    active: false,
    teamsDone: [
      { id: 'T0001', name: 'Sky Walker', doneAt: '18:00' },
      { id: 'T0002', name: 'Fire Phoenix', doneAt: '18:00' },
      { id: 'T0003', name: 'Những chiến binh', doneAt: '18:00' },
    ],
    submission: {
      brief: 'Lưu metadata của tất cả bài nộp vòng loại để đối chiếu sau sự kiện.',
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
        note: 'Kho minh chứng tổng hợp sau vòng loại.',
      },
    },
  }),
  createStation({
    id: 'ARC02',
    order: 2,
    name: 'Tổng kết · Chung kết',
    location: 'Phòng điều hành',
    active: false,
    teamsDone: [
      { id: 'T0001', name: 'Sky Walker', doneAt: '19:20' },
      { id: 'T0002', name: 'Fire Phoenix', doneAt: '19:20' },
    ],
    submission: {
      brief: 'Lưu kết quả quiz và tệp minh chứng của chung kết.',
      quiz: {
        enabled: true,
        items: [
          {
            question: 'Đã xác nhận kết quả chung kết?',
            options: ['Chưa', 'Đã xác nhận', 'Cần đối soát', 'Khác'],
            correctOption: 1,
          },
        ],
      },
      attachment: {
        enabled: true,
        maxFiles: 2,
        allowedTypes: 'PDF, XLSX',
        note: 'Biên bản chấm điểm và bảng tổng hợp kết quả.',
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

function _reindexStations(stations = []) {
  return normalizeStations(stations).map((station, index) => ({
    ...station,
    order: index + 1,
  }))
}

function sumStationScore(station) {
  return (station?.teamsDone ?? []).reduce((total, team) => total + (Number(team.score) || 0), 0)
}

function explainApiError(error) {
  const code = error?.data?.error || error?.message
  const map = {
    forbidden: 'Bạn không có quyền thao tác trạm.',
    invalid_json: 'Dữ liệu trạm gửi lên không hợp lệ.',
    missing_code_or_name: 'Trạm cần có mã và tên trước khi lưu.',
    method_not_allowed: 'Thao tác này chưa được API hỗ trợ.',
    station_not_found: 'Không tìm thấy trạm cần thao tác.',
    station_not_in_event: 'Trạm này không thuộc event đang chọn.',
    not_assigned_to_station: 'Bạn chưa được phân công phụ trách trạm này.',
    submission_not_found: 'Không tìm thấy bài nộp cần thao tác.',
    invalid_score: 'Điểm không hợp lệ.',
    results_locked: 'Kết quả đã khóa (chương trình kết thúc), không thể sửa điểm.',
    master_admin_required: 'Chỉ master admin mới được tạo/sửa/xoá trạm và đổi phase hiện tại.',
  }
  return map[code] || 'Không thể đồng bộ dữ liệu trạm.'
}

function formatCapacitySummary(station) {
  if (station?.capacityMode === 'limited') {
    return `${station.maxConcurrentTeams} đội cùng lúc`
  }
  return 'Không giới hạn'
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

function mapSessionsToStationState(sessions = []) {
  const sortedSessions = [...sessions].sort((left, right) => (
    new Date(right.exited_at || right.entered_at || 0).getTime()
    - new Date(left.exited_at || left.entered_at || 0).getTime()
  ))

  const teamsHere = sortedSessions
    .filter(session => session.status === 'active')
    .map(session => ({
      id: session.team_code,
      name: session.team_name,
      arrivedAt: formatDateTime(session.entered_at),
    }))

  const teamsDone = sortedSessions
    .filter(session => session.status === 'closed')
    .map(session => ({
      id: session.team_code,
      name: session.team_name,
      doneAt: formatDateTime(session.exited_at || session.entered_at),
      score: Number(session.score) || 0,
      note: session.note || '',
    }))

  return { teamsHere, teamsDone }
}

function stationFromApi(station, sessions = []) {
  const { teamsHere, teamsDone } = mapSessionsToStationState(sessions)
  return createStation({
    id: String(station.id),
    code: station.code || '',
    order: station.order ?? 0,
    name: station.name || '',
    location: station.location || '',
    active: station.active !== false,
    checkinPolicy: station.checkin_policy || 'staff_scan',
    capacityMode: station.capacity_mode || 'unlimited',
    maxConcurrentTeams: Math.max(1, Number(station.max_concurrent_teams) || 2),
    scoringMode: station.scoring_mode || 'score_only',
    passThreshold: station.pass_threshold,
    passPoints: station.pass_points,
    teamsHere,
    teamsDone,
    submission: createSubmissionConfig(station.submission_config),
  })
}

function buildStationPayload(form, order, active) {
  return {
    name: form.name.trim(),
    location: form.location.trim(),
    order,
    active,
    checkin_policy: form.checkinPolicy,
    capacity_mode: form.capacityMode,
    max_concurrent_teams: form.capacityMode === 'limited'
      ? Math.max(1, Number(form.maxConcurrentTeams) || 1)
      : null,
    scoring_mode: form.scoringMode,
    // Chỉ giữ giá trị của ô đang áp dụng — tránh gửi lên số liệu cũ của chế độ
    // đã bỏ chọn, giống cách max_concurrent_teams về null khi hết giới hạn.
    pass_threshold: form.scoringMode === 'threshold'
      ? Math.max(0, Number(form.passThreshold) || 0)
      : 0,
    pass_points: form.scoringMode === 'pass_fail'
      ? Math.max(0, Number(form.passPoints) || 0)
      : 0,
    submission_config: sanitizeSubmission(form.submission),
  }
}

async function fetchStationsForEvent(phaseKey, eventId) {
  const payload = await apiRequest(`/program/phases/${phaseKey}/sub-events/${eventId}/stations?include_inactive=1`)
  const stations = payload?.stations || []
  const historyPayloads = await Promise.all(
    stations.map(station => apiRequest(`/stations/${station.id}/sessions`)),
  )

  return normalizeStations(
    stations.map((station, index) => stationFromApi(station, historyPayloads[index]?.sessions || [])),
  )
}

function makeStationId(phase, stations) {
  const prefix = PHASE_PREFIX[phase] ?? 'ST'
  const nextNumber = stations.reduce((max, station) => {
    const matched = String(station.code || station.id || '').match(/(\d+)$/)
    return Math.max(max, matched ? Number(matched[1]) : 0)
  }, 0) + 1

  return `${prefix}${String(nextNumber).padStart(2, '0')}`
}

function getSubmissionModes(submission) {
  const items = createSubmissionConfig(submission ?? {}).items
  const order = ['text', 'quiz', 'attachment']
  return order
    .filter(type => items.some(item => item.type === type))
    .map(type => ({ key: type, ...MODE_META[type] }))
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

function MarkdownPreview({ content, emptyMessage = 'Chưa có mô tả markdown.' }) {
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
  next.items = next.items.map(item => {
    if (item.type === 'quiz') {
      return {
        ...item,
        question: item.question.trim(),
        options: item.options.map(option => option.trim()),
      }
    }
    if (item.type === 'attachment') {
      return {
        ...item,
        allowedTypes: item.allowedTypes.trim(),
        note: item.note.trim(),
      }
    }
    return {
      ...item,
      label: item.label.trim(),
      placeholder: item.placeholder.trim(),
    }
  })
  return next
}

function PhaseSwitcher({ phase, phaseOptions, onChange, disabled = false }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {phaseOptions.map(option => {
          const active = option.key === phase
          const meta = PHASE_META[option.key] ?? PHASE_META.registration
          return (
            <button
              key={option.key}
              type="button"
              disabled={disabled}
              title={disabled ? 'Chỉ master admin mới được đổi phase hiện tại.' : undefined}
              onClick={() => onChange(option.key)}
              className={`rounded-full border px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
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
      {disabled && (
        <p className="text-xs leading-5 text-ink/45">
          Các nút phase ở đây đổi phase của cả hệ thống — chỉ master admin mới thao tác được.
        </p>
      )}
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
    return <span className="text-xs text-ink/35">Không có bài nộp</span>
  }

  return (
    <div className={`flex flex-wrap gap-1.5 ${compact ? 'max-w-[240px]' : ''}`}>
      {modes.map(mode => <ModeBadge key={mode.key} mode={mode} />)}
    </div>
  )
}

function StationEventSwitcher({ selectedEventId, events, stationsByEvent, onChange }) {
  return (
    <div className="flex flex-wrap gap-2">
      {events.map((eventItem) => {
        const active = eventItem.id === selectedEventId
        const typeMeta = SUB_EVENT_TYPE_META[eventItem.type] ?? SUB_EVENT_TYPE_META.custom
        const stationCount = (stationsByEvent[eventItem.id] ?? []).length
        const hoverHint = [
          typeMeta.label,
          eventItem.note ? stripMarkdown(eventItem.note) : '',
        ].filter(Boolean).join(' · ')

        return (
          <button
            key={eventItem.id}
            type="button"
            onClick={() => onChange(eventItem.id)}
            title={hoverHint}
            className={`inline-flex max-w-full items-center gap-2 rounded-full border px-3.5 py-2 text-sm transition ${
              active
                ? 'border-gold/40 bg-gold/10 font-semibold text-ink'
                : 'border-stone bg-white text-ink/60 hover:bg-paper hover:text-ink'
            }`}
          >
            {active && <Icon name="checkPlain" className="h-3.5 w-3.5 shrink-0 text-gold" />}
            <span className="truncate">{eventItem.name}</span>
            <span className="shrink-0 font-mono text-[11px] text-ink/40">{stationCount} trạm</span>
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
            Soạn thảo
          </button>
          <button
            type="button"
            onClick={() => setTab('preview')}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
              tab === 'preview' ? 'bg-white text-ink shadow-sm' : 'text-ink/50 hover:text-ink'
            }`}
          >
            Xem trước
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
          <MarkdownPreview content={value} emptyMessage="Chưa có mô tả để xem trước." />
        </div>
      )}
    </div>
  )
}

const INPUT_CLS = 'w-full rounded-lg border border-stone bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10'
const MICRO_LABEL_CLS = 'mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40'

/** One row of the station form builder: drag to reorder, edit in place. */
function SubmissionItemCard({
  item, index, total, isDragging, isDropTarget,
  onDragStart, onDragEnter, onDragEnd, onRemove, onChange, onChangeOption,
}) {
  const meta = MODE_META[item.type] ?? MODE_META.text

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnter={onDragEnter}
      onDragOver={event => event.preventDefault()}
      onDragEnd={onDragEnd}
      onDrop={event => { event.preventDefault(); onDragEnd() }}
      className={`rounded-lg border bg-paper px-3 py-3 transition ${
        isDragging ? 'border-trail/40 opacity-50' : 'border-stone'
      } ${isDropTarget ? 'ring-2 ring-trail/30' : ''}`}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className="cursor-grab rounded p-1 text-ink/30 transition hover:bg-white hover:text-ink/60 active:cursor-grabbing"
            title="Kéo để đổi thứ tự"
            aria-label={`Kéo để đổi thứ tự, đang ở vị trí ${index + 1} trên ${total}`}
          >
            <Icon name="grip" className="h-4 w-4" />
          </span>
          <span className="font-mono text-xs text-ink/40">{index + 1}</span>
          <Badge label={meta.label} cls={meta.cls} />
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="rounded-lg p-1.5 text-ink/35 transition hover:bg-white hover:text-clay"
          title="Xoá mục này"
        >
          <Icon name="trash" className="h-4 w-4" />
        </button>
      </div>

      {item.type === 'text' && (
        <div className="grid gap-3">
          <input
            value={item.label}
            onChange={event => onChange('label', event.target.value)}
            placeholder="Nội dung câu hỏi, vd: Mật mã tìm được"
            className={INPUT_CLS}
          />
          <input
            value={item.placeholder}
            onChange={event => onChange('placeholder', event.target.value)}
            placeholder="Gợi ý cách nhập dữ liệu"
            className={INPUT_CLS}
          />
          <label className="inline-flex items-center gap-2 text-sm text-ink/60">
            <input
              type="checkbox"
              checked={item.required}
              onChange={event => onChange('required', event.target.checked)}
              className="h-4 w-4 rounded border-stone text-trail focus:ring-trail/20"
            />
            Bắt buộc
          </label>
        </div>
      )}

      {item.type === 'quiz' && (
        <>
          <textarea
            rows={2}
            value={item.question}
            onChange={event => onChange('question', event.target.value)}
            placeholder="Nhập nội dung câu hỏi"
            className={`${INPUT_CLS} leading-6 placeholder:text-ink/30`}
          />
          <div className="mt-3 space-y-2.5">
            {item.options.map((option, optionIndex) => (
              <div key={`${item.id}-${optionIndex}`} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onChange('correctOption', optionIndex)}
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border text-xs font-semibold transition ${
                    optionIndex === item.correctOption
                      ? 'border-gold/40 bg-gold/10 text-gold'
                      : 'border-stone bg-white text-ink/40 hover:bg-paper'
                  }`}
                  title="Đánh dấu đáp án đúng"
                >
                  {String.fromCharCode(65 + optionIndex)}
                </button>
                <input
                  value={option}
                  onChange={event => onChangeOption(optionIndex, event.target.value)}
                  placeholder={`Lựa chọn ${String.fromCharCode(65 + optionIndex)}`}
                  className={INPUT_CLS}
                />
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <label className="font-mono text-[10px] uppercase tracking-widest text-ink/40">
              Điểm khi đúng câu này
            </label>
            <input
              type="number"
              min={0}
              value={item.points}
              onChange={event => onChange('points', Math.max(0, Number(event.target.value) || 0))}
              className="w-20 rounded-lg border border-stone bg-white px-2.5 py-1.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
            />
          </div>
        </>
      )}

      {item.type === 'attachment' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={MICRO_LABEL_CLS}>Số file tối đa</label>
            <input
              type="number"
              min={1}
              value={item.maxFiles}
              onChange={event => onChange('maxFiles', Math.max(1, Number(event.target.value) || 1))}
              className={INPUT_CLS}
            />
          </div>
          <div>
            <label className={MICRO_LABEL_CLS}>Định dạng cho phép</label>
            <input
              value={item.allowedTypes}
              onChange={event => onChange('allowedTypes', event.target.value)}
              placeholder="JPG, PNG, PDF"
              className={INPUT_CLS}
            />
          </div>
          <div>
            <label className={MICRO_LABEL_CLS}>Dung lượng tối đa mỗi file (MB)</label>
            <input
              type="number"
              min={1}
              value={item.maxSizeMb}
              onChange={event => onChange('maxSizeMb', Math.max(1, Number(event.target.value) || 1))}
              className={INPUT_CLS}
            />
          </div>
          <div className="sm:col-span-2">
            <label className={MICRO_LABEL_CLS}>Ghi chú cho file đính kèm</label>
            <textarea
              rows={3}
              value={item.note}
              onChange={event => onChange('note', event.target.value)}
              placeholder="Hướng dẫn đội cần chụp gì, đặt tên file ra sao, cần bao nhiêu ảnh..."
              className={`${INPUT_CLS} leading-6 placeholder:text-ink/30`}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function StationFlowOverview({ station }) {
  const policyMeta = CHECKIN_POLICY_META[station.checkinPolicy] ?? CHECKIN_POLICY_META.staff_scan
  const scoringMeta = SCORING_MODE_META[station.scoringMode] ?? SCORING_MODE_META.score_only

  return (
    <div>
      <SectionTitle title="Vận hành check-in" />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className={`${CARD} px-4 py-3`}>
          <div className="flex items-center gap-2">
            <Badge label={policyMeta.label} cls={policyMeta.cls} />
          </div>
          <p className="mt-2 text-sm leading-6 text-ink/60">{policyMeta.hint}</p>
        </div>
        <div className={`${CARD} px-4 py-3`}>
          <p className="text-xs text-ink/40">Công suất</p>
          <p className="mt-1 text-sm font-semibold text-ink">{formatCapacitySummary(station)}</p>
          <p className="mt-2 text-sm leading-6 text-ink/50">
            {station.capacityMode === 'limited'
              ? `Hệ thống cần chặn thêm đội mới khi đã có ${station.maxConcurrentTeams} đội đang chơi.`
              : 'Trạm này không cần giới hạn số đội đang chơi cùng lúc.'}
          </p>
        </div>
        <div className={`${CARD} px-4 py-3`}>
          <div className="flex items-center gap-2">
            <Badge label={scoringMeta.label} cls={scoringMeta.cls} />
          </div>
          <p className="mt-2 text-sm leading-6 text-ink/60">
            {station.scoringMode === 'threshold' && `Đạt từ ${station.passThreshold} điểm trở lên.`}
            {station.scoringMode === 'pass_fail' && `Đạt được cộng ${station.passPoints} điểm.`}
            {station.scoringMode === 'score_only' && scoringMeta.hint}
          </p>
        </div>
      </div>
    </div>
  )
}

function InitialAssignmentFields({ value, onChange, compact = false }) {
  const [collabs, setCollabs] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let cancelled = false

    const loadCollabs = async () => {
      try {
        setLoading(true)
        const params = new URLSearchParams({
          role: 'collab',
          active: '1',
          limit: '200',
        })
        const payload = await apiRequest(`/admin/accounts?${params.toString()}`)
        if (cancelled) return
        const items = payload.items || []
        setCollabs(items)
        if (items[0]?.username) {
          onChange((current) => (current.collabUsername
            ? current
            : { ...current, collabUsername: items[0].username }))
        }
      } catch (error) {
        if (cancelled) return
        if (error?.status === 401) {
          logoutAndRedirect('/')
          return
        }
        setLoadError('Không tải được danh sách cộng tác viên.')
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    loadCollabs()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className={compact ? 'grid gap-3 sm:grid-cols-2' : `${CARD} p-4`}>
      {!compact && <SectionTitle title="Cộng tác viên phụ trách" />}

      {loadError && (
        <div className={`${compact ? 'sm:col-span-2' : 'mb-3'} rounded-lg border border-clay/20 bg-clay/[0.05] px-3 py-2 text-sm text-clay`}>
          {loadError}
        </div>
      )}

      <div className={compact ? 'contents' : 'grid gap-3 sm:grid-cols-2'}>
        <div>
          <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40">
            Chọn coop
          </label>
          <select
            value={value.collabUsername}
            onChange={(event) => onChange((current) => ({
              ...current,
              collabUsername: event.target.value,
            }))}
            disabled={loading || collabs.length === 0}
            className="w-full rounded-lg border border-stone bg-paper px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10 disabled:text-ink/45"
          >
            <option value="">Không gán coop</option>
            {collabs.map((collab) => (
              <option key={collab.username} value={collab.username}>
                {collab.full_name || collab.username}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40">
            Bắt đầu ca
          </label>
          <input
            type="datetime-local"
            value={value.shiftStart}
            onChange={(event) => onChange((current) => ({
              ...current,
              shiftStart: event.target.value,
            }))}
            className="w-full rounded-lg border border-stone bg-paper px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
          />
        </div>

        <div>
          <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40">
            Kết thúc ca
          </label>
          <input
            type="datetime-local"
            value={value.shiftEnd}
            onChange={(event) => onChange((current) => ({
              ...current,
              shiftEnd: event.target.value,
            }))}
            className="w-full rounded-lg border border-stone bg-paper px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
          />
        </div>

        <div className="sm:col-span-2">
          <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40">
            Ghi chú ca trực
          </label>
          <textarea
            rows={3}
            value={value.note}
            onChange={(event) => onChange((current) => ({
              ...current,
              note: event.target.value,
            }))}
            placeholder="Ví dụ: trước giờ xuất phát, ưu tiên scan vào trạm."
            className="w-full rounded-lg border border-stone bg-paper px-3 py-2.5 text-sm leading-6 text-ink outline-none transition placeholder:text-ink/30 focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
          />
        </div>
      </div>
    </div>
  )
}

function StationForm({ initial, onSave, onCancel, allowInitialAssignment = false, draftKey, eventId }) {
  // Soạn trạm (quiz, markdown, giới hạn nộp...) có thể mất cả chục phút — bọc cả
  // `form` lẫn `initialAssignment` trong một bản nháp duy nhất, khoá theo trạm
  // (hoặc theo phase/event khi đang tạo mới, do trạm mới chưa có id riêng).
  const [draftValue, setDraftValue, draft] = useDraftState(
    draftKey || `station:${initial?.id || 'new'}`,
    () => ({
      form: createStation(initial),
      initialAssignment: { collabUsername: '', shiftStart: '', shiftEnd: '', note: '' },
    }),
  )
  const { form, initialAssignment } = draftValue
  const setForm = (next) => setDraftValue(current => ({
    ...current,
    form: typeof next === 'function' ? next(current.form) : next,
  }))
  const setInitialAssignment = (next) => setDraftValue(current => ({
    ...current,
    initialAssignment: typeof next === 'function' ? next(current.initialAssignment) : next,
  }))
  // Kéo-thả sắp xếp câu hỏi chỉ là trạng thái thao tác tạm thời trong phiên soạn
  // hiện tại — không có ý nghĩa gì để khôi phục sau reload nên không đưa vào draft.
  const [dragIndex, setDragIndex] = useState(null)
  const [dropIndex, setDropIndex] = useState(null)

  const [bankItems, setBankItems] = useState([])
  useEffect(() => {
    if (!eventId) return
    let active = true
    apiRequest(`/program/sub-events/${eventId}/question-bank`)
      .then(res => {
        if (active) setBankItems(res.items || [])
      })
      .catch(console.error)
    return () => { active = false }
  }, [eventId])

  const fileInputRef = useRef(null)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState(null)

  const handleFileImport = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      setImportError(null)
      const parsed = await importFromFile(file)
      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error("Không tìm thấy câu hỏi hợp lệ trong file")
      }
      
      const newItems = parsed.map(item => ({
        id: `quiz-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        type: 'quiz',
        question: item.question,
        options: item.options,
        correctOption: item.correctOption,
        points: item.points,
        required: true,
      }))
      
      updateSubmission(submission => ({
        ...submission,
        items: [...submission.items, ...newItems],
      }))
      
      setImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (err) {
      setImportError(err.message || 'Lỗi nhập dữ liệu')
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleExportJSON = () => {
    const quizItems = form.submission.items.filter(i => i.type === 'quiz')
    exportToJson(quizItems, `station_${form.code || 'draft'}_quiz.json`)
  }

  const handleExportExcel = () => {
    const quizItems = form.submission.items.filter(i => i.type === 'quiz')
    exportQuizToExcel(quizItems, `station_${form.code || 'draft'}_quiz.xlsx`)
  }

  const set = (key, value) => setForm(current => ({ ...current, [key]: value }))
  const updateSubmission = (updater) => {
    setForm(current => ({
      ...current,
      submission: updater(createSubmissionConfig(current.submission)),
    }))
  }

  const addItem = (type) => {
    updateSubmission(submission => ({
      ...submission,
      items: [...submission.items, createSubmissionItem(type)],
    }))
  }

  const updateItem = (itemId, key, value) => {
    updateSubmission(submission => ({
      ...submission,
      items: submission.items.map(item => (
        item.id === itemId ? { ...item, [key]: value } : item
      )),
    }))
  }

  const updateItemOption = (itemId, optionIndex, value) => {
    updateSubmission(submission => ({
      ...submission,
      items: submission.items.map(item => {
        if (item.id !== itemId) return item
        const nextOptions = [...item.options]
        nextOptions[optionIndex] = value
        return { ...item, options: nextOptions }
      }),
    }))
  }

  const removeItem = (itemId) => {
    updateSubmission(submission => ({
      ...submission,
      items: submission.items.filter(item => item.id !== itemId),
    }))
  }

  const moveItem = (fromIndex, toIndex) => {
    updateSubmission(submission => {
      const items = [...submission.items]
      if (
        fromIndex === toIndex
        || fromIndex < 0 || fromIndex >= items.length
        || toIndex < 0 || toIndex >= items.length
      ) return submission
      const [moved] = items.splice(fromIndex, 1)
      items.splice(toIndex, 0, moved)
      return { ...submission, items }
    })
  }

  const commitDrag = () => {
    if (dragIndex !== null && dropIndex !== null) moveItem(dragIndex, dropIndex)
    setDragIndex(null)
    setDropIndex(null)
  }

  const inlineQuizItemCount = form.submission.items.filter(item => item.type === 'quiz').length
  const bankUseAll = form.submission.bank?.useAll ?? false
  const bankItemCount = bankUseAll
    ? bankItems.length
    : (form.submission.bank?.itemIds?.length || 0)
  const quizItemCount = inlineQuizItemCount + bankItemCount
  const hasQuizItem = quizItemCount > 0
  const hasAttachmentItem = form.submission.items.some(item => item.type === 'attachment')
  // Chỉ có form thì mới có chuyện "nộp xong rồi sao nữa".
  const hasSubmissionItem = form.submission.items.length > 0 || bankItemCount > 0
  const quizRandomCount = form.submission.quiz.randomCount ?? 0


  const updateLimits = (key, value) => {
    updateSubmission(submission => ({
      ...submission,
      limits: {
        ...submission.limits,
        [key]: value,
      },
    }))
  }

  const handleSave = async () => {
    if (!form.name.trim()) return
    // onSave (addStation/saveStation) trả về true khi lưu thành công — chỉ xoá
    // nháp lúc đó, thất bại thì giữ nguyên để không mất nội dung đang soạn.
    const result = await onSave({
      ...form,
      name: form.name.trim(),
      location: form.location.trim(),
      submission: sanitizeSubmission(form.submission),
      initialAssignment,
    })
    if (result !== false) draft.clear()
  }

  const handleCancel = () => {
    draft.discard()
    onCancel()
  }

  return (
    <div className="space-y-5 px-4 py-4">
      <DraftNotice draft={draft} label="nội dung trạm đang soạn" />

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40">
            Tên trạm
          </label>
          <input
            value={form.name}
            onChange={event => set('name', event.target.value)}
            placeholder="Trạm 1 · UIT"
            className="w-full rounded-lg border border-stone bg-paper px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
          />
        </div>

        <div>
          <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40">
            Địa điểm
          </label>
          <input
            value={form.location}
            onChange={event => set('location', event.target.value)}
            placeholder="Địa chỉ trạm..."
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
            Luồng vào trạm
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

        {allowInitialAssignment && form.checkinPolicy !== 'free_play' && (
          <InitialAssignmentFields
            value={initialAssignment}
            onChange={setInitialAssignment}
            compact
          />
        )}

        <div>
          <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40">
            Công suất đồng thời
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
              Số đội tối đa cùng lúc
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

        <div className="sm:col-span-2">
          <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40">
            Cách tính điểm
          </label>
          <div className="grid grid-cols-3 gap-2">
            {Object.entries(SCORING_MODE_META).map(([key, meta]) => {
              const active = form.scoringMode === key
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => set('scoringMode', key)}
                  className={`rounded-lg border px-2.5 py-2 text-xs font-semibold transition ${
                    active
                      ? meta.selectedCls
                      : 'border-stone bg-white text-ink/55 hover:bg-paper hover:text-ink'
                  }`}
                >
                  {meta.label}
                </button>
              )
            })}
          </div>
          <p className="mt-1.5 text-xs leading-5 text-ink/45">
            {(SCORING_MODE_META[form.scoringMode] ?? SCORING_MODE_META.score_only).hint}
          </p>
        </div>

        {form.scoringMode === 'threshold' && (
          <div className="sm:col-span-2">
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40">
              Điểm đạt tối thiểu
            </label>
            <input
              type="number"
              min={0}
              value={form.passThreshold}
              onChange={event => set('passThreshold', Math.max(0, Number(event.target.value) || 0))}
              className="w-full rounded-lg border border-stone bg-paper px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
            />
          </div>
        )}

        {form.scoringMode === 'pass_fail' && (
          <div className="sm:col-span-2">
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40">
              Điểm khi đạt
            </label>
            <input
              type="number"
              min={0}
              value={form.passPoints}
              onChange={event => set('passPoints', Math.max(0, Number(event.target.value) || 0))}
              className="w-full rounded-lg border border-stone bg-paper px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
            />
          </div>
        )}
      </div>

      <div className="space-y-3">
        <SectionTitle
          title="Nhiệm vụ trạm"
          action={<Badge label="Markdown" cls="bg-[#3E7CA8]/12 text-[#3E7CA8]" />}
        />
        <MarkdownComposer
          value={form.submission.brief}
          onChange={value => updateSubmission(submission => ({ ...submission, brief: value }))}
          placeholder="Mô tả nhiệm vụ, checklist, clue, luật tính điểm... bằng Markdown."
        />
      </div>

      <div className="space-y-3">
        <SectionTitle
          title="Nội dung bài nộp"
          action={(
            <div className="flex flex-wrap gap-1.5">
              {['text', 'quiz', 'attachment'].map(type => {
                const meta = MODE_META[type]
                const blocked = type === 'attachment' && hasAttachmentItem
                return (
                  <button
                    key={type}
                    type="button"
                    disabled={blocked}
                    onClick={() => addItem(type)}
                    title={blocked ? 'Mỗi trạm chỉ dùng được một ô nộp tệp' : undefined}
                    className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition ${
                      blocked
                        ? 'cursor-not-allowed border-stone bg-paper text-ink/25'
                        : 'border-stone bg-white text-ink/60 hover:bg-paper hover:text-ink'
                    }`}
                  >
                    <Icon name="plus" className="h-3.5 w-3.5" />
                    {meta.addLabel}
                  </button>
                )
              })}
            </div>
          )}
        />

        <div className="flex gap-2 flex-wrap items-center">
          <button
            type="button"
            onClick={() => setImporting(!importing)}
            className="rounded-lg bg-paper px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-stone/50"
          >
            {importing ? 'Đóng' : 'Nhập file Excel/JSON'}
          </button>
          {form.submission.items.some(i => i.type === 'quiz') && (
            <>
              <button
                type="button"
                onClick={handleExportExcel}
                className="rounded-lg border border-stone bg-white px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-paper"
              >
                Xuất Excel
              </button>
              <button
                type="button"
                onClick={handleExportJSON}
                className="rounded-lg border border-stone bg-white px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-paper"
              >
                Xuất JSON
              </button>
            </>
          )}
        </div>

        {importing && (
          <div className="border-b border-stone p-4 bg-paper/50 rounded-xl mt-2 border">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-ink">Nhập từ file Excel/JSON</p>
              <div className="flex gap-2">
                <button type="button" onClick={downloadSampleExcel} className="text-xs text-trail hover:underline font-medium">Mẫu Excel</button>
                <button type="button" onClick={downloadSampleJson} className="text-xs text-trail hover:underline font-medium">Mẫu JSON</button>
              </div>
            </div>
            <p className="text-xs text-ink/60 mb-3">
              Hỗ trợ file <code>.xlsx</code> hoặc <code>.json</code>. Các câu hỏi sẽ được nối thêm vào danh sách trắc nghiệm.
            </p>
            <input
              type="file"
              accept=".json,.xlsx,.xls,.csv"
              ref={fileInputRef}
              onChange={handleFileImport}
              className="block w-full text-xs text-ink/70 file:mr-4 file:rounded-lg file:border-0 file:bg-ink file:px-4 file:py-2 file:text-xs file:font-semibold file:text-white hover:file:bg-ink/90 cursor-pointer"
            />
            {importError && <p className="text-xs text-clay mt-2">{importError}</p>}
          </div>
        )}

        {bankItems.length > 0 && (
          <div className={`${CARD} p-4 mb-4`}>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={bankUseAll}
                onChange={(e) => updateSubmission(sub => ({
                  ...sub,
                  bank: { ...sub.bank, useAll: e.target.checked },
                }))}
                className="mt-0.5 h-4 w-4 rounded border-stone text-trail focus:ring-trail/20"
              />
              <div className="flex-1">
                <p className="font-semibold text-sm text-ink">Lấy câu hỏi từ ngân hàng dùng chung</p>
                <p className="text-xs text-ink/60 mt-1">
                  Dùng toàn bộ {bankItems.length} câu của sự kiện (thêm câu vào ngân hàng thì trạm tự có thêm).
                  Số câu mỗi đội làm đặt ở ô “Số câu phát ngẫu nhiên” bên dưới.
                </p>
              </div>
            </label>
          </div>
        )}

        {form.submission.items.length === 0 ? (
          <div className={`${CARD} px-4 py-6 text-center text-sm italic text-ink/35`}>
            Chưa có mục nào. Thêm câu tự luận, câu trắc nghiệm hoặc ô nộp tệp — thứ tự bạn xếp ở đây
            chính là thứ tự đội nhìn thấy.
          </div>
        ) : (
          <div className="space-y-2.5">
            {form.submission.items.map((item, index) => (
              <SubmissionItemCard
                key={item.id}
                item={item}
                index={index}
                total={form.submission.items.length}
                isDragging={dragIndex === index}
                isDropTarget={dropIndex === index && dragIndex !== index}
                onDragStart={() => setDragIndex(index)}
                onDragEnter={() => setDropIndex(index)}
                onDragEnd={commitDrag}
                onRemove={() => removeItem(item.id)}
                onChange={(key, value) => updateItem(item.id, key, value)}
                onChangeOption={(optionIndex, value) => updateItemOption(item.id, optionIndex, value)}
              />
            ))}
          </div>
        )}

        {hasQuizItem && (
          <div className={`${CARD} p-4`}>
            <label className="inline-flex items-center gap-2 text-sm text-ink/60">
              <input
                type="checkbox"
                checked={form.submission.quiz.autoScore}
                onChange={event => updateSubmission(submission => ({
                  ...submission,
                  quiz: { ...submission.quiz, autoScore: event.target.checked },
                }))}
                className="h-4 w-4 rounded border-stone text-trail focus:ring-trail/20"
              />
              Tự cộng điểm quiz vào điểm đội trong phase (leaderboard)
            </label>
            <label className="mt-3 inline-flex items-center gap-2 text-sm text-ink/60">
              <input
                type="checkbox"
                checked={form.submission.quiz.randomizeOptions}
                onChange={event => updateSubmission(submission => ({
                  ...submission,
                  quiz: { ...submission.quiz, randomizeOptions: event.target.checked },
                }))}
                className="h-4 w-4 rounded border-stone text-trail focus:ring-trail/20"
              />
              Đảo ngẫu nhiên thứ tự các đáp án
            </label>
            <p className="mt-1 text-xs leading-5 text-ink/45">
              Tắt: điểm quiz chỉ hiển thị ở bài nộp để tham khảo khi chấm. Bật: mỗi lần đội nộp bài,
              tổng điểm các câu đúng tự ghi vào bảng điểm.
            </p>

            <div className="mt-4 border-t border-stone pt-4">
              <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40">
                Số câu phát ngẫu nhiên cho mỗi đội (0 = phát hết)
              </label>
              <input
                type="number"
                min={0}
                max={quizItemCount}
                value={quizRandomCount}
                onChange={event => updateSubmission(submission => ({
                  ...submission,
                  quiz: {
                    ...submission.quiz,
                    randomCount: Math.max(0, Number(event.target.value) || 0),
                  },
                }))}
                className="w-full rounded-lg border border-stone bg-paper px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
              />
              <p className="mt-1 text-xs leading-5 text-ink/45">
                Bộ đề đang có {quizItemCount} câu (gồm {inlineQuizItemCount} câu tự soạn, {bankItemCount} câu từ bộ chung). 
                Mỗi đội nhận một bộ cố định, mọi thành viên trong đội thấy cùng bộ câu.
              </p>
              
              {bankItemCount > 0 && quizRandomCount > 0 && (
                <label className="mt-3 inline-flex items-center gap-2 text-sm text-ink/60">
                  <input
                    type="checkbox"
                    checked={form.submission.bank?.mixStationQuiz ?? false}
                    onChange={event => updateSubmission(submission => ({
                      ...submission,
                      bank: { ...submission.bank, mixStationQuiz: event.target.checked },
                    }))}
                    className="h-4 w-4 rounded border-stone text-trail focus:ring-trail/20"
                  />
                  Ưu tiên lấy câu mới từ ngân hàng chung chưa thi ở trạm khác (mixStationQuiz)
                </label>
              )}

              {quizRandomCount > 0 && (
                <p className="mt-1 text-xs leading-5 text-ink/45">
                  {quizRandomCount < quizItemCount
                    ? `Mỗi đội sẽ làm ${quizRandomCount}/${quizItemCount} câu.`
                    : `Số câu đặt ra lớn hơn hoặc bằng ${quizItemCount} câu hiện có — mỗi đội sẽ làm hết bộ đề.`}
                </p>
              )}
              {form.submission.bank?.mixStationQuiz && quizRandomCount > bankItems.length && (
                <p className="mt-2 text-xs font-semibold text-clay bg-clay/10 p-2 rounded">
                  Lưu ý: N (các trạm) &gt; tổng số câu ngân hàng hiện có ({bankItems.length}). Trạm này có thể sẽ phải trộn lại các câu cũ nếu hết ngân hàng.
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      <div className={`${CARD} p-4`}>
        <SectionTitle title="Giới hạn nộp bài" />
        <div className="grid gap-3">
          <div>
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40">
              Thời gian mở form (Tùy chọn)
            </label>
            <input
              type="datetime-local"
              value={form.submission.limits.opensAt}
              onChange={event => updateLimits('opensAt', event.target.value)}
              className="w-full rounded-lg border border-stone bg-paper px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10 mb-3"
            />
            
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40">
              Thời gian đóng form (Tùy chọn)
            </label>
            <input
              type="datetime-local"
              value={form.submission.limits.closesAt}
              onChange={event => updateLimits('closesAt', event.target.value)}
              className="w-full rounded-lg border border-stone bg-paper px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10 mb-4"
            />

            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40">
              Thời gian làm bài (Phút, 0 = Không giới hạn)
            </label>
            <input
              type="number"
              min={0}
              value={form.submission.limits.durationMinutes || 0}
              onChange={event => updateLimits('durationMinutes', Math.max(0, Number(event.target.value) || 0))}
              className="w-full rounded-lg border border-stone bg-paper px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10 mb-4"
            />
            <p className="mt-1 mb-4 text-xs leading-5 text-ink/45">
              Thời gian đếm ngược sẽ tính từ lúc đội check-in quét QR mã trạm.
            </p>

            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40">
              Số đội nộp tối đa (0 = không giới hạn)
            </label>
            <input
              type="number"
              min={0}
              value={form.submission.limits.maxSubmissions}
              onChange={event => updateLimits('maxSubmissions', Math.max(0, Number(event.target.value) || 0))}
              className="w-full rounded-lg border border-stone bg-paper px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
            />
            <p className="mt-1 text-xs leading-5 text-ink/45">
              Form tự động đóng khi đủ số đội đã nộp.
            </p>
          </div>
          <label className="inline-flex items-center gap-2 text-sm text-ink/60">
            <input
              type="checkbox"
              checked={form.submission.limits.closeOnCorrect}
              onChange={event => updateLimits('closeOnCorrect', event.target.checked)}
              className="h-4 w-4 rounded border-stone text-trail focus:ring-trail/20"
            />
            Tự động đóng khi có đội trả lời đúng toàn bộ trắc nghiệm
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-ink/60">
            <input
              type="checkbox"
              checked={form.submission.limits.manualClosed}
              onChange={event => updateLimits('manualClosed', event.target.checked)}
              className="h-4 w-4 rounded border-stone text-trail focus:ring-trail/20"
            />
            Đóng form ngay (không nhận bài nộp mới)
          </label>
        </div>
      </div>

      {hasSubmissionItem && (
        <div className={`${CARD} p-4`}>
          <SectionTitle title="Chống gian lận" />
          <label className="mt-2 inline-flex items-start gap-3 text-sm text-ink/60 cursor-pointer">
            <input
              type="checkbox"
              checked={form.submission.antiCheat ?? true}
              onChange={event => updateSubmission(submission => ({
                ...submission,
                antiCheat: event.target.checked,
              }))}
              className="mt-0.5 h-4 w-4 rounded border-stone text-trail focus:ring-trail/20"
            />
            <div className="flex-1">
              <span className="font-semibold text-ink">Bật hệ thống chống gian lận cho trạm này</span>
              <p className="mt-1 text-xs leading-5 text-ink/45">
                Chặn copy, vô hiệu hóa phím tắt (F12, In, DevTools), tự làm mờ màn hình khi rời tab, và chèn bẫy AI/OCR vào trang. Tắt khi dùng thiết bị lạ hoặc khi tính tương thích được ưu tiên.
              </p>
            </div>
          </label>
        </div>
      )}

      {hasSubmissionItem && (
        <div className={`${CARD} p-4`}>
          <SectionTitle title="Kết thúc lượt tại trạm" />
          <label className="mt-2 inline-flex items-start gap-2 text-sm text-ink/60">
            <input
              type="checkbox"
              checked={form.submission.flow.checkoutAfterSubmit}
              onChange={event => updateSubmission(submission => ({
                ...submission,
                flow: { ...submission.flow, checkoutAfterSubmit: event.target.checked },
              }))}
              className="mt-0.5 h-4 w-4 rounded border-stone text-trail focus:ring-trail/20"
            />
            Nộp bài xong vẫn phải quét QR rời trạm
          </label>
          <p className="mt-1 text-xs leading-5 text-ink/45">
            Bật: nộp xong đội thấy QR rời trạm, coop quét thì trạm mới trống chỗ.
            Tắt: nộp bài coi như đã rời trạm, phù hợp với trạm không giới hạn chỗ.
          </p>
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={handleCancel}
          className="flex-1 rounded-lg border border-stone bg-white py-2.5 text-sm font-semibold text-ink/60 transition hover:bg-paper"
        >
          Hủy
        </button>
        <button
          type="button"
          onClick={() => void handleSave()}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-ink py-2.5 text-sm font-semibold text-white transition hover:brightness-[0.9]"
        >
          <Icon name="checkPlain" className="h-4 w-4" />
          Lưu trạm
        </button>
      </div>
    </div>
  )
}

function resolveAttachmentUrl(url) {
  if (!url) return null
  return url.startsWith('/') ? `${API_BASE_URL}${url}` : url
}

function StationSubmissionDetailView({ submission, onGrade, busy }) {
  const [scoreInput, setScoreInput] = useState(submission.score ?? '')
  const files = submission.files || []
  const formAnswers = submission.response_payload?.form || []
  const quizAnswers = submission.response_payload?.quiz || []
  const quizResult = submission.response_payload?.quiz_result || null
  const statusMeta = submission.status === 'graded'
    ? { label: 'Đã chấm', cls: 'bg-trail/12 text-trail' }
    : { label: 'Đã nộp', cls: 'bg-gold/15 text-[#9A6B12]' }

  return (
    <div className={`${CARD} px-5 py-5`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xl font-bold text-ink">{submission.team_name}</p>
          <p className="font-mono text-sm text-ink/40">{submission.team_code}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge {...statusMeta} />
          {submission.is_correct !== null && submission.is_correct !== undefined && (
            <Badge
              label={submission.is_correct ? 'Đúng' : 'Sai'}
              cls={submission.is_correct ? 'bg-trail/12 text-trail' : 'bg-clay/12 text-clay'}
            />
          )}
        </div>
      </div>

      <p className="mt-3 text-sm text-ink/50">
        Nộp lúc: {submission.submitted_at ? formatDateTime(submission.submitted_at) : 'Chưa nộp'}
        {submission.graded_by ? ` · Đã chấm bởi ${submission.graded_by}` : ''}
        {submission.score !== null && submission.score !== undefined ? ` · Điểm: ${submission.score}` : ''}
      </p>
      {quizResult ? (
        <p className="mt-1 text-sm font-medium text-[#3E7CA8]">
          Quiz: đúng {quizResult.correct_count}/{quizResult.total} câu · {quizResult.points}/{quizResult.max_points} điểm
        </p>
      ) : null}

      <div className="mt-6 border-t border-stone/40 pt-4">
        {formAnswers.length > 0 && (
          <div className="mt-4 space-y-2">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-ink/40">Câu trả lời</p>
            {formAnswers.map((field, index) => (
              <div key={field.id || index} className="rounded-xl border border-stone bg-paper px-4 py-3">
                <p className="text-sm font-medium text-ink/60">{field.label || `Trường ${index + 1}`}</p>
                <p className="mt-1 text-base text-ink">{field.value || '—'}</p>
              </div>
            ))}
          </div>
        )}

        {quizAnswers.length > 0 && (
          <div className="mt-6 space-y-2">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-ink/40">Trắc nghiệm</p>
            {quizAnswers.map((item, index) => (
              <div key={item.id || index} className="rounded-xl border border-stone bg-paper px-4 py-3">
                <p className="text-sm font-medium text-ink/60">{item.question || `Câu ${index + 1}`}</p>
                <p className="mt-1 text-base text-ink">
                  {item.selectedOption === null || item.selectedOption === undefined
                    ? 'Chưa chọn đáp án'
                    : `Đã chọn: đáp án ${Number(item.selectedOption) + 1}`}
                </p>
              </div>
            ))}
          </div>
        )}

        {files.length > 0 && (
          <div className="mt-6 space-y-2">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-ink/40">Tệp đính kèm</p>
            <div className="flex flex-wrap gap-2">
              {files.map((file, index) => {
                const url = resolveAttachmentUrl(file.url)
                return url ? (
                  <a
                    key={file.key || index}
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-stone bg-paper px-3 py-2 text-sm font-medium text-ink/70 transition hover:bg-white"
                  >
                    <Icon name="paperclip" className="h-4 w-4" />
                    {file.name}
                  </a>
                ) : (
                  <span
                    key={file.key || index}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-stone px-3 py-2 text-sm text-ink/40"
                  >
                    <Icon name="paperclip" className="h-4 w-4" />
                    {file.name} (chưa có link)
                  </span>
                )
              })}
            </div>
          </div>
        )}

        <div className="mt-8 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onGrade(submission.id, { is_correct: true })}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg border border-trail/30 bg-trail/10 px-4 py-2 text-sm font-semibold text-trail transition hover:bg-trail/15 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Icon name="checkPlain" className="h-4 w-4" />
            Đánh dấu Đúng
          </button>
          <button
            type="button"
            onClick={() => onGrade(submission.id, { is_correct: false })}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg border border-clay/30 bg-clay/10 px-4 py-2 text-sm font-semibold text-clay transition hover:bg-clay/15 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Icon name="xmark" className="h-4 w-4" />
            Đánh dấu Sai
          </button>
          <div className="ml-auto flex items-center gap-2">
            {quizResult ? (
              <button
                type="button"
                onClick={() => setScoreInput(String(quizResult.points))}
                disabled={busy}
                title="Điền điểm quiz tự tính vào ô điểm"
                className="inline-flex items-center gap-1.5 rounded-lg border border-stone bg-white px-3 py-2 text-sm font-semibold text-[#3E7CA8] transition hover:bg-paper disabled:cursor-not-allowed disabled:opacity-40"
              >
                Lấy điểm quiz
              </button>
            ) : null}
            <input
              type="number"
              value={scoreInput}
              onChange={event => setScoreInput(event.target.value)}
              placeholder="Điểm"
              className="w-24 rounded-lg border border-stone bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
            />
            <button
              type="button"
              onClick={() => onGrade(submission.id, { score: Number(scoreInput) })}
              disabled={busy || scoreInput === '' || !Number.isFinite(Number(scoreInput))}
              className="inline-flex items-center gap-1.5 rounded-lg border border-stone bg-white px-4 py-2 text-sm font-semibold text-ink/70 transition hover:bg-paper hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
            >
              Lưu điểm
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function StationSubmissionsView({ stationId, stationName, onBack }) {
  const [submissions, setSubmissions] = useState([])
  const [stationLabel, setStationLabel] = useState(stationName || '')
  const [loading, setLoading] = useState(true)
  const [apiError, setApiError] = useState('')
  const [busyId, setBusyId] = useState('')
  const [selectedSubmissionId, setSelectedSubmissionId] = useState(null)

  const load = useCallback(async () => {
    if (!stationId) return
    try {
      setLoading(true)
      setApiError('')
      const payload = await apiRequest(`/stations/${stationId}/submissions`)
      setSubmissions(payload.submissions || [])
      setStationLabel(payload.station_name || stationName || '')
    } catch (error) {
      if (error?.status === 401) {
        logoutAndRedirect('/')
        return
      }
      setApiError(explainApiError(error))
    } finally {
      setLoading(false)
    }
  }, [stationId, stationName])

  useEffect(() => {
    if (stationId) void load()
  }, [stationId, load])

  if (!stationId) return null

  const handleGrade = async (submissionId, body) => {
    try {
      setBusyId(submissionId)
      setApiError('')
      const updated = await apiRequest(`/submissions/${submissionId}/grade`, {
        method: 'PATCH',
        body,
      })
      setSubmissions(current => current.map(item => (item.id === updated.id ? updated : item)))
    } catch (error) {
      if (error?.status === 401) {
        logoutAndRedirect('/')
        return
      }
      setApiError(explainApiError(error))
    } finally {
      setBusyId('')
    }
  }

  const selectedSubmission = submissions.find(s => s.id === selectedSubmissionId)

  if (selectedSubmission) {
    return (
      <div className="space-y-4">
        <StationErrorBanner message={apiError} />
        <div className={`${CARD} px-5 py-4`}>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <button
                type="button"
                onClick={() => setSelectedSubmissionId(null)}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-ink/50 transition hover:text-ink"
              >
                <Icon name="chevronR" className="h-3.5 w-3.5 rotate-180" />
                Danh sách bài nộp
              </button>
              <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.2em] text-ink/40">{stationLabel}</p>
              <h2 className="mt-1 truncate font-display text-2xl font-bold text-ink">{selectedSubmission.team_name}</h2>
              <p className="mt-1 text-sm text-ink/45">Mã đội: {selectedSubmission.team_code}</p>
            </div>
          </div>
        </div>
        <StationSubmissionDetailView 
          submission={selectedSubmission} 
          onGrade={handleGrade} 
          busy={busyId === selectedSubmission.id} 
        />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <StationErrorBanner message={apiError} />

      <div className={`${CARD} px-5 py-4`}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <StationBackLink onClick={onBack} />
            <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.2em] text-ink/40">Bài nộp trạm</p>
            <h2 className="mt-1 truncate font-display text-2xl font-bold text-ink">{stationLabel}</h2>
            <p className="mt-1 text-sm text-ink/45">{submissions.length} bài nộp</p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {loading ? (
          <div className={`${CARD} px-4 py-10 text-center text-sm text-ink/40`}>
            Đang tải bài nộp...
          </div>
        ) : submissions.length > 0 ? (
          <div className="space-y-3">
            {submissions.map(submission => {
              const statusMeta = submission.status === 'graded'
                ? { label: 'Đã chấm', cls: 'bg-trail/12 text-trail' }
                : { label: 'Đã nộp', cls: 'bg-gold/15 text-[#9A6B12]' }
              return (
                <div 
                  key={submission.id}
                  className={`${CARD} cursor-pointer px-5 py-4 transition hover:border-stone/80 hover:bg-paper group`}
                  onClick={() => setSelectedSubmissionId(submission.id)}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-base font-semibold text-ink">{submission.team_name}</p>
                        <Badge {...statusMeta} />
                      </div>
                      <p className="mt-1 text-sm text-ink/50">
                        {submission.team_code} · {submission.submitted_at ? formatDateTime(submission.submitted_at) : 'Chưa nộp'}
                        {submission.score !== null && submission.score !== undefined ? ` · Điểm: ${submission.score}` : ''}
                      </p>
                    </div>
                    <div className="shrink-0 text-ink/20 transition group-hover:text-ink/60">
                      <Icon name="chevronR" className="h-5 w-5" />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className={`${CARD} border-dashed px-4 py-10 text-center text-sm text-ink/40`}>
            Trạm này chưa có đội nào nộp bài.
          </div>
        )}
      </div>
    </div>
  )
}

function StationBackLink({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-ink/50 transition hover:text-ink"
    >
      <Icon name="chevronR" className="h-3.5 w-3.5 rotate-180" />
      Danh sách trạm
    </button>
  )
}

function StationErrorBanner({ message }) {
  if (!message) return null
  return (
    <div className="rounded-xl border border-clay/20 bg-clay/[0.05] px-4 py-3 text-sm text-clay">
      {message}
    </div>
  )
}

/** Cột phải của trang sửa trạm: số liệu vận hành, phân công CTV, đội đang ở/đã xong. */
function StationOpsColumn({ station, phase, selectedEvent }) {
  const totalScore = sumStationScore(station)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
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
          <p className="mt-1 text-[11px] text-ink/40">Tổng điểm trạm</p>
        </div>
      </div>

      <StationFlowOverview station={station} />

      <StationAssignmentsPanel
        phase={phase}
        selectedEvent={selectedEvent}
        stations={[station]}
        selectedStation={station}
        embedded
      />

      <div>
        <SectionTitle title={`Đang ở đây · ${station.teamsHere.length} đội`} />
        <div className={`${CARD} max-h-72 divide-y divide-stone/50 overflow-y-auto`}>
          {station.teamsHere.length > 0 ? station.teamsHere.map(team => (
            <div key={team.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{team.name}</p>
                <p className="font-mono text-[11px] text-ink/40">{team.id}</p>
              </div>
              <span className="shrink-0 font-mono text-xs text-gold">{team.arrivedAt}</span>
            </div>
          )) : (
            <p className="px-4 py-4 text-sm italic text-ink/30">Chưa có đội nào ở đây.</p>
          )}
        </div>
      </div>

      <div>
        <SectionTitle title={`Đã hoàn thành · ${station.teamsDone.length} đội`} />
        <div className={`${CARD} max-h-72 divide-y divide-stone/50 overflow-y-auto`}>
          {station.teamsDone.length > 0 ? station.teamsDone.map(team => (
            <div key={team.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{team.name}</p>
                <p className="font-mono text-[11px] text-ink/40">{team.id}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-mono text-sm font-semibold text-[#3E7CA8]">{Number(team.score) || 0} điểm</p>
                <p className="font-mono text-[11px] text-trail">{team.doneAt}</p>
              </div>
            </div>
          )) : (
            <p className="px-4 py-4 text-sm italic text-ink/30">Chưa có đội nào hoàn thành.</p>
          )}
        </div>
      </div>
    </div>
  )
}

function StationEditView({
  station,
  phase,
  phaseInfo,
  phaseMeta,
  selectedEvent,
  error,
  onSave,
  onDelete,
  onToggleActive,
  onBack,
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const status = STATUS[station.active ? 'active' : 'inactive']
  const eventMeta = SUB_EVENT_TYPE_META[selectedEvent?.type] ?? SUB_EVENT_TYPE_META.custom

  const handleSave = async (form) => onSave(station.id, form)

  return (
    <div className="space-y-4">
      <StationErrorBanner message={error} />

      <div className={`${CARD} px-5 py-4`}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <StationBackLink onClick={onBack} />
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-xs font-semibold text-ink/40">{station.id}</span>
              <Badge {...status} />
              <Badge label={phaseInfo.label} cls={phaseMeta.badgeCls} />
              {selectedEvent && <Badge label={selectedEvent.name} cls={eventMeta.cls} />}
            </div>
            <h2 className="mt-1.5 truncate font-display text-2xl font-bold text-ink">{station.name}</h2>
            {station.location && (
              <div className="mt-0.5 flex items-start gap-1 text-sm text-ink/50">
                <Icon name="pin" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{station.location}</span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {confirmDelete ? (
              <>
                <span className="text-sm text-ink/55">Xoá trạm này?</span>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="rounded-lg border border-stone bg-white px-4 py-2.5 text-sm font-semibold text-ink/60 transition hover:bg-paper"
                >
                  Hủy
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onDelete(station.id)
                    setConfirmDelete(false)
                  }}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-clay px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-[0.96]"
                >
                  <Icon name="trash" className="h-4 w-4" />
                  Xác nhận xoá
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  title="Xoá trạm"
                  className="rounded-lg border border-stone p-2.5 text-ink/35 transition hover:border-clay/30 hover:text-clay"
                >
                  <Icon name="trash" className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onToggleActive(station.id)}
                  className={`rounded-lg border px-4 py-2.5 text-sm font-semibold transition ${
                    station.active
                      ? 'border-ink/15 bg-white text-ink/60 hover:bg-paper'
                      : 'border-trail/30 bg-trail/[0.06] text-trail hover:bg-trail/10'
                  }`}
                >
                  {station.active ? 'Tạm ngưng trạm' : 'Kích hoạt trạm'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.9fr)]">
        <div className={`${CARD} overflow-hidden`}>
          <div className="border-b border-stone px-5 py-3">
            <p className="font-display font-semibold text-ink">Cấu hình trạm</p>
          </div>
          <StationForm initial={station} onSave={handleSave} onCancel={onBack} eventId={selectedEvent.id} />
        </div>

        <StationOpsColumn station={station} phase={phase} selectedEvent={selectedEvent} />
      </div>
    </div>
  )
}

function StationCreateView({ phaseInfo, phaseMeta, selectedEvent, error, draftKey, onSave, onBack }) {
  const eventMeta = SUB_EVENT_TYPE_META[selectedEvent?.type] ?? SUB_EVENT_TYPE_META.custom

  return (
    <div className="space-y-4">
      <StationErrorBanner message={error} />

      <div className={`${CARD} px-5 py-4`}>
        <StationBackLink onClick={onBack} />
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Badge label={phaseInfo.label} cls={phaseMeta.badgeCls} />
          <Badge label={selectedEvent.name} cls={eventMeta.cls} />
        </div>
        <h2 className="mt-1.5 font-display text-2xl font-bold text-ink">Thêm trạm mới</h2>
      </div>

      <div className={`${CARD} overflow-hidden`}>
        <div className="border-b border-stone px-5 py-3">
          <p className="font-display font-semibold text-ink">Thông tin trạm</p>
        </div>
        <StationForm
          initial={createBlankStation()}
          onSave={onSave}
          onCancel={onBack}
          allowInitialAssignment
          draftKey={draftKey}
          eventId={selectedEvent.id}
        />
      </div>
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
  // Event/trạm/form đang mở sống trên query string của chính /admin/stations,
  // để reload và nút back trả về đúng màn hình thay vì văng về danh sách trống.
  const [selectedEventId, setSelectedEventId] = useSearchParam('event', '')
  const [selectedId, setSelectedId] = useSearchParam('station', '')
  const [submissionsStationId, setSubmissionsStationId] = useSearchParam('submissions', '')
  const [addingParam, setAddingParam] = useSearchParam('new', '')
  const adding = addingParam === '1'
  // Bọc useCallback để các effect bên dưới khai báo được nó trong dependency
  // array mà không bị chạy lại mỗi lần render.
  const setAdding = useCallback(
    (value, options) => setAddingParam(value ? '1' : '', options),
    [setAddingParam],
  )
  const [listLoading, setListLoading] = useState(false)
  const [busyKey, setBusyKey] = useState('')
  const [apiError, setApiError] = useState('')

  // Tạo/sửa/xoá trạm và đổi phase hiện tại là đặc quyền master admin; backend
  // trả 403 `master_admin_required`, ở đây chỉ khoá UI cho khỏi bấm vào chỗ cấm.
  const canEditStations = isMasterAdmin()
  const masterAdminOnlyMessage = () => explainApiError({ data: { error: 'master_admin_required' } })

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

  const syncStationsForEvent = useCallback((phaseKey, eventId, nextStations) => {
    setStationsByPhaseEvent(current => ({
      ...current,
      [phaseKey]: {
        ...(current[phaseKey] ?? {}),
        [eventId]: nextStations,
      },
    }))
  }, [])

  useEffect(() => {
    // Trang tự chọn event mặc định — dùng replace để việc này không tự tạo
    // thêm một nấc lịch sử mà người dùng chưa từng bấm tới.
    if (phaseStationEvents.length === 0) {
      setSelectedEventId('', { replace: true })
      return
    }

    if (!selectedEventId || !phaseStationEvents.some(eventItem => eventItem.id === selectedEventId)) {
      setSelectedEventId(phaseStationEvents[0].id, { replace: true })
    }
  }, [phaseStationEvents, selectedEventId, setSelectedEventId])

  // Đổi phase/event làm danh sách trạm bên dưới đổi hẳn, nên trạm/form đang mở
  // theo ngữ cảnh cũ không còn hợp lệ nữa — nhưng bỏ qua lần chạy đầu tiên lúc
  // mount, kẻo một đường link sâu kiểu ?event=3&station=12 bị xoá ngay khi vừa vào.
  const skipSelectionResetRef = useRef(true)
  useEffect(() => {
    if (skipSelectionResetRef.current) {
      skipSelectionResetRef.current = false
      return
    }
    setSelectedId('', { replace: true })
    setAdding(false, { replace: true })
  }, [phase, selectedEventId, setSelectedId, setAdding])

  const reloadSelectedEvent = useCallback(async () => {
    if (!selectedEventId) return
    try {
      setListLoading(true)
      setApiError('')
      const nextStations = await fetchStationsForEvent(phase, selectedEventId)
      syncStationsForEvent(phase, selectedEventId, nextStations)
    } catch (error) {
      if (error?.status === 401) {
        logoutAndRedirect('/')
        return
      }
      setApiError(explainApiError(error))
    } finally {
      setListLoading(false)
    }
  }, [phase, selectedEventId, syncStationsForEvent])

  useEffect(() => {
    if (!selectedEventId) return
    void reloadSelectedEvent()
  }, [reloadSelectedEvent, selectedEventId])

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
    // Id trong URL có thể không còn thuộc event/phase đang xem (đổi phase, đổi
    // event, hoặc trạm đã bị xoá) — đóng êm thay vì giữ một tham chiếu treo.
    if (selectedId && !stations.some(station => station.id === selectedId)) {
      setSelectedId('', { replace: true })
    }
  }, [selectedId, stations, setSelectedId])

  const selected = stations.find(station => station.id === selectedId) ?? null
  const active = stations.filter(station => station.active)
  const inactive = stations.filter(station => !station.active)
  const totalHere = stations.reduce((total, station) => total + station.teamsHere.length, 0)
  const totalDone = stations.reduce((total, station) => total + station.teamsDone.length, 0)

  const toggleActive = async (id) => {
    const station = stations.find(item => item.id === id)
    if (!station) return
    // Bật/tắt trạm cũng là PATCH /stations/{id}, cùng cổng quyền với sửa trạm.
    if (!canEditStations) {
      setApiError(masterAdminOnlyMessage())
      return
    }

    try {
      setBusyKey(`toggle:${id}`)
      setApiError('')
      await apiRequest(`/stations/${id}`, {
        method: 'PATCH',
        body: { active: !station.active },
      })
      await reloadSelectedEvent()
    } catch (error) {
      if (error?.status === 401) {
        logoutAndRedirect('/')
        return
      }
      setApiError(explainApiError(error))
    } finally {
      setBusyKey('')
    }
  }

  const saveStation = async (id, form) => {
    const station = stations.find(item => item.id === id)
    if (!station) return false
    if (!canEditStations) {
      setApiError(masterAdminOnlyMessage())
      return false
    }

    try {
      setBusyKey(`save:${id}`)
      setApiError('')
      await apiRequest(`/stations/${id}`, {
        method: 'PATCH',
        body: buildStationPayload(form, station.order, form.active),
      })
      await reloadSelectedEvent()
      // StationForm chỉ xoá bản nháp khi biết chắc lưu thành công.
      return true
    } catch (error) {
      if (error?.status === 401) {
        logoutAndRedirect('/')
        return false
      }
      setApiError(explainApiError(error))
      return false
    } finally {
      setBusyKey('')
    }
  }

  const deleteStation = async (id) => {
    if (!canEditStations) {
      setApiError(masterAdminOnlyMessage())
      return
    }
    try {
      setBusyKey(`delete:${id}`)
      setApiError('')
      await apiRequest(`/stations/${id}`, { method: 'DELETE' })
      setSelectedId(null)
      await reloadSelectedEvent()
    } catch (error) {
      if (error?.status === 401) {
        logoutAndRedirect('/')
        return
      }
      setApiError(explainApiError(error))
    } finally {
      setBusyKey('')
    }
  }

  const addStation = async (form) => {
    if (!selectedEventId) return false
    if (!canEditStations) {
      setApiError(masterAdminOnlyMessage())
      return false
    }
    try {
      setBusyKey('create')
      setApiError('')
      const code = makeStationId(phase, stations)
      const createdStation = await apiRequest(`/sub-events/${selectedEventId}/stations`, {
        method: 'POST',
        body: {
          code,
          ...buildStationPayload(form, stations.length + 1, true),
        },
      })
      if (form.initialAssignment?.collabUsername && createdStation?.id) {
        await apiRequest('/admin/station-assignments', {
          method: 'POST',
          body: {
            collab_username: form.initialAssignment.collabUsername,
            station_id: Number(createdStation.id),
            shift_start: form.initialAssignment.shiftStart || null,
            shift_end: form.initialAssignment.shiftEnd || null,
            note: form.initialAssignment.note?.trim() || '',
          },
        })
      }
      setAdding(false)
      await reloadSelectedEvent()
      return true
    } catch (error) {
      if (error?.status === 401) {
        logoutAndRedirect('/')
        return false
      }
      setApiError(explainApiError(error))
      return false
    } finally {
      setBusyKey('')
    }
  }

  // Sửa/thêm trạm là trang riêng thay vì drawer: form dài cần không gian,
  // URL vẫn là query string (?station=/?new=1) nên reload + back hoạt động như cũ.
  if (adding && selectedEvent) {
    return (
      <StationCreateView
        phaseInfo={phaseInfo}
        phaseMeta={phaseMeta}
        selectedEvent={selectedEvent}
        error={apiError}
        // Trạm mới chưa có id — khoá nháp theo phase/event đang chọn để hai
        // event khác nhau không lỡ trộn nháp "thêm trạm" của nhau.
        draftKey={`station:new:${phase}:${selectedEventId}`}
        onSave={addStation}
        onBack={() => setAdding(false)}
      />
    )
  }

  if (selectedId && selected) {
    return (
      <StationEditView
        key={selected.id}
        station={selected}
        phase={phase}
        phaseInfo={phaseInfo}
        phaseMeta={phaseMeta}
        selectedEvent={selectedEvent}
        error={apiError}
        onSave={saveStation}
        onDelete={deleteStation}
        onToggleActive={toggleActive}
        onBack={() => setSelectedId(null)}
      />
    )
  }

  if (submissionsStationId) {
    return (
      <StationSubmissionsView
        stationId={submissionsStationId}
        stationName={stations.find(station => station.id === submissionsStationId)?.name}
        onBack={() => setSubmissionsStationId(null)}
      />
    )
  }


  return (
    <div className="space-y-4">
      {apiError && (
        <div className="rounded-xl border border-clay/20 bg-clay/[0.05] px-4 py-3 text-sm text-clay">
          {apiError}
        </div>
      )}

      <div className={`${CARD} space-y-3 px-5 py-4`}>
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <PhaseSwitcher
            phase={phase}
            phaseOptions={phaseOptions}
            onChange={onPhaseChange}
            disabled={!canEditStations}
          />

          <div className="flex flex-wrap items-center gap-2">
            {listLoading && <span className="text-xs text-ink/40">Đang tải trạm...</span>}
            <button
              type="button"
              onClick={() => void reloadSelectedEvent()}
              disabled={!selectedEventId || listLoading || Boolean(busyKey)}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-stone bg-white px-4 py-2.5 text-sm font-semibold text-ink/65 transition hover:bg-paper hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Icon name="check" className="h-4 w-4" />
              Tải lại
            </button>
            <button
              type="button"
              onClick={() => setAdding(true)}
              disabled={!selectedEvent || Boolean(busyKey) || !canEditStations}
              title={!canEditStations ? 'Chỉ master admin mới được tạo trạm.' : undefined}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-[0.9] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Icon name="plus" className="h-4 w-4" />
              Thêm trạm
            </button>
            {!canEditStations && (
              <span className="text-xs leading-5 text-ink/45">
                Chỉ master admin mới tạo/sửa/xoá được trạm.
              </span>
            )}
          </div>
        </div>

        {phaseStationEvents.length > 0 ? (
          <div className="space-y-2.5 border-t border-stone pt-3">
            <StationEventSwitcher
              selectedEventId={selectedEventId}
              events={phaseStationEvents}
              stationsByEvent={phaseBucket}
              onChange={setSelectedEventId}
            />
            <p className="font-mono text-xs leading-5 text-ink/45">
              {selectedEvent ? `${selectedEvent.name} · ` : ''}
              {stations.length} trạm · {active.length} hoạt động · {inactive.length} chưa mở · {totalHere} đội đang ở trạm · {totalDone} lượt hoàn thành
            </p>
          </div>
        ) : (
          <div className="border-t border-stone pt-3">
            <div className="rounded-lg border border-dashed border-stone bg-paper px-4 py-3 text-sm leading-6 text-ink/45">
              Phase này chưa có event nào bật "Có trạm" — hãy vào tab Quản lý sự kiện, tạo event con và bật tuỳ chọn đó trước khi thêm trạm.
            </div>
          </div>
        )}
      </div>

      {SHOW_CHECKIN_QR && <CheckinQrToggle />}

      {selectedEvent ? (
        <div className={`${CARD} overflow-hidden`}>
          <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-left">
            <thead>
              <tr className="border-b border-stone font-mono text-[10px] uppercase tracking-wider text-ink/35">
                <th className="w-12 px-4 py-3 font-medium">STT</th>
                <th className="px-4 py-3 font-medium">Tên trạm</th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">Địa điểm</th>
                <th className="px-4 py-3 font-medium">Bài nộp</th>
                <th className="px-4 py-3 text-center font-medium">Đội ở · xong</th>
                <th className="px-4 py-3 text-right font-medium">Điểm</th>
                <th className="px-4 py-3 font-medium">Trạng thái</th>
                <th className="w-8 px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-stone/60">
              {listLoading && (
                <tr>
                  <td colSpan={8} className="px-4 py-14 text-center text-sm text-ink/35">
                    Đang đồng bộ danh sách trạm...
                  </td>
                </tr>
              )}

              {!listLoading && stations.map(station => {
                const status = STATUS[station.active ? 'active' : 'inactive']
                const stationScore = sumStationScore(station)
                return (
                  <tr
                    key={station.id}
                    onClick={() => setSubmissionsStationId(station.id)}
                    className={`cursor-pointer transition hover:bg-paper/70 ${submissionsStationId === station.id ? 'bg-paper/60' : ''}`}
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
                      <div className="flex items-center gap-2">
                        <SubmissionModeList submission={station.submission} compact />
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-center">
                      <span className={`font-mono text-sm font-semibold ${station.teamsHere.length > 0 ? 'text-gold' : 'text-ink/25'}`}>
                        {station.teamsHere.length}
                      </span>
                      <span className="mx-1 text-ink/25">·</span>
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
                    <td className="px-4 py-3.5 text-right">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          setSelectedId(station.id)
                        }}
                        className="inline-flex shrink-0 items-center justify-center rounded-lg p-2 text-ink/35 transition hover:bg-stone/50 hover:text-ink"
                        title="Sửa trạm"
                      >
                        <Icon name="edit" className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                )
              })}

              {!listLoading && stations.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center text-sm text-ink/35">
                    Chưa có trạm nào cho event {selectedEvent.name.toLowerCase()}. Bấm "Thêm trạm" để bắt đầu.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default StationsPage
