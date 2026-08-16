import { useEffect, useMemo, useState } from 'react'
import { apiRequest } from './api.js'
import { Icon } from './ui.jsx'
import { TurnstileWidget, HoneypotField } from './antibot.jsx'
import { useFormSignals, ANTIBOT_ERROR_TEXT, ANTIBOT_ERROR_CODES } from './antibot.js'

// ── Program timeline (from the 2025 brief). Shown as trail waypoints. ──────────
const STAGES = [
  { key: 'register', label: 'Đăng ký', when: '03/09 – 14/09' },
  { key: 'qualify', label: 'Vòng loại', when: '21/09' },
  { key: 'final', label: 'Chung kết', when: '28/09' },
]

// ── Error code → human message ───────────────────────────────────────────────
function explain(code, schema) {
  if (!code) return ''
  const [kind, who, key] = code.split(':')
  const minTeamSize = schema?.team_size_min || 1
  const maxTeamSize = schema?.team_size_max || schema?.team_size || 5
  const labelOf = (k) =>
    schema?.person_fields?.find((f) => f.key === k)?.label || k
  const whoLabel = (w) =>
    w === 'captain' ? 'đội trưởng'
      : w === 'individual' ? 'bạn'
      : w?.startsWith('member_') ? `thành viên ${w.split('_')[1]}` : w
  switch (kind) {
    case 'missing': return `Vui lòng điền “${labelOf(key)}” cho ${whoLabel(who)}.`
    case 'invalid_date': return `Ngày sinh của ${whoLabel(who)} chưa hợp lệ.`
    case 'mssv_in_other_team': return `MSSV ${who} đã thuộc một đội khác.`
    case 'duplicate_mssv_in_team': return 'Có MSSV bị trùng giữa các thành viên trong đội.'
    case 'team_size_mismatch': return `Đội cần đủ ${maxTeamSize} thành viên.`
    case 'team_size_out_of_range': return `Số người tham gia phải từ ${minTeamSize} đến ${maxTeamSize}.`
    case 'team_name_requires_full_team':
      return `Chỉ đội đủ ${maxTeamSize} thành viên mới được đặt tên. Đội chưa đủ sẽ mang tên tạm và được BTC ghép với đội khác.`
    case 'team_too_large': return 'Số người tham gia không được vượt quá ' + maxTeamSize + '.'
    default: return 'Có lỗi xảy ra, vui lòng kiểm tra lại thông tin.'
  }
}

// Options may be plain strings or { label, value } objects.
const optValue = (o) => (typeof o === 'object' ? o.value : o)
const optLabel = (o) => (typeof o === 'object' ? o.label : o)

