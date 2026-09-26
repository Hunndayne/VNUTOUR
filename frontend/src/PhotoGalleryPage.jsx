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
  refreshPhotoUrls,
  searchPhotosByFace,
} from './photoGalleryApi.js'
import { useSearchParam } from './router.js'
import { createPhotoRequestSlot } from './photoGalleryRequests.js'

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024 // 10 MB
// R2 links expire after 5 minutes; refresh a broken image at most once a minute.
const URL_REFRESH_COOLDOWN_MS = 60 * 1000

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
  const resultsRef = useRef(null)
  const urlRefreshedAtRef = useRef(new Map())

  // A signed R2 URL that has expired fails to load; fetch a fresh one for that
  // photo and swap it into both the album list and the search results.
  const handleImageError = useCallback(async (photo) => {
    const now = Date.now()
    const last = urlRefreshedAtRef.current.get(photo.id)
    if (last && now - last < URL_REFRESH_COOLDOWN_MS) return
    urlRefreshedAtRef.current.set(photo.id, now)
    let fresh
    try {
      fresh = await refreshPhotoUrls({ photo })
    } catch {
      return
    }
    if (!fresh) return
    const swap = (list) => list.map((item) => (item.id === fresh.id ? { ...item, ...fresh } : item))
    setPhotos(swap)
    setSearchResult((prev) => (prev ? { ...prev, photos: swap(prev.photos) } : prev))
  }, [])

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
      setStatusMessage(`Đã tìm thấy ${response.total ?? (response.photos?.length || 0)} ảnh phù hợp.`)
      // On one-column layouts the results sit below the search panel.
      if (window.matchMedia?.('(max-width: 1023px)').matches) {
        resultsRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
      }
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
          <h1 className="font-display text-2xl font-bold">Ảnh sự kiện</h1>
          {accessError || albumsError ? (
            <>
              <p role="alert" className="mt-4 border-l-2 border-clay pl-3 text-sm">{accessError || albumsError}</p>
              <a href="/login" className="mt-6 inline-block text-sm font-semibold text-trail underline underline-offset-4">Về trang tài khoản</a>
            </>
          ) : <p role="status" className="mt-4 text-sm text-ink/60">Đang kiểm tra quyền truy cập…</p>}
        </main>
        <SiteFooter />
      </div>
    )
  }

  const scopeOptions = [
    { key: 'current', label: 'Album này' },
    { key: 'all', label: 'Tất cả album' },
  ]

  return (
    <div className="flex min-h-screen flex-col bg-paper font-sans text-ink">
      <SiteHeader />

      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {statusMessage}
      </div>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-16 pt-8 sm:px-6">
        <header className="max-w-2xl">
          <h1 className="font-display text-3xl font-bold tracking-tight">Ảnh sự kiện</h1>
          <p className="mt-2 text-sm leading-relaxed text-ink/70 sm:text-base">
            Ảnh do ban tổ chức chụp trong các vòng thi. Chọn một album để xem, hoặc tải lên ảnh chân dung
            của bạn để lọc ra những ảnh có bạn.
          </p>
        </header>

        {albumsError && (
          <p role="alert" className="mt-6 border-l-2 border-clay pl-3 text-sm text-clay">{albumsError}</p>
        )}

        <div className="mt-8 grid gap-8 lg:grid-cols-[300px_minmax(0,1fr)] lg:gap-10">
          {/* Face search */}
          <aside aria-labelledby="face-search-heading" className="lg:sticky lg:top-6 lg:self-start">
            <div className="rounded-lg border border-stone bg-white p-5">
              <h2 id="face-search-heading" className="font-display text-lg font-bold">Tìm ảnh có bạn</h2>

              <div className="mt-4">
                <input
                  ref={fileInputRef}
                  id={searchFileInputId}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleFileChange}
                  className="sr-only"
                  disabled={isSearching}
                />
                {searchPreviewUrl ? (
                  <div className="flex items-center gap-3 lg:block">
                    <img
                      src={searchPreviewUrl}
                      alt="Ảnh chân dung bạn đã chọn"
                      className="aspect-square w-24 shrink-0 rounded-md border border-stone object-cover lg:w-full"
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm lg:mt-2 lg:flex-row lg:items-center lg:justify-between lg:gap-2">
                      <span className="truncate text-ink/60" title={searchFile?.name}>{searchFile?.name}</span>
                      <span className="flex shrink-0 gap-3">
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={isSearching}
                          className="font-semibold text-trail hover:underline disabled:opacity-40"
                        >
                          Đổi ảnh
                        </button>
                        <button
                          type="button"
                          onClick={handleClearSearchFile}
                          disabled={isSearching}
                          className="font-semibold text-ink/60 hover:text-clay disabled:opacity-40"
                        >
                          Bỏ
                        </button>
                      </span>
                    </div>
                  </div>
                ) : (
                  <label
                    htmlFor={searchFileInputId}
                    className="flex h-32 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-ink/25 bg-paper px-4 text-center transition hover:border-trail lg:h-auto lg:aspect-[4/3]"
                  >
                    <span className="text-sm font-semibold">Chọn ảnh chân dung</span>
                    <span className="mt-1 text-xs text-ink/55">JPEG, PNG hoặc WebP, tối đa 10 MB</span>
                  </label>
                )}
              </div>

              <ul className="mt-4 list-disc space-y-1 pl-4 text-sm text-ink/70 marker:text-ink/30">
                <li>Chỉ có một mình bạn trong khung hình</li>
                <li>Nhìn thẳng, đủ sáng, thấy rõ mặt</li>
                <li>Không đeo khẩu trang hay kính râm</li>
              </ul>

              <fieldset className="mt-5">
                <legend className="text-sm font-semibold">Tìm trong</legend>
                <div className="mt-2 grid grid-cols-2 rounded-md border border-stone p-0.5 text-sm">
                  {scopeOptions.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      aria-pressed={searchScope === option.key}
                      onClick={() => { resetSearch(); setSearchScope(option.key) }}
                      className={`rounded px-2 py-1.5 font-medium transition ${
                        searchScope === option.key ? 'bg-ink text-white' : 'text-ink/70 hover:text-ink'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </fieldset>

              {searchError && (
                <p role="alert" className="mt-4 border-l-2 border-clay pl-3 text-sm text-clay">{searchError}</p>
              )}

              <button
                type="button"
                onClick={handleExecuteSearch}
                disabled={!searchFile || isSearching}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-md bg-trail px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-trail/90 disabled:cursor-not-allowed disabled:bg-ink/20"
              >
                {isSearching ? <><Spinner className="h-4 w-4" /><span>Đang so khớp…</span></> : 'Tìm ảnh'}
              </button>

              <div className="mt-5 space-y-2 border-t border-stone pt-4 text-xs leading-relaxed text-ink/60">
                <p>
                  <strong className="font-semibold text-ink/80">Kết quả có thể sai.</strong> Máy tự nhận diện khuôn mặt nên
                  có thể sót ảnh của bạn hoặc lẫn ảnh người khác. Hãy xem lại trước khi tải về hay chia sẻ.
                </p>
                <p>
                  <strong className="font-semibold text-ink/80">Ảnh của bạn không được lưu.</strong> Ảnh tải lên chỉ dùng để
                  so khớp ngay lúc tìm, không lưu lại và không dùng để huấn luyện AI.
                </p>
              </div>
            </div>
          </aside>

          {/* Albums and results */}
          <section ref={resultsRef} aria-label="Ảnh sự kiện" className="min-w-0 scroll-mt-4">
            {isSearchActive ? (
              <div className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-stone pb-4">
                <div>
                  <h2 className="font-display text-xl font-bold">
                    {searchResult.total > 0 ? `Tìm thấy ${searchResult.total} ảnh có bạn` : 'Không tìm thấy ảnh nào'}
                  </h2>
                  <p className="mt-1 text-sm text-ink/60">
                    {searchResult.searchedAlbumId ? `Trong album ${currentAlbum?.title || 'đang xem'}` : 'Trong tất cả album'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleBackToAlbum}
                  className="text-sm font-semibold text-trail hover:underline"
                >
                  Quay lại album
                </button>
                {searchResult.truncated && (
                  <p role="note" className="w-full text-sm text-ink/70">
                    Có quá nhiều kết quả nên chỉ hiện một phần. Chọn tìm trong một album để có kết quả đầy đủ hơn.
                  </p>
                )}
              </div>
            ) : (
              <div className="mb-5 border-b border-stone pb-4">
                {albums.length > 1 && (
                  <nav aria-label="Chọn album" className="-mx-1 mb-4 flex gap-1 overflow-x-auto">
                    {albums.map((alb) => {
                      const isSelected = alb.id === selectedAlbumId
                      return (
                        <button
                          key={alb.id}
                          type="button"
                          aria-current={isSelected ? 'true' : undefined}
                          onClick={() => {
                            if (selectedAlbumId === alb.id) return
                            albumRequests.cancel()
                            resetSearch()
                            setSelectedAlbumId(String(alb.id))
                          }}
                          className={`shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition ${
                            isSelected ? 'bg-ink font-semibold text-white' : 'text-ink/70 hover:bg-white hover:text-ink'
                          }`}
                        >
                          {alb.title}
                          {alb.counts?.total ? <span className={isSelected ? 'text-white/60' : 'text-ink/40'}> {alb.counts.total}</span> : null}
                        </button>
                      )
                    })}
                  </nav>
                )}

                {currentAlbum && (
                  <>
                    <h2 className="font-display text-xl font-bold">{currentAlbum.title}</h2>
                    {currentAlbum.description && (
                      <p className="mt-1 text-sm text-ink/70">{currentAlbum.description}</p>
                    )}
                    <p className="mt-2 text-sm text-ink/55">
                      {totalPhotosInAlbum} ảnh · Đã xử lý AI: {indexedPhotosInAlbum}/{totalPhotosInAlbum}
                    </p>
                    {isCurrentlyProcessing && (
                      <p className="mt-1 text-sm text-ink/70">
                        Còn {processingPhotosInAlbum} ảnh đang được xử lý. Ảnh mới sẽ hiện dần, và tìm kiếm chỉ thấy những ảnh đã xử lý xong.
                      </p>
                    )}
                    {(currentAlbumCounts.indexing_failed || 0) > 0 && (
                      <p className="mt-1 text-sm text-ink/70">
                        {currentAlbumCounts.indexing_failed} ảnh vẫn xem được nhưng chưa xử lý AI thành công,
                        nên chưa xuất hiện trong kết quả tìm theo khuôn mặt.
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

            {manualCopyUrl && (
              <div role="dialog" aria-label="Sao chép liên kết thủ công" className="mb-5 rounded-md border border-stone bg-white p-3">
                <p className="text-sm">Không tự sao chép được. Bôi đen và sao chép liên kết này:</p>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={manualCopyUrl}
                    onFocus={(e) => e.target.select()}
                    className="w-full rounded border border-stone bg-paper px-2 py-1.5 font-mono text-xs"
                  />
                  <button type="button" onClick={() => setManualCopyUrl(null)} className="text-sm font-semibold text-trail">
                    Đóng
                  </button>
                </div>
              </div>
            )}

            {photosError && (
              <p role="alert" className="mb-5 border-l-2 border-clay pl-3 text-sm text-clay">{photosError}</p>
            )}

            {loadingPhotos || (loadingAlbums && albums.length === 0) ? (
              <p role="status" className="flex items-center gap-2 py-16 text-sm text-ink/60">
                <Spinner className="h-4 w-4" /> Đang tải ảnh…
              </p>
            ) : displayPhotos.length === 0 ? (
              <div className="py-16">
                <p className="font-semibold">
                  {isSearchActive ? 'Không thấy ảnh nào khớp với khuôn mặt của bạn.' : 'Album này chưa có ảnh.'}
                </p>
                <p className="mt-1 max-w-md text-sm text-ink/60">
                  {isSearchActive
                    ? (isCurrentlyProcessing
                        ? 'Album vẫn đang xử lý các ảnh còn lại, bạn thử lại sau ít phút nhé.'
                        : 'Thử một ảnh chân dung khác rõ mặt hơn, đủ sáng và không bị che.')
                    : 'Ban tổ chức đang chuẩn bị ảnh cho album này. Bạn quay lại sau nhé.'}
                </p>
              </div>
            ) : (
              <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 xl:grid-cols-4">
                {displayPhotos.map((photo, index) => {
                  const photoSrc = photo.thumbnail_url || photo.preview_url
                  const altText = photo.filename || `Ảnh sự kiện số ${index + 1}`
                  return (
                    <li key={photo.id} className="aspect-square overflow-hidden rounded bg-stone/40">
                      <button
                        ref={(el) => {
                          if (el) triggerButtonRefs.current.set(photo.id, el)
                          else triggerButtonRefs.current.delete(photo.id)
                        }}
                        type="button"
                        onClick={() => openLightbox(index, photo.id)}
                        className="block h-full w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-trail focus-visible:ring-offset-2"
                        aria-label={`Xem ảnh lớn: ${altText}`}
                      >
                        {photoSrc ? (
                          <img
                            src={photoSrc}
                            alt={altText}
                            loading="lazy"
                            onError={() => handleImageError(photo)}
                            className="h-full w-full object-cover transition-opacity hover:opacity-90"
                          />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center text-xs text-ink/40">Đang tạo ảnh xem trước</span>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}

            {((!isSearchActive && photosNextCursor) || (isSearchActive && searchResult?.next_cursor)) && (
              <div className="mt-8 flex justify-center">
                <button
                  type="button"
                  onClick={isSearchActive ? handleLoadMoreSearchResults : handleLoadMorePhotos}
                  disabled={loadingMorePhotos || isLoadingMoreSearch}
                  className="inline-flex items-center gap-2 rounded-md border border-stone bg-white px-5 py-2 text-sm font-semibold transition hover:border-ink/30 disabled:opacity-50"
                >
                  {loadingMorePhotos || isLoadingMoreSearch ? <><Spinner className="h-4 w-4" /><span>Đang tải…</span></> : 'Tải thêm ảnh'}
                </button>
              </div>
            )}
          </section>
        </div>
      </main>

      {activePhoto && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Chi tiết ảnh ${activePhoto.filename || ''}`}
          className="fixed inset-0 z-50 flex flex-col bg-[#101714]/95"
        >
          <div className="flex items-center justify-between gap-3 px-4 py-3 text-white sm:px-6">
            <p className="min-w-0 truncate text-sm">
              <span className="font-semibold">{activePhoto.filename || 'Ảnh sự kiện'}</span>
              <span className="ml-2 text-white/50">{activePhotoIndex + 1} / {displayPhotos.length}</span>
            </p>
            <div className="flex shrink-0 items-center gap-1 text-sm">
              {activePhoto.share_url && (
                <>
                  <button
                    type="button"
                    onClick={() => handleCopyShareLink(activePhoto.share_url)}
                    className="hidden rounded px-2.5 py-1.5 text-white/80 hover:bg-white/10 hover:text-white sm:block"
                  >
                    Sao chép link
                  </button>
                  <a
                    href={activePhoto.share_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hidden rounded px-2.5 py-1.5 text-white/80 hover:bg-white/10 hover:text-white sm:block"
                  >
                    Mở trên Drive
                  </a>
                </>
              )}
              {activePhoto.download_url && (
                <a
                  href={activePhoto.download_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  download={activePhoto.filename || true}
                  className="rounded bg-white px-3 py-1.5 font-semibold text-ink hover:bg-white/90"
                >
                  Tải ảnh gốc
                </a>
              )}
              <button
                type="button"
                onClick={closeLightbox}
                aria-label="Đóng (Esc)"
                className="ml-1 rounded p-1.5 text-white/80 hover:bg-white/10 hover:text-white"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-4 sm:px-16">
            {displayPhotos.length > 1 && (
              <button
                type="button"
                onClick={() => setActivePhotoIndex((prev) => (prev > 0 ? prev - 1 : displayPhotos.length - 1))}
                aria-label="Ảnh trước"
                className="absolute left-2 z-10 flex h-10 w-10 items-center justify-center rounded-full text-2xl text-white/70 hover:bg-white/10 hover:text-white sm:left-4"
              >
                ‹
              </button>
            )}
            <img
              src={activePhoto.preview_url || activePhoto.thumbnail_url}
              onError={() => handleImageError(activePhoto)}
              alt={activePhoto.filename || 'Ảnh sự kiện kích thước lớn'}
              className="max-h-full max-w-full object-contain"
            />
            {displayPhotos.length > 1 && (
              <button
                type="button"
                onClick={() => setActivePhotoIndex((prev) => (prev < displayPhotos.length - 1 ? prev + 1 : 0))}
                aria-label="Ảnh tiếp theo"
                className="absolute right-2 z-10 flex h-10 w-10 items-center justify-center rounded-full text-2xl text-white/70 hover:bg-white/10 hover:text-white sm:right-4"
              >
                ›
              </button>
            )}
          </div>
        </div>
      )}

      <SiteFooter />
    </div>
  )
}

function Spinner({ className = '' }) {
  return (
    <svg className={`animate-spin ${className}`} fill="none" viewBox="0 0 24 24" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}
