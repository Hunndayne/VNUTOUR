import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiRequest, formatDateTime, logoutAndRedirect } from './api.js'
import { Badge, CARD, Icon } from './ui.jsx'

function explainApiError(error) {
  const code = error?.data?.error || error?.message
  const map = {
    collab_not_found: 'Không tìm thấy cộng tác viên phù hợp.',
    station_not_found: 'Không tìm thấy trạm để phân công.',
    missing_fields: 'Cần chọn cộng tác viên và trạm.',
    forbidden: 'Bạn không có quyền phân công cộng tác viên.',
  }
  return map[code] || 'Không thể đồng bộ phân công cộng tác viên.'
}

function AssignmentRow({ assignment, onDelete, busy }) {
  return (
    <div className="grid gap-3 rounded-xl border border-stone bg-paper px-4 py-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-semibold text-ink">
            {assignment.collab.full_name || assignment.collab.username}
          </p>
          <Badge
            label={assignment.is_current ? 'Đang hiệu lực' : assignment.active ? 'Đã lên lịch' : 'Tạm tắt'}
            cls={assignment.is_current ? 'bg-trail/12 text-trail' : 'bg-ink/[0.07] text-ink/55'}
          />
        </div>
        <p className="mt-1 font-mono text-xs text-ink/40">
          {assignment.collab.username} · {assignment.collab.email}
        </p>
      </div>

      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">
          {assignment.station.name}
        </p>
        <p className="mt-1 text-xs text-ink/45">
          {assignment.shift_start || assignment.shift_end
            ? `${assignment.shift_start ? formatDateTime(assignment.shift_start) : 'Mở đầu ca'} → ${assignment.shift_end ? formatDateTime(assignment.shift_end) : 'Đến khi tắt'}`
            : 'Không giới hạn khung giờ'}
        </p>
        {assignment.note && (
          <p className="mt-1 text-xs text-ink/45">{assignment.note}</p>
        )}
      </div>

      <div className="flex items-start justify-end">
        <button
          type="button"
          onClick={() => onDelete(assignment.id)}
          disabled={busy}
          className="rounded-lg border border-stone bg-white px-3 py-2 text-sm font-semibold text-ink/60 transition hover:bg-paper hover:text-clay disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? 'Đang xóa...' : 'Gỡ'}
        </button>
      </div>
    </div>
  )
}

