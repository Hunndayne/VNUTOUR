import { useState, useRef, useEffect, useCallback } from 'react'
import QrScanner from 'qr-scanner'

function CheckinResultModal({ data, onClose }) {
  if (!data) return null

  const { team, memberList, timestamp } = data

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 px-4 backdrop-blur-sm">
      <div className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close check-in modal"
          className="absolute right-4 top-4 text-2xl font-semibold text-slate-400 transition-colors hover:text-slate-600"
        >
          &times;
        </button>
        <div className="space-y-5 px-6 py-8">
          <h2 className="text-center text-xl font-semibold text-slate-800">Check-in success</h2>
          <div className="space-y-3 text-sm text-slate-600">
            <div className="flex justify-between gap-4 text-base">
              <span className="font-semibold text-slate-500">Team:</span>
              <span className="text-right text-slate-800">{team?.name || 'N/A'}</span>
            </div>
            <div className="flex justify-between gap-4 text-base">
              <span className="font-semibold text-slate-500">Team ID:</span>
              <span className="text-right text-slate-800">{team?.id || 'N/A'}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="font-semibold text-slate-500">Time:</span>
              <span className="text-right text-slate-800">{timestamp || 'Unknown'}</span>
            </div>
            <div>
              <span className="font-semibold text-slate-500">Members:</span>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-700">
                {memberList?.length ? (
                  memberList.map((member, idx) => (
                    <li key={`${member}-${idx}`}>{member}</li>
                  ))
                ) : (
                  <li>No members found</li>
                )}
              </ul>
            </div>
          </div>
        </div>
        <div className="flex justify-center border-t border-slate-100 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-indigo-500 px-6 py-2 text-sm font-semibold text-white shadow-md transition hover:bg-indigo-600"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://10.147.17.251:8080/api'

function App() {
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    email: '',
    secret: ''
  })
  const [errors, setErrors] = useState({})
  const [isLoading, setIsLoading] = useState(false)
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [scannedTeams, setScannedTeams] = useState([])
  const [checkinStats, setCheckinStats] = useState(null)
  const [deletingTeamId, setDeletingTeamId] = useState(null)
  const [user, setUser] = useState(null)
  const [authToken, setAuthToken] = useState(null)
  const [apiError, setApiError] = useState('')
  const [isRegisterMode, setIsRegisterMode] = useState(false)
  const [checkinModalData, setCheckinModalData] = useState(null)
  const videoRef = useRef(null)
  const qrScannerRef = useRef(null)
  const isFetchingRef = useRef(false)

  const handleInputChange = (e) => {
    const { name, value } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: value
    }))

    if (errors[name]) {
      setErrors(prev => ({
        ...prev,
        [name]: ''
      }))
    }
  }

  const validateForm = () => {
    const newErrors = {}

    if (!formData.username.trim()) {
      newErrors.username = 'Vui lòng nhập tên đăng nhập'
    }

    if (!formData.password.trim()) {
      newErrors.password = 'Vui lòng nhập mật khẩu'
    } else if (formData.password.length < 6) {
      newErrors.password = 'Mật khẩu phải có ít nhất 6 ký tự'
    }

    if (isRegisterMode) {
      if (!formData.email.trim()) {
        newErrors.email = 'Vui lòng nhập email'
      } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
        newErrors.email = 'Email không hợp lệ'
      }

      if (!formData.secret.trim()) {
        newErrors.secret = 'Vui lòng nhập mã secret'
      }
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (validateForm()) {
      setIsLoading(true)
      setApiError('')

      try {
        const endpoint = isRegisterMode ? '/auth/register' : '/auth/login'
        const requestData = isRegisterMode
          ? {
              username: formData.username,
              password: formData.password,
              email: formData.email,
              secret: formData.secret
            }
          : {
              username: formData.username,
              password: formData.password
            }

        const response = await fetch(`${API_BASE_URL}${endpoint}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestData)
        })

        const data = await response.json()

        if (response.ok) {
          setAuthToken(data.token)
          setUser(data.user)
          setIsLoggedIn(true)
          setFormData({ username: '', password: '', email: '', secret: '' })
          setErrors({})
          setIsRegisterMode(false)

          localStorage.setItem('authToken', data.token)
          localStorage.setItem('user', JSON.stringify(data.user))
        } else {
          if (data.error === 'invalid_credentials') {
            setApiError('Tên đăng nhập hoặc mật khẩu không đúng')
          } else if (data.error === 'conflict') {
            setApiError('Tên đăng nhập hoặc email đã tồn tại')
          } else if (data.error === 'forbidden') {
            setApiError('Mã secret không đúng hoặc không được phép đăng ký')
          } else {
            setApiError(`Lỗi: ${data.error || 'Có lỗi xảy ra'}`)
          }
        }
      } catch (error) {
        if (error.name === 'TypeError' && error.message.includes('fetch')) {
          setApiError('Không thể kết nối tới server. Kiểm tra lại địa chỉ API.')
        } else {
          setApiError(`Lỗi: ${error.message}`)
        }
      } finally {
        setIsLoading(false)
      }
    }
  }

  useEffect(() => {
    const savedToken = localStorage.getItem('authToken')
    const savedUser = localStorage.getItem('user')

    if (savedToken && savedUser) {
      setAuthToken(savedToken)
      setUser(JSON.parse(savedUser))
      setIsLoggedIn(true)
    }
  }, [])

  const fetchCheckinsData = useCallback(async ({ force = false } = {}) => {
    if (!isLoggedIn || !authToken) {
      return
    }

    if (isFetchingRef.current) {
      if (!force) {
        return
      }
      await new Promise(resolve => {
        const waitInterval = setInterval(() => {
          if (!isFetchingRef.current) {
            clearInterval(waitInterval)
            resolve()
          }
        }, 75)
      })
    }

    isFetchingRef.current = true

    try {
      const [listResponse, statsResponse] = await Promise.all([
        fetch(`${API_BASE_URL}/checkins`, {
          headers: {
            'Authorization': `Bearer ${authToken}`,
          }
        }),
        fetch(`${API_BASE_URL}/checkins/stats`, {
          headers: {
            'Authorization': `Bearer ${authToken}`,
          }
        })
      ])

      if (listResponse.ok) {
        const payload = await listResponse.json()
        const items = Array.isArray(payload)
          ? payload
          : payload.items || payload.data || payload.checkins || []

        const formattedTeams = items.map(item => {
          const team = item.team || item
          const membersList = item.members || item.members_detail || item.members_mssv || team?.members || []
          const normalizeMembers = (list) => {
            if (!Array.isArray(list)) {
              return ''
            }
            return list.map(member => {
              if (member && typeof member === 'object') {
                return member.full_name || member.name || member.mssv || JSON.stringify(member)
              }
              return member
            }).join(', ')
          }
          const rawTimestamp = item.checked_in_display || item.checked_in_at || item.created_at || ''
          const formattedTimestamp = (() => {
            if (!rawTimestamp) return ''
            if (typeof rawTimestamp === 'string' && rawTimestamp.includes('GMT')) {
              return rawTimestamp
            }
            if (typeof rawTimestamp === 'string') {
              const date = new Date(rawTimestamp)
              if (!Number.isNaN(date.getTime())) {
                return date.toLocaleString()
              }
            }
            return String(rawTimestamp)
          })()
          return {
            id: team?.team_id || team?.id || item.team_id || item.id,
            name: team?.team_name || team?.name || item.team_name || item.name,
            members: normalizeMembers(membersList),
            scannedAt: formattedTimestamp,
          }
        })

        setScannedTeams(formattedTeams)
      } else {
        console.error('Failed to fetch checkins:', listResponse.status)
      }

      if (statsResponse.ok) {
        const statsPayload = await statsResponse.json()
        if (statsPayload && typeof statsPayload === 'object') {
          setCheckinStats(statsPayload)
        }
      } else {
        console.error('Failed to fetch checkin stats:', statsResponse.status)
      }
    } catch (error) {
      console.error('Failed to load checkins:', error)
    } finally {
      isFetchingRef.current = false
    }
  }, [authToken, isLoggedIn])

  useEffect(() => {
    if (!isLoggedIn || !authToken) {
      return undefined
    }

    fetchCheckinsData({ force: true })
    const intervalId = setInterval(() => fetchCheckinsData(), 1000)

    return () => {
      clearInterval(intervalId)
    }
  }, [isLoggedIn, authToken, fetchCheckinsData])

  useEffect(() => {
    if (isLoggedIn && videoRef.current && authToken) {
      if (qrScannerRef.current) {
        qrScannerRef.current.stop()
        qrScannerRef.current.destroy()
      }

      qrScannerRef.current = new QrScanner(
        videoRef.current,
        async (result) => {
          try {
            if (qrScannerRef.current) {
              qrScannerRef.current.stop()
            }

            const response = await fetch(`${API_BASE_URL}/checkin`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
              },
              body: JSON.stringify({
                code: result.data,
                scanner: user?.username || 'unknown'
              })
            })

            const data = await response.json()

            if (response.ok) {
              const membersArray = Array.isArray(data.members)
                ? data.members.map(member => member?.full_name || member?.name || member)
                : []

              const fallbackName = data.team?.team_id ? `Team ${data.team?.team_id}` : 'Unknown team'

              const teamData = {
                id: data.team?.team_id || data.team?._id,
                name: data.team?.team_name || fallbackName,
                members: membersArray.join(', '),
                scannedAt: data.checked_in_display || data.checked_in_at || new Date().toLocaleString()
              }

              setScannedTeams(prev => {
                const exists = prev.some(team => team.id === teamData.id)
                if (!exists) {
                  return [...prev, teamData]
                }
                return prev
              })

              setCheckinModalData({
                team: teamData,
                memberList: membersArray,
                timestamp: teamData.scannedAt,
              })
            } else {
              if (data.error === 'already_checked_in') {
                alert(`⚠️ Đội này đã được điểm danh lúc ${data.checked_in_display}`)
              } else if (data.error === 'not_found') {
                alert('⚠️ Không tìm thấy đội với mã QR này')
              } else {
                alert(`⚠️ Lỗi: ${data.error}`)
              }
            }
          } catch (error) {
            console.error('Checkin error:', error)
            alert('⚠️ Có lỗi xảy ra khi điểm danh. Vui lòng thử lại.')
          } finally {
            setTimeout(() => {
              if (qrScannerRef.current && isLoggedIn) {
                qrScannerRef.current.start().catch(err => {
                  console.error('Lỗi khởi động lại camera:', err)
                })
              }
            }, 1000)
          }
        },
        {
          highlightScanRegion: true,
          highlightCodeOutline: true,
        }
      )

      qrScannerRef.current.start().catch(err => {
        console.error('Lỗi khởi động camera:', err)
        alert('Không thể truy cập camera. Vui lòng cho phép quyền truy cập camera.')
      })
    }

    return () => {
      if (qrScannerRef.current) {
        qrScannerRef.current.stop()
        qrScannerRef.current.destroy()
        qrScannerRef.current = null
      }
    }
  }, [isLoggedIn, authToken, user])

  const handleLogout = () => {
    setIsLoggedIn(false)
    setScannedTeams([])
    setUser(null)
    setAuthToken(null)
    setApiError('')
    setIsRegisterMode(false)
    setFormData({ username: '', password: '', email: '', secret: '' })
    setErrors({})
    setCheckinModalData(null)
    setCheckinStats(null)
    setDeletingTeamId(null)
    isFetchingRef.current = false

    localStorage.removeItem('authToken')
    localStorage.removeItem('user')

    if (qrScannerRef.current) {
      qrScannerRef.current.stop()
      qrScannerRef.current.destroy()
      qrScannerRef.current = null
    }
  }


  const handleResetCheckin = useCallback(async (team) => {
    if (!authToken) {
      return
    }

    const teamKey = team.id || team.name

    if (!teamKey) {
      alert('Không xác định được đội để xóa trạng thái check-in.')
      return
    }

    const confirmed = window.confirm(`Bạn có chắc muốn xóa trạng thái check-in của đội ${team.name || teamKey}?`)
    if (!confirmed) {
      return
    }

    setDeletingTeamId(teamKey)

    try {
      const response = await fetch(`${API_BASE_URL}/checkin/${encodeURIComponent(teamKey)}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      })

      let payload = null
      try {
        payload = await response.json()
      } catch (error) {
        payload = null
      }

      if (response.ok) {
        alert('Đã xóa trạng thái check-in của đội.')
        setScannedTeams(prev => prev.filter(item => (item.id || item.name) !== (team.id || team.name)))
        setTimeout(() => {
          fetchCheckinsData({ force: true })
        }, 150)
      } else if (response.status === 403) {
        alert('Bạn không có quyền xóa check-in (403).')
      } else if (response.status === 404) {
        alert('Không tìm thấy đội để xóa check-in.')
      } else {
        alert(`Xóa check-in thất bại: ${payload?.error || response.status}`)
      }
    } catch (error) {
      alert(`Có lỗi xảy ra khi xóa check-in: ${error.message}`)
    } finally {
      setDeletingTeamId(null)
    }
  }, [authToken, fetchCheckinsData])

  const renderTeamList = () => {
    if (scannedTeams.length === 0) {
      return (
        <p className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-slate-500">
          Chưa có đội nào được quét
        </p>
      )
    }

    return (
      <div className="space-y-4">
        {scannedTeams.map((team, index) => {
          const teamKey = team.id || team.name || index
          const isDeleting = deletingTeamId === (team.id || team.name)

          return (
            <div
              key={teamKey}
              className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 shadow-sm transition hover:shadow-md"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <h3 className="flex items-center gap-2 text-lg font-semibold text-slate-800">
                    <span role="img" aria-hidden="true">🏅</span>
                    {team.name || 'Đội không tên'}
                  </h3>
                  <p className="text-sm text-slate-600"><strong>ID:</strong> {team.id || 'N/A'}</p>
                  <p className="text-sm text-slate-600"><strong>Thành viên:</strong> {team.members || 'Chưa có thông tin'}</p>
                  <p className="text-sm text-slate-600"><strong>Thời gian quét:</strong> {team.scannedAt}</p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className="inline-flex items-center rounded-full bg-emerald-100 px-3 py-1 text-sm font-semibold text-emerald-700">
                    ✅ Đã quét
                  </span>
                  {user?.role === 'admin' && (
                    <button
                      type="button"
                      onClick={() => handleResetCheckin(team)}
                      disabled={isDeleting}
                      className="inline-flex items-center gap-2 rounded-full bg-rose-100 px-3 py-1 text-sm font-semibold text-rose-600 transition hover:bg-rose-200 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isDeleting ? 'Đang xóa...' : 'Xóa check-in'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  if (isLoggedIn) {
    const statsTeams = checkinStats?.checked_in_teams ?? scannedTeams.length
    const statsParticipants = checkinStats?.checked_in_participants ?? 0

    return (
      <div className="min-h-screen w-full px-4 py-8 sm:px-6 lg:px-10 flex flex-col items-center gap-6">
        {checkinModalData && (
          <CheckinResultModal data={checkinModalData} onClose={() => setCheckinModalData(null)} />
        )}
        <header className="w-full max-w-6xl rounded-3xl bg-white/95 p-6 shadow-xl backdrop-blur">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-1 items-center gap-4">
              <img
                src="https://storage.hiseku.net/BieuTrung.png"
                alt="VNUTour 2025 logo"
                className="h-16 w-auto rounded-2xl shadow-lg ring-1 ring-indigo-100"
              />
              <div>
                <h1 className="flex items-center gap-2 text-2xl font-semibold text-slate-800">
                  <span role="img" aria-hidden="true">📱</span>
                  Quét QR Code Điểm Danh VNU TOUR
                </h1>
                {/* <p className="text-sm text-slate-500">Quản lý điểm danh QR một cách nhanh chóng</p> */}
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-3 text-sm text-slate-600">
              <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-4 py-2">
                <span role="img" aria-hidden="true">👤</span>
                {user?.username} ({user?.role})
              </span>
              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex items-center gap-2 rounded-full bg-rose-500 px-5 py-2 text-sm font-semibold text-white shadow-md transition hover:bg-rose-600"
              >
                <span role="img" aria-hidden="true">🚪</span>
                Đăng xuất
              </button>
            </div>
          </div>
        </header>

        <section className="w-full max-w-6xl grid gap-6 xl:grid-cols-[minmax(320px,420px)_1fr]">
          <div className="rounded-3xl bg-white/95 p-6 shadow-xl backdrop-blur">
            <h2 className="text-lg font-semibold text-slate-800">Camera Scanner</h2>
            <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-slate-950">
              <video ref={videoRef} className="aspect-[4/3] h-full w-full object-cover" />
            </div>
            <p className="mt-4 flex items-start gap-2 text-sm text-slate-600">
              <span role="img" aria-hidden="true">📷</span>
              Đưa camera vào QR code của đội tham gia để quét
            </p>
          </div>

          <div className="rounded-3xl bg-white/95 p-6 shadow-xl backdrop-blur">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-lg font-semibold text-slate-800">
                Danh sách đội đã quét ({statsTeams})
              </h2>
              <p className="flex items-center gap-2 text-sm text-slate-600">
                <span role="img" aria-hidden="true">🎟️</span>
                Tổng voucher đã phát: <span className="font-semibold text-indigo-600">{statsParticipants}</span>
              </p>
            </div>
            <div className="mt-4 max-h-[480px] space-y-4 overflow-y-auto pr-1">
              {renderTeamList()}
            </div>
          </div>
        </section>

        <footer className="w-full max-w-6xl">
          <div className="rounded-3xl bg-white/90 p-4 text-center shadow-xl backdrop-blur">
            <img
              src="https://storage.hiseku.net/PhoneHeader.png"
              alt="VNUTour footer banner"
              className="mx-auto w-full max-w-xl rounded-2xl shadow-lg"
            />
          </div>
        </footer>
      </div>
    )
  }

  const inputClass = (hasError) => [
    'mt-1 w-full rounded-2xl border px-4 py-3 text-sm shadow-sm transition',
    hasError
      ? 'border-rose-300 bg-rose-50 focus:border-rose-400 focus:ring-2 focus:ring-rose-200'
      : 'border-slate-200 bg-white focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200'
  ].join(' ')

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="rounded-3xl bg-white/95 p-8 shadow-2xl backdrop-blur">
          <div className="flex flex-col items-center gap-4 text-center">
            <img
              src="https://storage.hiseku.net/BieuTrung.png"
              alt="VNUTour 2025 logo"
              className="h-20 w-auto rounded-2xl shadow-lg ring-1 ring-indigo-100"
            />
            <h1 className="text-2xl font-semibold text-slate-800">
              {isRegisterMode ? 'Đăng ký' : 'Đăng nhập'}
            </h1>
            <p className="text-sm text-slate-500">
              {isRegisterMode ? 'Tạo tài khoản mới để tham gia quản lý' : 'Vui lòng đăng nhập để tiếp tục'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {apiError && (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {apiError}
              </div>
            )}

            <div>
              <label htmlFor="username" className="text-sm font-medium text-slate-700">Tên đăng nhập</label>
              <input
                type="text"
                id="username"
                name="username"
                value={formData.username}
                onChange={handleInputChange}
                placeholder="Nhập tên đăng nhập"
                className={inputClass(Boolean(errors.username))}
                disabled={isLoading}
              />
              {errors.username && (
                <p className="mt-1 text-xs font-medium text-rose-600">{errors.username}</p>
              )}
            </div>

            <div>
              <label htmlFor="password" className="text-sm font-medium text-slate-700">Mật khẩu</label>
              <input
                type="password"
                id="password"
                name="password"
                value={formData.password}
                onChange={handleInputChange}
                placeholder="Nhập mật khẩu"
                className={inputClass(Boolean(errors.password))}
                disabled={isLoading}
              />
              {errors.password && (
                <p className="mt-1 text-xs font-medium text-rose-600">{errors.password}</p>
              )}
            </div>

            {isRegisterMode && (
              <>
                <div>
                  <label htmlFor="email" className="text-sm font-medium text-slate-700">Email</label>
                  <input
                    type="email"
                    id="email"
                    name="email"
                    value={formData.email}
                    onChange={handleInputChange}
                    placeholder="Nhập email"
                    className={inputClass(Boolean(errors.email))}
                    disabled={isLoading}
                  />
                  {errors.email && (
                    <p className="mt-1 text-xs font-medium text-rose-600">{errors.email}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="secret" className="text-sm font-medium text-slate-700">Mã secret</label>
                  <input
                    type="password"
                    id="secret"
                    name="secret"
                    value={formData.secret}
                    onChange={handleInputChange}
                    placeholder="Nhập mã secret"
                    className={inputClass(Boolean(errors.secret))}
                    disabled={isLoading}
                  />
                  {errors.secret && (
                    <p className="mt-1 text-xs font-medium text-rose-600">{errors.secret}</p>
                  )}
                </div>
              </>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="mt-2 w-full rounded-2xl bg-gradient-to-r from-indigo-500 to-purple-500 px-6 py-3 text-sm font-semibold text-white shadow-lg transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoading
                ? (isRegisterMode ? 'Đang đăng ký...' : 'Đang đăng nhập...')
                : (isRegisterMode ? 'Đăng ký' : 'Đăng nhập')}
            </button>
          </form>

          <div className="mt-6 space-y-3 text-center text-sm text-slate-600">
            <p>
              {isRegisterMode ? 'Đã có tài khoản?' : 'Chưa có tài khoản?'}{' '}
              <button
                type="button"
                onClick={() => {
                  setIsRegisterMode(!isRegisterMode)
                  setApiError('')
                  setErrors({})
                  setFormData({ username: '', password: '', email: '', secret: '' })
                }}
                className="font-semibold text-indigo-500 underline underline-offset-4"
              >
                {isRegisterMode ? 'Đăng nhập ngay' : 'Đăng ký ngay'}
              </button>
            </p>
            <p className="text-xs text-slate-500">API URL: {API_BASE_URL}</p>
            <button
              type="button"
              onClick={async () => {
                try {
                  const response = await fetch(`${API_BASE_URL}/health`)
                  const data = await response.json()
                  alert(`✅ API kết nối thành công!
Status: ${data.status}`)
                } catch (error) {
                  alert(`⚠️ Không thể kết nối API:
${error.message}`)
                }
              }}
              className="inline-flex items-center justify-center rounded-full bg-emerald-500 px-4 py-2 text-xs font-semibold text-white shadow-md transition hover:bg-emerald-600"
            >
              🔍 Test kết nối API
            </button>
          </div>

          <footer className="mt-8 flex justify-center">
            <img
              src="https://storage.hiseku.net/PhoneHeader.png"
              alt="VNUTour footer banner"
              className="w-full max-w-xs rounded-2xl shadow-lg"
            />
          </footer>
        </div>
      </div>
    </div>
  )
}

export default App
