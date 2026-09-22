import { useCallback, useEffect, useId, useRef, useState } from 'react'
import SiteHeader from './SiteHeader.jsx'
import SiteFooter from './SiteFooter.jsx'
import {
  copyTextToClipboard,
  getMoreSearchResults,
  getPhotoErrorMessage,
  getPublicAlbumPhotos,
  listPublicAlbums,
  mergePhotoList,
  searchPhotosByFace,
} from './photoGalleryApi.js'
import { useSearchParam } from './router.js'
import { createPhotoRequestSlot } from './photoGalleryRequests.js'

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024 // 10 MB

export default function PhotoGalleryPage() {
  const [selectedAlbumIdStr, setSelectedAlbumId] = useSearchParam('album', '')
  const selectedAlbumId = selectedAlbumIdStr ? Number(selectedAlbumIdStr) : null

  // Albums state
  const [albums, setAlbums] = useState([])
  const [loadingAlbums, setLoadingAlbums] = useState(true)
  const [albumsError, setAlbumsError] = useState('')
  const [accessError, setAccessError] = useState('')
  const [hasAccess, setHasAccess] = useState(false)

  // Photos state for current album
  const [currentAlbum, setCurrentAlbum] = useState(null)
  const [photos, setPhotos] = useState([])
  const [photosNextCursor, setPhotosNextCursor] = useState(null)
  const [loadingPhotos, setLoadingPhotos] = useState(false)
  const [loadingMorePhotos, setLoadingMorePhotos] = useState(false)
  const [photosError, setPhotosError] = useState('')

  // Face Search state
  const [searchFile, setSearchFile] = useState(null)
  const [searchPreviewUrl, setSearchPreviewUrl] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [isLoadingMoreSearch, setIsLoadingMoreSearch] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [searchResult, setSearchResult] = useState(null) // { token, photos, total, next_cursor, truncated }
  const [searchScope, setSearchScope] = useState('current')

  // Lightbox Modal state
  const [activePhotoIndex, setActivePhotoIndex] = useState(null)
  const triggerButtonRefs = useRef(new Map())
  const lastActiveTriggerIdRef = useRef(null)

  // Status message for aria-live (clipboard, actions)
  const [statusMessage, setStatusMessage] = useState('')
  const [manualCopyUrl, setManualCopyUrl] = useState(null)

  // Refs for canceling previous in-flight requests
  const [albumRequests] = useState(createPhotoRequestSlot)
  const [searchRequests] = useState(createPhotoRequestSlot)
  const fileInputRef = useRef(null)

  const resetSearch = useCallback(() => {
    searchRequests.cancel()
    setSearchResult(null)
    setSearchError('')
    setIsSearching(false)
    setIsLoadingMoreSearch(false)
    setActivePhotoIndex(null)
    setStatusMessage('')
  }, [searchRequests])

  const handleAccessError = useCallback((error) => {
    if (error?.status !== 401 && error?.status !== 403) return false
    albumRequests.cancel()
    resetSearch()
    setPhotos([])
    setAlbums([])
    setCurrentAlbum(null)
    setAccessError(getPhotoErrorMessage(error))
    setHasAccess(false)
    return true
  }, [albumRequests, resetSearch])

  useEffect(() => {
    resetSearch()
    return () => searchRequests.cancel()
  }, [selectedAlbumId, resetSearch, searchRequests])

  // Form input accessibility ID
  const searchFileInputId = useId()

  // Clean up object URLs on change and unmount
  useEffect(() => {
    return () => {
      if (searchPreviewUrl) {
        URL.revokeObjectURL(searchPreviewUrl)
      }
    }
  }, [searchPreviewUrl])

  // Announce status message timeout
  useEffect(() => {
    if (!statusMessage) return
    const timer = setTimeout(() => setStatusMessage(''), 4000)
    return () => clearTimeout(timer)
  }, [statusMessage])

  // Fetch public albums on mount
  useEffect(() => {
    const controller = new AbortController()
    setLoadingAlbums(true)
    setAlbumsError('')

    listPublicAlbums({ signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return
        setHasAccess(true)
        const list = Array.isArray(data?.albums) ? data.albums : []
        setAlbums(list)
        // If query has no album selected but albums exist, select the first one
        if (!selectedAlbumIdStr && list.length > 0) {
          setSelectedAlbumId(String(list[0].id), { replace: true })
        }
      })
      .catch((err) => {
        if (controller.signal.aborted || err.name === 'AbortError') return
        if (handleAccessError(err)) return
        setAlbumsError(getPhotoErrorMessage(err, 'Không thể tải danh sách album.'))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingAlbums(false)
      })

    return () => controller.abort()
  }, [selectedAlbumIdStr, setSelectedAlbumId, handleAccessError])

  // Fetch photos whenever selectedAlbumId changes
  useEffect(() => {
    albumRequests.cancel()
    setCurrentAlbum(null)
    setPhotos([])
    setPhotosNextCursor(null)
    setLoadingMorePhotos(false)
    setPhotosError('')
    if (!selectedAlbumId) {
      setLoadingPhotos(false)
      return
    }
    const request = albumRequests.start()
    setLoadingPhotos(true)

    getPublicAlbumPhotos({ albumId: selectedAlbumId, signal: request.signal })
      .then((data) => {
        if (!request.isCurrent()) return
        setCurrentAlbum(data?.album || null)
        setPhotos(Array.isArray(data?.photos) ? data.photos : [])
        setPhotosNextCursor(data?.next_cursor ?? null)
      })
      .catch((err) => {
        if (!request.isCurrent() || err.name === 'AbortError') return
        if (handleAccessError(err)) return
        setPhotosError(getPhotoErrorMessage(err, 'Không thể tải danh sách ảnh của album.'))
      })
      .finally(() => {
        if (request.isCurrent()) setLoadingPhotos(false)
        request.finish()
      })

    return () => {
      albumRequests.cancel()
    }
  }, [selectedAlbumId, albumRequests, handleAccessError])

  // Load more photos for current album
  const handleLoadMorePhotos = useCallback(() => {
    if (!selectedAlbumId || !photosNextCursor || albumRequests.pending) return

    const request = albumRequests.start()
    setLoadingMorePhotos(true)
    getPublicAlbumPhotos({ albumId: selectedAlbumId, cursor: photosNextCursor, signal: request.signal })
      .then((data) => {
        if (!request.isCurrent()) return
        setPhotos((prev) => mergePhotoList(prev, data?.photos || []))
        setPhotosNextCursor(data?.next_cursor ?? null)
      })
      .catch((err) => {
        if (!request.isCurrent() || err.name === 'AbortError') return
        if (handleAccessError(err)) return
        setStatusMessage(getPhotoErrorMessage(err, 'Không thể tải thêm ảnh.'))
      })
      .finally(() => {
        if (request.isCurrent()) setLoadingMorePhotos(false)
        request.finish()
      })
  }, [selectedAlbumId, photosNextCursor, albumRequests, handleAccessError])

  // Handle local file selection for face search
  const handleFileChange = (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    setSearchError('')

    // Validate mime type
    const validTypes = ['image/jpeg', 'image/png', 'image/webp']
    if (!validTypes.includes(file.type)) {
      setSearchError('Định dạng ảnh không được hỗ trợ. Vui lòng chọn ảnh JPEG, PNG hoặc WebP.')
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }

    // Validate size (max 10 MB)
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setSearchError('Kích thước ảnh vượt quá giới hạn 10 MB. Vui lòng chọn ảnh nhỏ hơn.')
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }

    // Revoke old object URL
    if (searchPreviewUrl) {
      URL.revokeObjectURL(searchPreviewUrl)
    }

    const objectUrl = URL.createObjectURL(file)
    resetSearch()
    setSearchFile(file)
    setSearchPreviewUrl(objectUrl)
  }

  // Remove selected search file
  const handleClearSearchFile = () => {
    resetSearch()
    if (searchPreviewUrl) {
      URL.revokeObjectURL(searchPreviewUrl)
    }
    setSearchFile(null)
    setSearchPreviewUrl('')
    setSearchError('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // Execute Face Search
  const handleExecuteSearch = async () => {
    if (!searchFile || isSearching) return

    resetSearch()
    const request = searchRequests.start()

    setIsSearching(true)
    setSearchError('')

    try {
      const scopeAlbum = searchScope === 'all' ? null : selectedAlbumId
      const response = await searchPhotosByFace({
        imageFile: searchFile,
        albumId: scopeAlbum,
        signal: request.signal,
      })

      if (!request.isCurrent()) return
      setSearchResult({
        token: response.token,
        photos: Array.isArray(response.photos) ? response.photos : [],
        total: response.total ?? (response.photos?.length || 0),
        next_cursor: response.next_cursor ?? null,
        truncated: Boolean(response.truncated),
        searchedAlbumId: scopeAlbum,
      })
      setStatusMessage(`Đã tìm thấy ${response.photos?.length || 0} ảnh phù hợp.`)
    } catch (err) {
      if (!request.isCurrent() || err.name === 'AbortError') return
      if (handleAccessError(err)) return
      setSearchError(getPhotoErrorMessage(err, 'Tìm kiếm không thành công. Vui lòng thử lại.'))
    } finally {
      if (request.isCurrent()) setIsSearching(false)
      request.finish()
    }
  }

  // Load more search results using token
  const handleLoadMoreSearchResults = async () => {
    if (!searchResult?.token || !searchResult.next_cursor || searchRequests.pending) return

    const token = searchResult.token
    const request = searchRequests.start()
    setIsLoadingMoreSearch(true)
    try {
      const data = await getMoreSearchResults({
        token,
        cursor: searchResult.next_cursor,
        signal: request.signal,
      })

      if (!request.isCurrent()) return
      setSearchResult((prev) => {
        if (prev?.token !== token) return prev
        return {
          ...prev,
          photos: mergePhotoList(prev.photos, data?.photos || []),
          next_cursor: data?.next_cursor ?? null,
          truncated: Boolean(data?.truncated),
          total: data.total ?? prev.total,
        }
      })
    } catch (err) {
      if (!request.isCurrent() || err.name === 'AbortError') return
      if (handleAccessError(err)) return
      setStatusMessage(getPhotoErrorMessage(err, 'Không thể tải thêm kết quả tìm kiếm.'))
    } finally {
      if (request.isCurrent()) setIsLoadingMoreSearch(false)
      request.finish()
    }
  }

  // Reset search results and return to album view
  const handleBackToAlbum = () => {
    resetSearch()
  }

  // Clipboard copy handler with fallback
  const handleCopyShareLink = async (shareUrl) => {
    if (!shareUrl) {
      setStatusMessage('Ảnh này chưa có liên kết chia sẻ Google Drive.')
      return
    }
    const success = await copyTextToClipboard(shareUrl)
    if (success) {
      setStatusMessage('Đã sao chép liên kết Google Drive vào bộ nhớ tạm.')
      setManualCopyUrl(null)
    } else {
      setManualCopyUrl(shareUrl)
      setStatusMessage('Không thể tự động sao chép. Vui lòng sao chép liên kết bên dưới.')
    }
  }

  // Determine current active photo list for display and lightbox
  const isSearchActive = Boolean(searchResult)
  const displayPhotos = isSearchActive ? searchResult.photos : photos

  // Lightbox navigation
  const openLightbox = (index, photoId) => {
    lastActiveTriggerIdRef.current = photoId
    setActivePhotoIndex(index)
  }

  const closeLightbox = () => {
    setActivePhotoIndex(null)
    // Return focus to triggering button
    if (lastActiveTriggerIdRef.current) {
      const triggerEl = triggerButtonRefs.current.get(lastActiveTriggerIdRef.current)
      if (triggerEl && typeof triggerEl.focus === 'function') {
        triggerEl.focus()
      }
    }
  }

  const activePhoto = activePhotoIndex !== null ? displayPhotos[activePhotoIndex] : null

  // Keyboard navigation for Lightbox
  useEffect(() => {
    if (activePhotoIndex === null) return

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeLightbox()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        setActivePhotoIndex((prev) => (prev > 0 ? prev - 1 : displayPhotos.length - 1))
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        setActivePhotoIndex((prev) => (prev < displayPhotos.length - 1 ? prev + 1 : 0))
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activePhotoIndex, displayPhotos.length])

  // Album processing status helpers
  const currentAlbumCounts = currentAlbum?.counts || {}
  const totalPhotosInAlbum = currentAlbumCounts.total || 0
  const indexedPhotosInAlbum = (currentAlbumCounts.indexed || 0) + (currentAlbumCounts.no_faces || 0)
  const processingPhotosInAlbum = (currentAlbumCounts.processing || 0) + (currentAlbumCounts.pending || 0)
  const isCurrentlyProcessing = processingPhotosInAlbum > 0

  if (!hasAccess || accessError) {
    return (
      <div className="flex min-h-screen flex-col bg-paper text-ink">
        <SiteHeader />
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
          <h1 className="font-display text-2xl font-bold">Thư viện ảnh sự kiện</h1>
          {accessError || albumsError ? (
            <>
              <p role="alert" className="mt-4 rounded-xl border border-clay/30 bg-clay/10 p-4 text-sm">{accessError || albumsError}</p>
              <a href="/login" className="mt-6 inline-block font-semibold text-trail underline">Về trang tài khoản</a>
            </>
          ) : <p role="status" className="mt-4 text-sm">Đang kiểm tra quyền truy cập thư viện ảnh...</p>}
        </main>
        <SiteFooter />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-paper font-sans text-ink">
      <SiteHeader />

      {/* Screen-reader live notifications */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {statusMessage}
      </div>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
        {/* Page Hero */}
        <section className="mb-8 border-b border-stone pb-6">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="font-mono text-xs uppercase tracking-widest text-trail font-bold">
                VNUTour Moments
              </p>
              <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
                Thư Viện Ảnh Sự Kiện
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-ink/70 sm:text-base">
                Xem lại những khoảnh khắc đáng nhớ và tìm kiếm nhanh những bức ảnh có khuôn mặt của bạn bằng trí tuệ nhân tạo.
              </p>
            </div>
          </div>
        </section>

        {/* Global / Albums Error */}
        {albumsError && (
          <div
            role="alert"
            className="mb-6 rounded-xl border border-clay/30 bg-clay/10 p-4 text-sm font-medium text-clay"
          >
            {albumsError}
          </div>
        )}

        {/* Face Search Section */}
        <section
          aria-labelledby="face-search-heading"
          className="mb-8 rounded-2xl border border-stone bg-white p-5 shadow-[0_2px_8px_rgba(32,49,43,0.04)] sm:p-6"
        >
          <div className="flex flex-col gap-1">
            <h2 id="face-search-heading" className="font-display text-lg font-bold text-ink sm:text-xl">
              🔍 Tìm ảnh của bạn theo khuôn mặt
            </h2>
            <p className="text-xs text-ink/60 sm:text-sm">
              Tải lên một bức ảnh chân dung rõ mặt để hệ thống tự động tìm tất cả ảnh sự kiện có sự xuất hiện của bạn.
            </p>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Left: Upload Input & Preview */}
            <div className="lg:col-span-6 flex flex-col gap-4">
              <label
                htmlFor={searchFileInputId}
                className="font-mono text-xs font-semibold uppercase tracking-wider text-ink/70"
              >
                Ảnh chân dung tham chiếu (JPEG, PNG, WebP — Tối đa 10 MB)
              </label>

              {!searchPreviewUrl ? (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-stone bg-paper/50 p-6 text-center transition hover:border-trail hover:bg-paper"
                >
                  <svg
                    className="h-10 w-10 text-ink/40"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM18.75 10.5h.008v.008h-.008V10.5Z"
                    />
                  </svg>
                  <p className="mt-2 text-sm font-medium text-ink">Bấm để chọn ảnh chân dung</p>
                  <p className="text-xs text-ink/50">Khuyên dùng ảnh chụp một mình, đủ sáng, nhìn thẳng</p>
                </div>
              ) : (
                <div className="flex flex-col sm:flex-row items-center gap-4 rounded-xl border border-stone bg-paper/40 p-3">
                  <div className="h-28 w-28 shrink-0 overflow-hidden rounded-lg border border-stone bg-white">
                    <img
                      src={searchPreviewUrl}
                      alt="Ảnh chân dung đã chọn để tìm kiếm"
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="flex flex-1 flex-col gap-2">
                    <div className="overflow-hidden">
                      <p className="truncate text-sm font-semibold text-ink">{searchFile?.name}</p>
                      <p className="text-xs text-ink/60">
                        {searchFile ? (searchFile.size / (1024 * 1024)).toFixed(2) : 0} MB
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isSearching}
                        className="rounded-lg border border-stone bg-white px-3 py-1.5 text-xs font-semibold text-ink transition hover:bg-paper disabled:opacity-50"
                      >
                        Đổi ảnh khác
                      </button>
                      <button
                        type="button"
                        onClick={handleClearSearchFile}
                        disabled={isSearching}
                        className="rounded-lg border border-clay/30 bg-white px-3 py-1.5 text-xs font-semibold text-clay transition hover:bg-clay/5 disabled:opacity-50"
                      >
                        Xóa ảnh
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                id={searchFileInputId}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleFileChange}
                className="hidden"
                disabled={isSearching}
              />
            </div>

            {/* Right: Scope & Action */}
            <div className="lg:col-span-6 flex flex-col justify-between gap-4">
              <div className="flex flex-col gap-3">
                <label className="font-mono text-xs font-semibold uppercase tracking-wider text-ink/70">
                  Phạm vi tìm kiếm
                </label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => { resetSearch(); setSearchScope('current') }}
                    className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${
                      searchScope === 'current'
                        ? 'bg-trail text-white'
                        : 'border border-stone bg-white text-ink/80 hover:bg-paper'
                    }`}
                  >
                    Trong album hiện tại ({currentAlbum?.title || 'Đang chọn'})
                  </button>
                  <button
                    type="button"
                    onClick={() => { resetSearch(); setSearchScope('all') }}
                    className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${
                      searchScope === 'all'
                        ? 'bg-trail text-white'
                        : 'border border-stone bg-white text-ink/80 hover:bg-paper'
                    }`}
                  >
                    Tìm trong tất cả album
                  </button>
                </div>
                <p className="text-xs text-ink/60">
                  Mẹo: Giới hạn tìm kiếm trong một album cụ thể sẽ cho kết quả nhanh và chính xác hơn.
                </p>
              </div>

              <div>
                {searchError && (
                  <div
                    role="alert"
                    className="mb-3 rounded-lg border border-clay/30 bg-clay/10 p-3 text-xs font-medium text-clay"
                  >
                    {searchError}
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleExecuteSearch}
                  disabled={!searchFile || isSearching}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-ink px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-ink/90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isSearching ? (
                    <>
                      <svg
                        className="h-4 w-4 animate-spin text-white"
                        fill="none"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                      </svg>
                      <span>Hệ thống đang quét khuôn mặt...</span>
                    </>
                  ) : (
                    <>
                      <span>Bắt đầu tìm ảnh</span>
                      <svg
                        className="h-4 w-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                        aria-hidden="true"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                      </svg>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Album Selector & Processing Progress */}
        {!isSearchActive && (
          <section className="mb-6 space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-display text-xl font-bold text-ink">Danh Sách Album Sự Kiện</h2>
                <p className="text-xs text-ink/60">Chọn album bạn muốn xem ảnh bên dưới</p>
              </div>

              {/* Album selector tabs */}
              {albums.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {albums.map((alb) => {
                    const isSelected = alb.id === selectedAlbumId
                    return (
                      <button
                        key={alb.id}
                        type="button"
                        onClick={() => {
                          if (selectedAlbumId === alb.id) return
                          albumRequests.cancel()
                          resetSearch()
                          setSelectedAlbumId(String(alb.id))
                        }}
                        className={`rounded-xl px-4 py-2 text-xs font-semibold transition ${
                          isSelected
                            ? 'bg-ink text-white shadow-sm'
                            : 'border border-stone bg-white text-ink/75 hover:bg-paper'
                        }`}
                      >
                        {alb.title}
                        {alb.counts?.total ? ` (${alb.counts.total})` : ''}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Current album metadata & AI processing indicator */}
            {currentAlbum && (
              <div className="rounded-xl border border-stone bg-white p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="font-display text-base font-bold text-ink">{currentAlbum.title}</h3>
                    {currentAlbum.description && (
                      <p className="text-xs text-ink/70 mt-0.5">{currentAlbum.description}</p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center rounded-full bg-paper px-2.5 py-1 text-xs font-medium text-ink">
                      {totalPhotosInAlbum} ảnh tổng cộng
                    </span>
                    <span className="inline-flex items-center rounded-full bg-trail/10 px-2.5 py-1 text-xs font-semibold text-trail">
                      Đã xử lý AI: {indexedPhotosInAlbum}/{totalPhotosInAlbum}
                    </span>
                  </div>
                </div>

                {(currentAlbumCounts.indexing_failed || 0) > 0 && (
                  <p className="mt-3 text-xs text-clay">
                    {currentAlbumCounts.indexing_failed} ảnh vẫn xem được nhưng chưa xử lý AI thành công,
                    nên chưa xuất hiện trong kết quả tìm theo khuôn mặt.
                  </p>
                )}
                {/* Processing notice */}
                {isCurrentlyProcessing && (
                  <div className="mt-3 flex items-center gap-2 rounded-lg bg-gold/15 px-3 py-2 text-xs font-medium text-[#9A6B12]">
                    <svg
                      className="h-4 w-4 animate-spin shrink-0 text-[#9A6B12]"
                      fill="none"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    <span>
                      Album này đang được hệ thống tiếp tục xử lý các ảnh còn lại ({processingPhotosInAlbum} ảnh đang chờ/xử lý).
                      Bạn vẫn có thể xem trước các ảnh đã hoàn thành xử lý.
                    </span>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {/* Search Results Header */}
        {isSearchActive && (
          <section className="mb-6 rounded-xl border border-trail/20 bg-trail/5 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-2.5 w-2.5 rounded-full bg-trail" />
                  <h2 className="font-display text-lg font-bold text-ink">
                    Kết quả tìm kiếm ({searchResult.total} ảnh được tìm thấy)
                  </h2>
                </div>
                <p className="mt-0.5 text-xs text-ink/70">
                  {searchResult.searchedAlbumId
                    ? `Đang hiển thị ảnh trong album đã chọn`
                    : 'Đang hiển thị ảnh trên toàn bộ các album'}
                </p>
              </div>

              <button
                type="button"
                onClick={handleBackToAlbum}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-stone bg-white px-4 py-2 text-xs font-semibold text-ink shadow-sm transition hover:bg-paper"
              >
                ← Quay lại album
              </button>
            </div>

            {/* Truncated notice */}
            {searchResult.truncated && (
              <div
                role="note"
                className="mt-3 rounded-lg border border-gold/40 bg-gold/15 p-3 text-xs text-[#8A5F0C]"
              >
                ⚠️ Kết quả tìm kiếm đã đạt giới hạn tối đa của hệ thống. Bạn có thể chọn tìm trong một album cụ thể để
                có kết quả chính xác và đầy đủ nhất.
              </div>
            )}
          </section>
        )}

        {/* Manual Copy URL prompt fallback if navigator.clipboard failed */}
        {manualCopyUrl && (
          <div
            role="dialog"
            aria-label="Sao chép liên kết thủ công"
            className="mb-6 rounded-xl border border-stone bg-white p-4 shadow-sm"
          >
            <p className="text-xs font-semibold text-ink">
              Vui lòng bôi đen và sao chép đường dẫn Google Drive bên dưới:
            </p>
            <div className="mt-2 flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={manualCopyUrl}
                onFocus={(e) => e.target.select()}
                className="w-full rounded-lg border border-stone bg-paper px-3 py-1.5 font-mono text-xs text-ink"
              />
              <button
                type="button"
                onClick={() => setManualCopyUrl(null)}
                className="rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-white"
              >
                Đóng
              </button>
            </div>
          </div>
        )}

        {/* Photos Error */}
        {photosError && (
          <div
            role="alert"
            className="mb-6 rounded-xl border border-clay/30 bg-clay/10 p-4 text-sm font-medium text-clay"
          >
            {photosError}
          </div>
        )}

        {/* Photo Grid */}
        <section aria-label="Lưới ảnh sự kiện" className="min-h-[300px]">
          {loadingPhotos || (loadingAlbums && albums.length === 0) ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <svg
                className="h-8 w-8 animate-spin text-trail"
                fill="none"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              <p className="mt-3 text-sm font-medium text-ink/70">Đang tải danh sách ảnh...</p>
            </div>
          ) : displayPhotos.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-stone bg-white py-16 px-4 text-center">
              <svg
                className="h-12 w-12 text-ink/30"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 20.25h16.5a1.5 1.5 0 0 0 1.5-1.5V5.25a1.5 1.5 0 0 0-1.5-1.5H3.75a1.5 1.5 0 0 0-1.5 1.5v13.5a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V9Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z"
                />
              </svg>
              <h3 className="mt-3 font-display text-base font-bold text-ink">
                {isSearchActive
                  ? 'Không tìm thấy ảnh có khuôn mặt tương ứng'
                  : 'Chưa có ảnh nào trong album này'}
              </h3>
              <p className="mt-1 max-w-md text-xs text-ink/60 sm:text-sm">
                {isSearchActive ? (
                  isCurrentlyProcessing ? (
                    'Hệ thống chưa tìm thấy khuôn mặt của bạn trong các ảnh đã xử lý. Vì album vẫn đang tiếp tục lập chỉ mục các ảnh còn lại, bạn có thể thử lại sau ít phút.'
                  ) : (
                    'Bạn có thể thử lại bằng ảnh chân dung khác rõ mặt hơn, đủ sáng và không bị che khuất.'
                  )
                ) : (
                  'Ban tổ chức đang chuẩn bị và xử lý ảnh cho album này. Vui lòng quay lại sau.'
                )}
              </p>
              {isSearchActive && (
                <button
                  type="button"
                  onClick={handleBackToAlbum}
                  className="mt-4 rounded-lg bg-ink px-4 py-2 text-xs font-semibold text-white transition hover:bg-ink/90"
                >
                  Quay lại album
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 sm:gap-4">
              {displayPhotos.map((photo, index) => {
                const photoSrc = photo.thumbnail_url || photo.preview_url
                const altText = photo.filename || `Ảnh sự kiện số ${index + 1}`

                return (
                  <div
                    key={photo.id}
                    className="group relative aspect-square overflow-hidden rounded-xl border border-stone bg-paper/60 transition hover:shadow-md"
                  >
                    <button
                      ref={(el) => {
                        if (el) triggerButtonRefs.current.set(photo.id, el)
                        else triggerButtonRefs.current.delete(photo.id)
                      }}
                      type="button"
                      onClick={() => openLightbox(index, photo.id)}
                      className="h-full w-full overflow-hidden text-left focus:outline-none focus:ring-2 focus:ring-trail"
                      aria-label={`Xem ảnh lớn: ${altText}`}
                    >
                      {photoSrc ? (
                        <img
                          src={photoSrc}
                          alt={altText}
                          loading="lazy"
                          className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-paper text-xs text-ink/40">
                          Đang tạo preview...
                        </div>
                      )}
                    </button>

                    {/* Quick action buttons hover overlay on desktop */}
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-end gap-1.5 bg-gradient-to-t from-ink/80 via-ink/40 to-transparent p-2 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                      {photo.share_url && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleCopyShareLink(photo.share_url)
                          }}
                          title="Sao chép link Google Drive"
                          aria-label={`Sao chép link Google Drive của ${altText}`}
                          className="pointer-events-auto rounded-md bg-white/90 p-1.5 text-ink transition hover:bg-white"
                        >
                          <svg
                            className="h-3.5 w-3.5"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                            aria-hidden="true"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244"
                            />
                          </svg>
                        </button>
                      )}
                      {photo.share_url && (
                        <a
                          href={photo.share_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Mở ảnh gốc trên Drive"
                          aria-label={`Mở ảnh gốc ${altText} trên Google Drive`}
                          className="pointer-events-auto rounded-md bg-white/90 p-1.5 text-ink transition hover:bg-white"
                        >
                          <svg
                            className="h-3.5 w-3.5"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                            aria-hidden="true"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                            />
                          </svg>
                        </a>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Load More Button */}
          {((!isSearchActive && photosNextCursor) || (isSearchActive && searchResult?.next_cursor)) && (
            <div className="mt-8 flex justify-center">
              <button
                type="button"
                onClick={isSearchActive ? handleLoadMoreSearchResults : handleLoadMorePhotos}
                disabled={loadingMorePhotos || isLoadingMoreSearch}
                className="inline-flex items-center gap-2 rounded-xl border border-stone bg-white px-6 py-2.5 text-sm font-semibold text-ink shadow-sm transition hover:bg-paper disabled:opacity-50"
              >
                {loadingMorePhotos || isLoadingMoreSearch ? (
                  <>
                    <svg
                      className="h-4 w-4 animate-spin text-trail"
                      fill="none"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    <span>Đang tải thêm ảnh...</span>
                  </>
                ) : (
                  <span>Tải thêm ảnh</span>
                )}
              </button>
            </div>
          )}
        </section>
      </main>

      {/* Lightbox Modal (Accessible, No external dependencies) */}
      {activePhoto && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Chi tiết ảnh ${activePhoto.filename || ''}`}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-ink/90 p-4 backdrop-blur-sm sm:p-6"
        >
          {/* Top action bar */}
          <div className="flex w-full max-w-5xl items-center justify-between py-2 text-white">
            <div className="truncate pr-4">
              <p className="truncate text-sm font-semibold">{activePhoto.filename || 'Ảnh sự kiện'}</p>
              <p className="text-xs text-white/70">
                Ảnh {activePhotoIndex + 1} / {displayPhotos.length}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {activePhoto.share_url && (
                <button
                  type="button"
                  onClick={() => handleCopyShareLink(activePhoto.share_url)}
                  className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-white/20"
                >
                  Sao chép link Drive
                </button>
              )}
              {activePhoto.share_url && (
                <a
                  href={activePhoto.share_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-white/20"
                >
                  Mở trên Drive ↗
                </a>
              )}
              {activePhoto.download_url && (
                <a
                  href={activePhoto.download_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  download={activePhoto.filename || true}
                  className="rounded-lg bg-trail px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:brightness-110"
                >
                  Tải ảnh gốc
                </a>
              )}
              <button
                type="button"
                onClick={closeLightbox}
                aria-label="Đóng xem ảnh lớn (Escape)"
                className="rounded-lg bg-white/10 p-1.5 text-white transition hover:bg-white/20"
              >
                <svg
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Main preview container */}
          <div className="relative flex flex-1 w-full max-w-5xl items-center justify-center overflow-hidden py-2">
            {/* Prev button */}
            {displayPhotos.length > 1 && (
              <button
                type="button"
                onClick={() =>
                  setActivePhotoIndex((prev) => (prev > 0 ? prev - 1 : displayPhotos.length - 1))
                }
                aria-label="Xem ảnh trước (Phím mũi tên trái)"
                className="absolute left-2 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-2xl text-white transition hover:bg-black/70 sm:left-4"
              >
                ‹
              </button>
            )}

            <img
              src={activePhoto.preview_url || activePhoto.thumbnail_url}
              alt={activePhoto.filename || 'Ảnh sự kiện kích thước lớn'}
              className="max-h-[75vh] max-w-full rounded-lg object-contain shadow-2xl"
            />

            {/* Next button */}
            {displayPhotos.length > 1 && (
              <button
                type="button"
                onClick={() =>
                  setActivePhotoIndex((prev) => (prev < displayPhotos.length - 1 ? prev + 1 : 0))
                }
                aria-label="Xem ảnh tiếp theo (Phím mũi tên phải)"
                className="absolute right-2 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-2xl text-white transition hover:bg-black/70 sm:right-4"
              >
                ›
              </button>
            )}
          </div>

          {/* Bottom guidance */}
          <div className="py-2 text-center text-xs text-white/50">
            Dùng phím Escape để đóng · Phím mũi tên ←/→ để chuyển ảnh
          </div>
        </div>
      )}

      <SiteFooter />
    </div>
  )
}