// ── One schema-driven field ──────────────────────────────────────────────────
function Field({ field, value, onChange }) {
  const id = `f-${field.key}`
  const base =
    'w-full rounded-lg border border-stone bg-paper/60 px-3 py-2.5 text-sm text-ink ' +
    'placeholder:text-ink/30 outline-none transition focus:border-trail/40 focus:bg-white ' +
    'focus:ring-4 focus:ring-trail/10'
  const values = (field.options || []).map(optValue)
  const isOther = field.type === 'select' && value && !values.includes(value)

  return (
    <label htmlFor={id} className="block">
      <span className="mb-1 flex items-baseline gap-1 text-[13px] font-medium text-ink/70">
        {field.label}
        {field.required && <span className="text-clay">*</span>}
      </span>
      {field.help && (
        <span className="mb-1.5 block text-[11px] leading-relaxed text-ink/40">{field.help}</span>
      )}

      {field.type === 'select' ? (
        <div className="space-y-1.5">
          <select
            id={id}
            className={base}
            value={values.includes(value) ? value : (isOther ? '__other__' : '')}
            onChange={(e) => onChange(e.target.value === '__other__' ? ' ' : e.target.value)}
          >
            <option value="" disabled>— Chọn —</option>
            {(field.options || []).map((opt) => (
              <option key={optValue(opt)} value={optValue(opt)}>{optLabel(opt)}</option>
            ))}
            {field.allow_other && <option value="__other__">Khác…</option>}
          </select>
          {field.allow_other && isOther && (
            <input
              className={base}
              placeholder="Nhập tên trường"
              value={value.trim()}
              onChange={(e) => onChange(e.target.value)}
            />
          )}
        </div>
      ) : field.type === 'file' ? (
        <input
          id={id}
          type="url"
          className={base}
          placeholder="Dán link ảnh minh chứng (Drive/Imgur…)"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          id={id}
          type={field.type === 'date' ? 'date' : field.type === 'email' ? 'email' : field.type === 'tel' ? 'tel' : 'text'}
          className={base}
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  )
}

// A field hidden by a satisfied conditional (e.g. CCCD when school = UIT).
function isHidden(field, data) {
  const c = field.conditional
  return Boolean(c && c.hide && (data[c.watch] || '') === c.equals)
}

// Build the state patch for one change, applying any conditional auto-fills.
function buildPatch(fields, key, value) {
  const patch = { [key]: value }
  for (const f of fields) {
    const c = f.conditional
    if (c && c.watch === key) {
      patch[f.key] = (value === c.equals && 'set' in c) ? c.set : ''
    }
  }
  return patch
}

// ── A person sub-form (captain / member / individual) ─────────────────────────
function PersonForm({ fields, data, onPatch }) {
  const visible = fields.filter((f) => !isHidden(f, data))
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {visible.map((f) => (
        <div key={f.key} className={f.key === 'full_name' || f.help ? 'sm:col-span-2' : ''}>
          <Field
            field={f}
            value={data[f.key] || ''}
            onChange={(v) => onPatch(buildPatch(fields, f.key, v))}
          />
        </div>
      ))}
    </div>
  )
}

// ── A collapsible member "stamp" in the team passport ─────────────────────────
function MemberStamp({ index, fields, data, onPatch, open, onToggle, done }) {
  return (
    <div className={`overflow-hidden rounded-xl border ${done ? 'border-trail/30' : 'border-stone'} bg-white`}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full font-mono text-xs font-semibold
          ${done ? 'bg-trail text-white' : 'bg-ink/[0.06] text-ink/50'}`}>
          {done ? <Icon name="checkPlain" className="h-4 w-4" /> : index}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-ink">
            {data.full_name?.trim() || `Thành viên ${index}`}
          </span>
          {data.mssv && <span className="block font-mono text-xs text-ink/45">{data.mssv}</span>}
        </span>
        <Icon name="chevronR" className={`h-4 w-4 text-ink/30 transition ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="border-t border-stone/70 p-4">
          <PersonForm fields={fields} data={data} onPatch={onPatch} />
        </div>
      )}
    </div>
  )
}