export default function StationAssignmentsPanel({ phase, selectedEvent, stations }) {
  const [collabs, setCollabs] = useState([])
  const [assignments, setAssignments] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [apiError, setApiError] = useState('')
  const [form, setForm] = useState({
    collabUsername: '',
    stationId: '',
    shiftStart: '',
    shiftEnd: '',
    note: '',
  })

  const stationOptions = useMemo(
    () => stations.filter(station => station.active),
    [stations],
  )

  const loadPanel = useCallback(async () => {
    if (!selectedEvent) {
      setAssignments([])
      setLoading(false)
      return
    }

    const params = new URLSearchParams({
      role: 'collab',
      active: '1',
      limit: '200',
    })

    const assignmentParams = new URLSearchParams({
      phase_key: phase,
      event_id: String(selectedEvent.id),
    })

    const [accountsPayload, assignmentsPayload] = await Promise.all([
      apiRequest(`/admin/accounts?${params.toString()}`),
      apiRequest(`/admin/station-assignments?${assignmentParams.toString()}`),
    ])

    setCollabs(accountsPayload.items || [])
    setAssignments(assignmentsPayload.items || [])
  }, [phase, selectedEvent])

  useEffect(() => {
    let cancelled = false

    const bootstrap = async () => {
      try {
        setLoading(true)
        await loadPanel()
      } catch (error) {
        if (cancelled) return
        if (error?.status === 401) {
          logoutAndRedirect('/')
          return
        }
        setApiError(explainApiError(error))
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    bootstrap()
    return () => {
      cancelled = true
    }
  }, [loadPanel])

  useEffect(() => {
    setForm((current) => {
      const nextStationId = stationOptions.some(station => String(station.id) === current.stationId)
        ? current.stationId
        : stationOptions[0]
          ? String(stationOptions[0].id)
          : ''
      const nextCollabUsername = collabs.some(collab => collab.username === current.collabUsername)
        ? current.collabUsername
        : collabs[0]?.username || ''

      if (nextStationId === current.stationId && nextCollabUsername === current.collabUsername) {
        return current
      }

      return {
        ...current,
        stationId: nextStationId,
        collabUsername: nextCollabUsername,
      }
    })
  }, [collabs, stationOptions])

  const withBusy = async (busyKey, task) => {
    setBusy(busyKey)
    setApiError('')
    try {
      await task()
    } catch (error) {
      if (error?.status === 401) {
        logoutAndRedirect('/')
        return
      }
      setApiError(explainApiError(error))
    } finally {
      setBusy('')
    }
  }

  const handleCreate = () => withBusy('create', async () => {
    await apiRequest('/admin/station-assignments', {
      method: 'POST',
      body: {
        collab_username: form.collabUsername,
        station_id: Number(form.stationId),
        shift_start: form.shiftStart || null,
        shift_end: form.shiftEnd || null,
        note: form.note.trim(),
      },
    })
    await loadPanel()
    setForm((current) => ({
      ...current,
      shiftStart: '',
      shiftEnd: '',
      note: '',
    }))
  })

  const handleDelete = (assignmentId) => withBusy(`delete:${assignmentId}`, async () => {
    await apiRequest(`/admin/station-assignments/${assignmentId}`, { method: 'DELETE' })
    await loadPanel()
  })

  if (!selectedEvent) {
    return (
      <div className={`${CARD} rounded-xl border border-dashed border-stone bg-paper px-4 py-4 text-sm text-ink/45`}>
        Chọn một event có trạm để bắt đầu phân công cộng tác viên.
      </div>
    )
  }

  return (
    <div className={`${CARD} overflow-hidden`}>
      <div className="border-b border-stone px-5 py-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-3xl">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/40">
              Phân công coop theo trạm
            </p>
            <h3 className="mt-2 font-display text-xl font-semibold text-ink">
              Gán cộng tác viên vào đúng trạm và ca trực
            </h3>
            <p className="mt-2 text-sm leading-6 text-ink/60">
              Coop đăng nhập vào màn `/coop` sẽ tự thấy trạm được giao. Nếu không đặt khung giờ, phân công có hiệu lực cho toàn bộ event đang chọn.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge label={selectedEvent.name} cls="bg-[#3E7CA8]/12 text-[#3E7CA8]" />
            <span className="rounded-full bg-paper px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-ink/45">
              {assignments.length} phân công
            </span>
          </div>
        </div>
      </div>

      <div className="space-y-4 px-5 py-4">
        {apiError && (
          <div className="rounded-xl border border-clay/20 bg-clay/[0.05] px-4 py-3 text-sm text-clay">
            {apiError}
          </div>
        )}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="block text-sm font-medium text-ink/70">Cộng tác viên</span>
              <select
                value={form.collabUsername}
                onChange={(event) => setForm(current => ({ ...current, collabUsername: event.target.value }))}
                className="w-full rounded-lg border border-stone bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
              >
                {collabs.length > 0 ? collabs.map((collab) => (
                  <option key={collab.username} value={collab.username}>
                    {collab.full_name || collab.username}
                  </option>
                )) : (
                  <option value="">Chưa có tài khoản collab</option>
                )}
              </select>
            </label>

            <label className="space-y-1.5">
              <span className="block text-sm font-medium text-ink/70">Trạm</span>
              <select
                value={form.stationId}
                onChange={(event) => setForm(current => ({ ...current, stationId: event.target.value }))}
                className="w-full rounded-lg border border-stone bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
              >
                {stationOptions.length > 0 ? stationOptions.map((station) => (
                  <option key={station.id} value={station.id}>
                    {station.name}
                  </option>
                )) : (
                  <option value="">Chưa có trạm hoạt động</option>
                )}
              </select>
            </label>

            <label className="space-y-1.5">
              <span className="block text-sm font-medium text-ink/70">Bắt đầu ca</span>
              <input
                type="datetime-local"
                value={form.shiftStart}
                onChange={(event) => setForm(current => ({ ...current, shiftStart: event.target.value }))}
                className="w-full rounded-lg border border-stone bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
              />
            </label>

            <label className="space-y-1.5">
              <span className="block text-sm font-medium text-ink/70">Kết thúc ca</span>
              <input
                type="datetime-local"
                value={form.shiftEnd}
                onChange={(event) => setForm(current => ({ ...current, shiftEnd: event.target.value }))}
                className="w-full rounded-lg border border-stone bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
              />
            </label>
          </div>

          <div className="space-y-3">
            <label className="space-y-1.5">
              <span className="block text-sm font-medium text-ink/70">Ghi chú ca trực</span>
              <textarea
                value={form.note}
                onChange={(event) => setForm(current => ({ ...current, note: event.target.value }))}
                rows={5}
                placeholder="Ví dụ: giữ cửa vào, ưu tiên scan vào trạm, bàn giao máy quét lúc 10:00."
                className="w-full rounded-lg border border-stone bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
              />
            </label>
            <button
              type="button"
              onClick={handleCreate}
              disabled={!form.collabUsername || !form.stationId || busy === 'create'}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-[0.9] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Icon name="plus" className="h-4 w-4" />
              {busy === 'create' ? 'Đang lưu phân công...' : 'Tạo phân công'}
            </button>
          </div>
        </div>

        <div className="space-y-3">
          {loading ? (
            <div className="rounded-xl border border-dashed border-stone bg-paper px-4 py-8 text-center text-sm text-ink/40">
              Đang tải phân công cộng tác viên...
            </div>
          ) : assignments.length > 0 ? assignments.map((assignment) => (
            <AssignmentRow
              key={assignment.id}
              assignment={assignment}
              onDelete={handleDelete}
              busy={busy === `delete:${assignment.id}`}
            />
          )) : (
            <div className="rounded-xl border border-dashed border-stone bg-paper px-4 py-8 text-center text-sm text-ink/40">
              Event này chưa có phân công coop nào.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
