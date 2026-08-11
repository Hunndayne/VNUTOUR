import { Badge, Icon } from './ui.jsx'
import { useDiscordConnect } from './discordConnect.js'

// Discord's own blurple for the connect button; the rest borrows the
// participant palette so the card sits with the others.
const CARD = 'rounded-xl border border-[#DCD8CC] bg-white shadow-[0_1px_3px_rgba(32,49,43,0.05)]'
const DISCORD_BUTTON = 'inline-flex items-center justify-center gap-2 rounded-lg bg-[#5865F2] px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-95 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45'
const GHOST_BUTTON = 'inline-flex items-center justify-center gap-2 rounded-lg border border-[#DCD8CC] bg-white px-3.5 py-2 text-sm font-semibold text-[#20312B]/65 transition hover:bg-[#F3F4F1] hover:text-[#20312B] disabled:cursor-not-allowed disabled:opacity-45'

export function DiscordMark({ className = 'h-5 w-5' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.317 4.369a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.211.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.127c-.598.35-1.22.645-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.056c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028ZM8.02 15.331c-1.183 0-2.157-1.086-2.157-2.419 0-1.333.955-2.42 2.157-2.42 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.419-2.157 2.419Zm7.975 0c-1.183 0-2.157-1.086-2.157-2.419 0-1.333.955-2.42 2.157-2.42 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.419-2.157 2.419Z" />
    </svg>
  )
}