// ── The trail: a dotted path with a peg planted per completed member ──────────
function ProgressTrail({ total, done }) {
  return (
    <div className="flex items-center gap-2" aria-hidden="true">
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full transition ${i < done ? 'bg-gold' : 'bg-ink/15'}`} />
          {i < total - 1 && (
            <span className="block h-px w-6 border-t border-dashed border-ink/25" />
          )}
        </div>
      ))}
    </div>
  )
}

function personComplete(fields, data) {
  return fields.filter((f) => f.required).every((f) => (data[f.key] || '').toString().trim())
}

export default function RegisterPage() {
  const [schema, setSchema] = useState(null)
  const [loadError, setLoadError] = useState(false)
  const [mode, setMode] = useState(null) // 'individual' | 'team'
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(null) // success payload

  // individual + team state
  const [individual, setIndividual] = useState({})
  const [teamName, setTeamName] = useState('')
  const [paymentProof, setPaymentProof] = useState('')
  const [captain, setCaptain] = useState({})
  const [members, setMembers] = useState([]) // length = teamMemberCount - 1
  const [openMember, setOpenMember] = useState(0) // 0 = captain
  const [teamMemberCount, setTeamMemberCount] = useState(1)

  // Chống bot (bật từ Cài đặt hệ thống): Turnstile + honeypot/time-trap.
  const [antibot, setAntibot] = useState(null)
  const [turnstileToken, setTurnstileToken] = useState('')
  const [turnstileReset, setTurnstileReset] = useState(0)
  const { honeypot, setHoneypot, signals } = useFormSignals()
  const antibotEnabled = Boolean(antibot?.enabled)
  const antibotPayload = () => (antibotEnabled ? { turnstile_token: turnstileToken, ...signals() } : {})

  useEffect(() => {
    apiRequest('/public/site-config', { auth: false })
      .then((cfg) => { if (cfg?.antibot?.enabled) setAntibot(cfg.antibot) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    apiRequest('/register/schema', { auth: false })
      .then((s) => {
        setSchema(s)
      })
      .catch(() => setLoadError(true))
  }, [])

  // Sync members array when teamMemberCount changes
  useEffect(() => {
    if (!schema) return
    const capacity = teamMemberCount - 1 // non-captain slots needed
    setMembers((prev) => {
      if (prev.length === capacity) return prev
      // Preserve existing data; add empty slots at the end
      if (capacity > prev.length) {
        return [...prev, ...Array.from({ length: capacity - prev.length }, () => ({}))]
      }
      return prev.slice(0, capacity)
    })
  }, [teamMemberCount, schema])

  const personFields = useMemo(
    () => (schema?.person_fields || []).filter((f) => f.enabled !== false),
    [schema],
  )
  const minTeamSize = schema?.team_size_min || 1
  const maxTeamSize = schema?.team_size_max || schema?.team_size || 5
  const showTeamName = teamMemberCount === maxTeamSize

  useEffect(() => {
    if (!schema) return
    setTeamMemberCount((count) => Math.min(maxTeamSize, Math.max(minTeamSize, count)))
  }, [schema, minTeamSize, maxTeamSize])

  const teamDoneCount = useMemo(() => {
    if (!schema) return 0
    let n = personComplete(personFields, captain) ? 1 : 0
    members.forEach((m) => { if (personComplete(personFields, m)) n += 1 })
    return n
  }, [schema, personFields, captain, members])

  if (loadError) {
    return (
      <Shell>
        <div className="rounded-xl border border-clay/30 bg-clay/[0.05] p-6 text-center text-sm text-clay">
          Không tải được biểu mẫu. Vui lòng thử lại sau.
        </div>
      </Shell>
    )
  }
  if (!schema) {
    return <Shell><div className="py-20 text-center text-sm text-ink/40">Đang tải biểu mẫu…</div></Shell>
  }

  if (done) {
    return (
      <Shell>
        <div className="rounded-2xl border border-trail/30 bg-white p-8 text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-trail/12 text-trail">
            <Icon name="check" className="h-7 w-7" />
          </div>
          <h2 className="font-display text-2xl font-semibold text-ink">Đã ghi danh!</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink/55">
            {done.mode === 'team'
              ? <>Đội <b>{done.name}</b> (<span className="font-mono">{done.code}</span>) đã được gửi tới ban tổ chức để duyệt.</>
              : <>Đăng ký cá nhân thành công. BTC sẽ ghép đội và liên hệ qua email của bạn.</>}
          </p>
          <p className="mx-auto mt-4 max-w-md rounded-lg bg-paper/70 px-4 py-3 text-[13px] leading-relaxed text-ink/50">
            Bước tiếp theo: mỗi thành viên hãy <a href="/login" className="font-semibold text-trail underline">tạo tài khoản</a> bằng đúng MSSV đã đăng ký để theo dõi hành trình.
          </p>
          <a href="/" className="mt-6 inline-block rounded-lg border border-stone px-5 py-2.5 text-sm font-semibold text-ink/70 transition hover:bg-paper">
            Về trang chủ
          </a>
        </div>
      </Shell>
    )
  }

  async function submit() {
    setError('')
    if (antibotEnabled && !turnstileToken) {
      setError(ANTIBOT_ERROR_TEXT.turnstile_required)
      return
    }
    setSubmitting(true)
    try {
      if (mode === 'individual') {
        const payload = await apiRequest('/register/individual', { auth: false, method: 'POST', body: { ...individual, ...antibotPayload() } })
        setDone(payload)
      } else {
        const payload = await apiRequest('/register/team', {
          auth: false, method: 'POST',
          body: { team_name: showTeamName ? teamName : '', payment_proof: paymentProof, captain, members, ...antibotPayload() },
        })
        setDone(payload)
      }
    } catch (e) {
      // Mã chống bot có sẵn câu tiếng Việt riêng; lỗi khác theo explain() như cũ.
      if (ANTIBOT_ERROR_CODES.has(String(e.message))) {
        setError(ANTIBOT_ERROR_TEXT[e.message])
        setTurnstileReset((n) => n + 1)
      } else {
        setError(explain(e.message, schema))
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Shell>
      {/* Hero */}
      <header className="mb-10">
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-trail">VNU Tour 2025 · Ghi danh</p>
        <h1 className="mt-3 font-display text-4xl font-bold leading-[1.05] text-ink sm:text-5xl">
          Lên đường khám phá<br />khu đô thị ĐHQG-HCM
        </h1>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-ink/55">
          Hành trình thực tế dành cho tân sinh viên — rèn kỹ năng, kết bạn, thắt chặt tình đoàn kết.
          {schema.fee_note && <span className="ml-1 text-ink/70">{schema.fee_note}</span>}
        </p>

        {/* Timeline as trail waypoints */}
        <ol className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2">
          {STAGES.map((s, i) => (
            <li key={s.key} className="flex items-center gap-3">
              <span className="flex items-center gap-2 rounded-full border border-stone bg-white px-3 py-1.5">
                <span className="h-2 w-2 rounded-full bg-trail" />
                <span className="text-[13px] font-semibold text-ink">{s.label}</span>
                <span className="font-mono text-[11px] text-ink/45">{s.when}</span>
              </span>
              {i < STAGES.length - 1 && <span className="h-px w-6 border-t border-dashed border-ink/25" />}
            </li>
          ))}
        </ol>
      </header>

      {/* Mode picker — two passes */}
      {!mode ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <ModeCard
            title="Đăng ký cá nhân"
            desc="Bạn đăng ký một mình. BTC sẽ ghép đội ngẫu nhiên và liên hệ qua email."
            icon="userCircle"
            onClick={() => setMode('individual')}
          />
          <ModeCard
            title={`Đăng ký theo đội`}
            desc={`Đội từ ${minTeamSize} đến ${maxTeamSize} thành viên. Đội trưởng đứng ra ghi danh cho cả đội.`}
            icon="users"
            onClick={() => setMode('team')}
          />
        </div>
      ) : (
        <div>
          <button
            type="button"
            onClick={() => { setMode(null); setError('') }}
            className="mb-5 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink/50 transition hover:text-ink"
          >
            <Icon name="chevronR" className="h-3.5 w-3.5 rotate-180" /> Đổi hình thức
          </button>

          {mode === 'individual' ? (
            <section className="rounded-2xl border border-stone bg-white p-6">
              <h2 className="mb-4 font-display text-lg font-semibold text-ink">Thông tin của bạn</h2>
              <PersonForm fields={personFields} data={individual}
                onPatch={(p) => setIndividual((d) => ({ ...d, ...p }))} />
            </section>
          ) : (
            <section className="space-y-5">
              {/* Team identity */}
              <div className="rounded-2xl border border-stone bg-white p-6">
                <div className="grid gap-4 sm:grid-cols-2">
                  {schema.team_fields?.map((tf) => {
                    if (tf.key === 'team_name') {
                      return showTeamName ? (
                        <div key={tf.key} className={tf.help ? 'sm:col-span-2' : ''}>
                          <Field field={tf} value={teamName} onChange={(v) => setTeamName(v)} />
                        </div>
                      ) : null
                    }
                    return (
                      <div key={tf.key} className={tf.help ? 'sm:col-span-2' : ''}>
                        <Field field={tf} value={paymentProof} onChange={(v) => setPaymentProof(v)} />
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Passport: trail + member stamps */}
              <div className="rounded-2xl border border-stone bg-white p-6">
                <div className="mb-4 flex items-center justify-between gap-4">
                  <h2 className="font-display text-lg font-semibold text-ink">Hộ chiếu đội</h2>
                  <div className="flex shrink-0 items-center gap-3">
                    {/* Member count selector */}
                    <label className="text-[13px] text-ink/60">
                      Số người:{' '}
                      <select
                        value={teamMemberCount}
                        onChange={(e) => setTeamMemberCount(Number(e.target.value))}
                        className="rounded border border-stone bg-paper/60 px-2 py-1 text-xs outline-none"
                      >
                        {Array.from({ length: maxTeamSize - minTeamSize + 1 }).map((_, i) => {
                          const val = minTeamSize + i
                          return <option key={val} value={val}>{val}</option>
                        })}
                      </select>
                    </label>
                    <span className="font-mono text-xs text-ink/45">{teamDoneCount}/{teamMemberCount}</span>
                    <ProgressTrail total={teamMemberCount} done={teamDoneCount} />
                  </div>
                </div>

                <div className="space-y-2.5">
                  <MemberStamp
                    index={1} fields={personFields} data={captain}
                    onPatch={(p) => setCaptain((d) => ({ ...d, ...p }))}
                    open={openMember === 0} onToggle={() => setOpenMember(openMember === 0 ? -1 : 0)}
                    done={personComplete(personFields, captain)}
                  />
                  {members.map((m, i) => (
                    <MemberStamp
                      key={i} index={i + 2} fields={personFields} data={m}
                      onPatch={(p) => setMembers((arr) => arr.map((x, j) => j === i ? { ...x, ...p } : x))}
                      open={openMember === i + 1} onToggle={() => setOpenMember(openMember === i + 1 ? -1 : i + 1)}
                      done={personComplete(personFields, m)}
                    />
                  ))}
                </div>
                <p className="mt-3 text-[11px] leading-relaxed text-ink/40">
                  Thành viên chưa có tài khoản web vẫn đăng ký được — chỉ cần MSSV. Tài khoản tạo sau sẽ tự khớp theo MSSV.
                </p>
              </div>
            </section>
          )}

          {error && (
            <p className="mt-5 rounded-lg border border-clay/30 bg-clay/[0.05] px-4 py-3 text-sm text-clay">{error}</p>
          )}

          {antibotEnabled && (
            <div className="mt-5 flex justify-center">
              <TurnstileWidget
                siteKey={antibot.site_key}
                onToken={setTurnstileToken}
                onError={() => setError(ANTIBOT_ERROR_TEXT.turnstile_script_failed)}
                resetSignal={turnstileReset}
              />
            </div>
          )}

          <HoneypotField value={honeypot} onChange={setHoneypot} />

          <div className="mt-6 flex items-center justify-end gap-3">
            <button
              type="button"
              disabled={submitting}
              onClick={submit}
              className="inline-flex items-center gap-2 rounded-lg bg-trail px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-trail/90 disabled:opacity-60"
            >
              {submitting ? 'Đang gửi…' : (
                <>{mode === 'team' ? 'Ghi danh đội' : 'Ghi danh'} <Icon name="flag" className="h-4 w-4" /></>
              )}
            </button>
          </div>
        </div>
      )}
    </Shell>
  )
}

function ModeCard({ title, desc, icon, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col items-start gap-3 rounded-2xl border border-stone bg-white p-6 text-left transition hover:border-trail/40 hover:shadow-[0_4px_20px_rgba(31,122,107,0.08)] focus:outline-none focus:ring-4 focus:ring-trail/10"
    >
      <span className="grid h-11 w-11 place-items-center rounded-xl bg-trail/12 text-trail transition group-hover:bg-trail group-hover:text-white">
        <Icon name={icon} className="h-6 w-6" />
      </span>
      <span className="font-display text-lg font-semibold text-ink">{title}</span>
      <span className="text-sm leading-relaxed text-ink/55">{desc}</span>
      <span className="mt-1 inline-flex items-center gap-1 text-[13px] font-semibold text-trail">
        Bắt đầu <Icon name="chevronR" className="h-3.5 w-3.5" />
      </span>
    </button>
  )
}

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-paper">
      <div className="mx-auto max-w-3xl px-5 py-10 sm:py-14">
        <a href="/" className="mb-8 inline-flex items-center gap-1.5 font-mono text-xs text-ink/45 transition hover:text-ink">
          <Icon name="chevronR" className="h-3 w-3 rotate-180" /> VNU Tour
        </a>
        {children}
      </div>
    </div>
  )
}
