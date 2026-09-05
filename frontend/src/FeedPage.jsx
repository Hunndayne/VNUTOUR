import { useEffect, useState } from 'react'
import logoImage from './assets/vnutour-logo.webp'
import { apiRequest, getStoredUser, logoutAndRedirect } from './api.js'
import FeedCard from './FeedCard.jsx'
import { navigate } from './router.js'

function Contours() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 opacity-70"
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg width='520' height='520' viewBox='0 0 520 520' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' stroke='%23DCD8CC' stroke-width='1'%3E%3Cpath d='M62 80c64-48 142-56 212-24 80 37 132 22 182-6'/%3E%3Cpath d='M30 166c70-58 154-68 236-32 78 34 132 24 218-20'/%3E%3Cpath d='M18 252c78-44 142-52 214-22 90 38 168 32 252-22'/%3E%3Cpath d='M44 338c72-35 130-42 196-18 88 32 164 22 238-28'/%3E%3Cpath d='M92 428c72-42 146-48 220-18 60 24 118 16 166-20'/%3E%3Ccircle cx='392' cy='138' r='52'/%3E%3Ccircle cx='392' cy='138' r='82'/%3E%3Ccircle cx='142' cy='330' r='46'/%3E%3Ccircle cx='142' cy='330' r='76'/%3E%3C/g%3E%3C/svg%3E\")",
        backgroundSize: '520px 520px',
      }}
    />
  )
}

export default function FeedPage() {
  const user = getStoredUser()
  const [posts, setPosts] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')

  const fetchPosts = async (offset = 0) => {
    if (offset === 0) setLoading(true)
    else setLoadingMore(true)
    setError('')

    try {
      const res = await apiRequest(`/feed?limit=10&offset=${offset}`)
      const newPosts = res.posts || []
      if (offset === 0) {
        setPosts(newPosts)
      } else {
        setPosts((prev) => [...prev, ...newPosts])
      }
      setTotal(res.total || 0)
    } catch (err) {
      if (err?.status === 403) {
        setError('Bảng tin chỉ hiển thị cho các đội đã được ban tổ chức duyệt.')
      } else {
        setError('Không thể tải bài viết bảng tin. Vui lòng thử lại sau.')
      }
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    fetchPosts(0)
  }, [])

  const handlePostUpdated = (updatedPost) => {
    setPosts((prev) =>
      prev.map((p) => (p.id === updatedPost.id ? updatedPost : p)),
    )
  }

  return (
    <div className="min-h-screen font-sans bg-[#F3F4F1] text-[#20312B]">
      <Contours />

      {/* Header */}
      <header
        className="sticky top-0 z-40 border-b backdrop-blur"
        style={{ backgroundColor: 'rgba(243,244,241,0.95)', borderColor: '#DCD8CC' }}
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <a href="/participant" className="flex items-center gap-3">
              <img src={logoImage} alt="VNUTour" className="h-10 w-10 object-contain" />
              <div>
                <p className="font-display text-base font-bold text-[#20312B]">VNUTour</p>
                <p className="font-mono text-[11px] text-[#20312B]/40">Bảng tin BTC</p>
              </div>
            </a>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate('/participant')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#DCD8CC] bg-white px-3 py-2 text-sm font-semibold text-[#20312B]/75 transition hover:bg-[#F3F4F1] hover:text-[#20312B]"
            >
              <span>←</span>
              <span>Về trang chủ</span>
            </button>
            {user && (
              <button
                type="button"
                onClick={() => logoutAndRedirect('/')}
                className="hidden rounded-lg border border-[#DCD8CC] bg-white px-3 py-2 text-sm font-semibold text-[#20312B]/60 transition hover:bg-[#F3F4F1] hover:text-[#20312B] sm:inline-flex"
              >
                Đăng xuất
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Feed Content */}
      <main className="relative mx-auto max-w-3xl px-4 py-6 sm:py-8 space-y-6">
        {/* Page title */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold text-[#20312B] sm:text-3xl">
              Bảng tin Ban tổ chức
            </h1>
            <p className="mt-1 text-sm text-[#20312B]/60">
              Thông báo, thể lệ và cập nhật sự kiện chính thức từ BTC VNUTour
            </p>
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div className="rounded-xl border border-[#D6492B]/25 bg-[#D6492B]/[0.06] p-4 text-sm text-[#D6492B]">
            {error}
          </div>
        )}

        {/* Loading skeleton */}
        {loading && (
          <div className="space-y-4">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="h-48 animate-pulse rounded-xl border border-[#DCD8CC] bg-white/60 p-6"
              />
            ))}
          </div>
        )}

        {/* Posts list */}
        {!loading && posts.length > 0 && (
          <div className="space-y-6">
            {posts.map((post) => (
              <FeedCard
                key={post.id}
                post={post}
                compact={false}
                onPostUpdated={handlePostUpdated}
              />
            ))}

            {/* Load more button */}
            {posts.length < total && (
              <div className="pt-2 text-center">
                <button
                  type="button"
                  onClick={() => fetchPosts(posts.length)}
                  disabled={loadingMore}
                  className="inline-flex items-center justify-center rounded-xl border border-[#DCD8CC] bg-white px-6 py-2.5 text-sm font-semibold text-[#20312B] shadow-sm transition hover:bg-[#F3F4F1] disabled:opacity-50"
                >
                  {loadingMore ? 'Đang tải thêm...' : 'Xem thêm bài viết'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && posts.length === 0 && (
          <div className="rounded-xl border border-[#DCD8CC] bg-white p-8 text-center text-sm text-[#20312B]/60">
            <p className="font-semibold text-[#20312B]">Hiện chưa có thông báo nào từ BTC</p>
            <p className="mt-1 text-xs text-[#20312B]/50">
              Vui lòng quay lại sau khi có thông báo mới.
            </p>
          </div>
        )}
      </main>
    </div>
  )
}