// A step row for the "join then connect" checklist. `state` is done | active | idle.
function Step({ index, title, children, state }) {
  const done = state === 'done'
  const active = state === 'active'
  return (
    <div className="flex gap-3">
      <span
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border font-mono text-xs font-semibold"
        style={
          done
            ? { backgroundColor: '#1F7A6B', borderColor: '#1F7A6B', color: 'white' }
            : active
              ? { backgroundColor: 'rgba(88,101,242,0.12)', borderColor: '#5865F2', color: '#4048c4' }
              : { backgroundColor: '#F3F4F1', borderColor: '#DCD8CC', color: 'rgba(32,49,43,0.35)' }
        }
      >
        {done ? <Icon name="checkPlain" className="h-4 w-4" /> : index}
      </span>
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-semibold ${done || active ? 'text-ink' : 'text-ink/45'}`}>{title}</p>
        <div className="mt-1">{children}</div>
      </div>
    </div>
  )
}

export default function DiscordConnectCard() {
  const { status, loading, busy, error, notice, connect, unlink, reconnect } = useDiscordConnect()

  if (loading) {
    return (
      <section className={`${CARD} px-5 py-6 text-sm text-ink/40`}>Đang tải trạng thái Discord...</section>
    )
  }

  const linked = Boolean(status?.linked)
  const inServer = status?.in_server // true | false | null
  const configured = Boolean(status?.oauth?.configured)
  const inviteUrl = status?.invite_url
  const handle = status?.discord_username
  // "Done" only when the bot actually sees them in the server. When it cannot
  // tell (null) we deliberately keep showing the full flow.
  const complete = linked && inServer === true

  return (
    <section className={`${CARD} p-5`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#5865F2]/12 text-[#5865F2]">
            <DiscordMark />
          </span>
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-ink/35">Discord</p>
            <h2 className="mt-0.5 font-display text-lg font-bold text-ink">Kết nối tài khoản Discord</h2>
          </div>
        </div>
        {complete
          ? <Badge label="Đã kết nối" cls="bg-[#1F7A6B]/12 text-[#1F7A6B]" />
          : linked
            ? <Badge label="Chưa hoàn tất" cls="bg-[#E0A23A]/15 text-[#9A6B12]" />
            : <Badge label="Chưa kết nối" cls="bg-[#20312B]/[0.07] text-[#20312B]/50" />}
      </div>

      {notice && (
        <div className="mt-4 rounded-lg border border-[#1F7A6B]/25 bg-[#1F7A6B]/[0.06] px-4 py-3 text-sm text-[#1F7A6B]">
          {notice}
        </div>
      )}
      {error && (
        <div className="mt-4 rounded-lg border border-[#D6492B]/25 bg-[#D6492B]/[0.06] px-4 py-3 text-sm text-[#D6492B]">
          {error}
        </div>
      )}
      {!configured && (
        <div className="mt-4 rounded-lg border border-[#DCD8CC] bg-[#F3F4F1] px-4 py-3 text-sm text-ink/55">
          BTC chưa bật kết nối Discord qua web. Trong lúc chờ, bạn vẫn có thể dùng lệnh
          <span className="mx-1 rounded bg-white px-1.5 py-0.5 font-mono text-xs">/assign &lt;mssv&gt;</span>
          trong Discord.
        </div>
      )}

      {complete ? (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#1F7A6B]/25 bg-[#1F7A6B]/[0.05] px-4 py-3">
            <div className="flex items-center gap-3">
              <Icon name="checkPlain" className="h-5 w-5 text-[#1F7A6B]" />
              <div>
                <p className="text-sm font-semibold text-ink">Đã vào máy chủ và liên kết xong</p>
                {handle && <p className="mt-0.5 font-mono text-xs text-ink/50">@{handle}</p>}
              </div>
            </div>
            <button type="button" onClick={unlink} disabled={busy === 'unlink'} className={GHOST_BUTTON}>
              {busy === 'unlink' ? 'Đang huỷ...' : 'Huỷ liên kết'}
            </button>
          </div>
          <p className="text-xs leading-5 text-ink/45">
            Role và kênh riêng của đội sẽ được bot cấp tự động. Nếu chưa thấy, chờ vài phút rồi tải lại.
          </p>
        </div>
      ) : (
        // Not connected, OR connected but not confirmed in the server: in both
        // cases we show the whole checklist so nobody stalls half-done.
        <div className="mt-5 space-y-4">
          {linked && (
            <div className="rounded-lg border border-[#E0A23A]/30 bg-[#E0A23A]/[0.07] px-4 py-3">
              <p className="text-sm font-semibold text-[#9A6B12]">
                {inServer === false
                  ? 'Đã kết nối nhưng chưa thấy bạn trong máy chủ Discord.'
                  : 'Đã kết nối, nhưng chưa xác nhận được bạn trong máy chủ.'}
              </p>
              <p className="mt-1 text-sm leading-6 text-ink/60">
                {handle
                  ? <>Kiểm tra đúng tài khoản của bạn chưa: <span className="font-mono font-semibold text-ink">@{handle}</span>. </>
                  : null}
                Hãy chắc chắn bạn đã vào máy chủ bằng đúng tài khoản này. Nếu nhầm tài khoản, hãy kết nối lại.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => reconnect()} disabled={Boolean(busy)} className={GHOST_BUTTON}>
                  <DiscordMark className="h-4 w-4" />
                  {busy === 'reconnect' ? 'Đang mở...' : 'Kết nối lại bằng tài khoản khác'}
                </button>
                <button type="button" onClick={unlink} disabled={Boolean(busy)} className={GHOST_BUTTON}>
                  {busy === 'unlink' ? 'Đang huỷ...' : 'Huỷ liên kết'}
                </button>
              </div>
            </div>
          )}

          <p className="text-sm leading-6 text-ink/55">
            Cần làm đủ hai bước sau thì bot mới cấp được role và kênh riêng của đội:
          </p>

          <Step index={1} title="Vào máy chủ Discord của VNUTour" state={linked && inServer === true ? 'done' : 'active'}>
            <p className="text-sm leading-6 text-ink/55">
              Tham gia máy chủ bằng chính tài khoản Discord bạn sẽ dùng để kết nối.
            </p>
            {inviteUrl ? (
              <a href={inviteUrl} target="_blank" rel="noreferrer" className={`mt-2 ${GHOST_BUTTON}`}>
                <Icon name="chevronR" className="h-4 w-4" />
                Mở link vào máy chủ
              </a>
            ) : (
              <p className="mt-1 text-xs text-ink/40">BTC chưa cấu hình link mời — hãy dùng link đã được thông báo.</p>
            )}
          </Step>

          <Step index={2} title="Kết nối tài khoản với hồ sơ web" state={linked ? 'done' : 'active'}>
            <p className="text-sm leading-6 text-ink/55">
              Bấm để đăng nhập Discord và gắn tài khoản vào MSSV của bạn — không cần gõ lệnh.
            </p>
            {!linked && (
              <button
                type="button"
                onClick={() => connect()}
                disabled={!configured || Boolean(busy)}
                className={`mt-2 ${DISCORD_BUTTON}`}
              >
                <DiscordMark className="h-4 w-4" />
                Kết nối Discord
              </button>
            )}
          </Step>
        </div>
      )}
    </section>
  )
}
