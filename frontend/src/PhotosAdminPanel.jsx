import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createAdminAlbum,
  getAdminAlbumPhotos,
  getAdminLoadedPhotoPages,
  copyTextToClipboard,
  getPhotoErrorMessage,
  isAlbumProcessing,
  listAdminAlbums,
  mergePhotoList,
  removePhotoFromGallery,
  retryAlbumProcessing,
  retryPhotoProcessing,
  triggerDriveImport,
  updateAdminAlbum,
} from './photoGalleryApi.js'
import { Badge, CARD } from './ui.jsx'
import { createPhotoRequestSlot, hasCompletedPhotoIndex, hasPhotoFailure } from './photoGalleryRequests.js'

const FIELD_CLASS =
  'w-full rounded-lg border border-stone bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10'
const LABEL_CLASS = 'mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40'
const PRIMARY_BTN =
  'inline-flex items-center justify-center gap-1.5 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-[0.9] disabled:cursor-not-allowed disabled:opacity-40'
const SECONDARY_BTN =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-stone bg-white px-3 py-2 text-sm font-semibold text-ink/70 transition hover:bg-paper disabled:cursor-not-allowed disabled:opacity-40'
const DANGER_BTN =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-clay/30 bg-white px-3 py-2 text-sm font-semibold text-clay transition hover:bg-clay/5 disabled:cursor-not-allowed disabled:opacity-40'

const STATUS_BADGES = {
  draft: { label: 'Bản nháp', cls: 'bg-ink/[0.07] text-ink/60' },
  published: { label: 'Đã xuất bản', cls: 'bg-trail/15 text-trail font-bold' },
  hidden: { label: 'Đang ẩn', cls: 'bg-gold/15 text-[#9A6B12]' },
}

const IMPORT_STATUS_LABELS = {
  idle: { label: 'Chưa quét', cls: 'text-ink/50' },
  queued: { label: 'Đang xếp hàng...', cls: 'text-gold font-semibold animate-pulse' },
  scanning: { label: 'Đang quét & xử lý...', cls: 'text-trail font-semibold animate-pulse' },
  complete: { label: 'Hoàn tất', cls: 'text-trail font-medium' },
  failed: { label: 'Quét thất bại', cls: 'text-clay font-medium' },
}

export default function PhotosAdminPanel() {
  // Albums list state
  const [albums, setAlbums] = useState([])
  const [albumsCursor, setAlbumsCursor] = useState(null)
  const [loadingAlbums, setLoadingAlbums] = useState(true)
  const [loadingMoreAlbums, setLoadingMoreAlbums] = useState(false)
  const [albumsError, setAlbumsError] = useState('')

  // Selected album details & photos state
  const [selectedAlbum, setSelectedAlbum] = useState(null)
  const [photos, setPhotos] = useState([])
  const [photosCursor, setPhotosCursor] = useState(null)
  const [loadingPhotos, setLoadingPhotos] = useState(false)
  const [loadingMorePhotos, setLoadingMorePhotos] = useState(false)
  const [photosError, setPhotosError] = useState('')
  const [photoFilter, setPhotoFilter] = useState('all') // 'all' | 'failed' | 'indexed' | 'no_faces'

  // Modal states
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newDriveUrl, setNewDriveUrl] = useState('')
  const [driveServiceEmail, setDriveServiceEmail] = useState('')
  const [emailCopied, setEmailCopied] = useState(false)
  const [creatingAlbum, setCreatingAlbum] = useState(false)
  const [createError, setCreateError] = useState('')

  const [isEditOpen, setIsEditOpen] = useState(false)
  const [editingTitle, setEditingTitle] = useState('')
  const [editingDescription, setEditingDescription] = useState('')
  const [editingStatus, setEditingStatus] = useState('draft')
  const [savingAlbum, setSavingAlbum] = useState(false)
  const [editError, setEditError] = useState('')

  // Confirmation modal for removing photo
  const [photoToRemove, setPhotoToRemove] = useState(null)
  const [removingPhoto, setRemovingPhoto] = useState(false)
  const [removeError, setRemoveError] = useState('')

  // Action loading states
  const [syncingAlbumId, setSyncingAlbumId] = useState(null)
  const [retryingAlbumId, setRetryingAlbumId] = useState(null)
  const [retryingPhotoId, setRetryingPhotoId] = useState(null)
  const [actionSuccessMessage, setActionSuccessMessage] = useState('')

  // Polling guard refs
  const [photoRequests] = useState(createPhotoRequestSlot)
  const selectedAlbumIdRef = useRef(null)
  const loadedPageCountRef = useRef(1)

  const selectAlbum = useCallback((album) => {
    if (selectedAlbumIdRef.current === album?.id) return
    photoRequests.cancel()
    selectedAlbumIdRef.current = album?.id ?? null
    loadedPageCountRef.current = 1
    setPhotos([])
    setPhotosCursor(null)
    setPhotosError('')
    setLoadingMorePhotos(false)
    setPhotoFilter('all')
    setSelectedAlbum(album)
  }, [photoRequests])

  // Fetch albums list
  const fetchAlbums = useCallback(async () => {
    setLoadingAlbums(true)
    setAlbumsError('')
    try {
      const data = await listAdminAlbums()
      const list = Array.isArray(data?.albums) ? data.albums : []
      setAlbums(list)
      setAlbumsCursor(data?.next_cursor ?? null)
      setDriveServiceEmail(data?.drive_service_email || '')
    } catch (err) {
      setAlbumsError(getPhotoErrorMessage(err, 'Không thể tải danh sách album quản trị.'))
    } finally {
      setLoadingAlbums(false)
    }
  }, [])

  useEffect(() => {
    fetchAlbums()
  }, [fetchAlbums])

  // Load more albums
  const handleLoadMoreAlbums = async () => {
    if (!albumsCursor || loadingMoreAlbums) return
    setLoadingMoreAlbums(true)
    try {
      const data = await listAdminAlbums({ cursor: albumsCursor })
      setAlbums((prev) => {
        const seen = new Set(prev.map((a) => a.id))
        const added = (data?.albums || []).filter((a) => !seen.has(a.id))
        return [...prev, ...added]
      })
      setAlbumsCursor(data?.next_cursor ?? null)
    } catch (err) {
      setAlbumsError(getPhotoErrorMessage(err, 'Không thể tải thêm album.'))
    } finally {
      setLoadingMoreAlbums(false)
    }
  }

  // Fetch photos for selected album
  const fetchSelectedAlbumPhotos = useCallback(async (albumId, isSilentPoll = false) => {
    if (!albumId || selectedAlbumIdRef.current !== albumId) return
    if (isSilentPoll && photoRequests.pending) return
    const request = photoRequests.start()
    setLoadingMorePhotos(false)
    if (!isSilentPoll) {
      setLoadingPhotos(true)
      setPhotosError('')
    }
    try {
      const data = await getAdminLoadedPhotoPages(albumId, {
        pageCount: loadedPageCountRef.current,
        signal: request.signal,
      })
      if (!request.isCurrent() || selectedAlbumIdRef.current !== albumId) return
      loadedPageCountRef.current = data.pageCount
      if (data?.album) {
        setSelectedAlbum(data.album)
        // Also update the album in the main list
        setAlbums((prev) => prev.map((a) => (a.id === data.album.id ? { ...a, ...data.album } : a)))
      }
      setPhotos(Array.isArray(data?.photos) ? data.photos : [])
      setPhotosCursor(data?.next_cursor ?? null)
    } catch (err) {
      if (!request.isCurrent() || err.name === 'AbortError') return
      if (!isSilentPoll) {
        setPhotosError(getPhotoErrorMessage(err, 'Không thể tải danh sách ảnh.'))
      }
    } finally {
      if (request.isCurrent() && !isSilentPoll) {
        setLoadingPhotos(false)
      }
      request.finish()
    }
  }, [photoRequests])

  // When selectedAlbum changes
  useEffect(() => {
    if (selectedAlbum?.id) {
      fetchSelectedAlbumPhotos(selectedAlbum.id)
    } else {
      setPhotos([])
      setPhotosCursor(null)
    }
    return () => photoRequests.cancel()
  }, [selectedAlbum?.id, fetchSelectedAlbumPhotos, photoRequests])

  // Keep polling independent of count refreshes. The shared request slot also
  // prevents a poll from racing initial loads, pagination, or manual refresh.
  const albumNeedsPoll = Boolean(selectedAlbum && isAlbumProcessing(selectedAlbum))
  const selectedAlbumId = selectedAlbum?.id
  useEffect(() => {
    if (!albumNeedsPoll) return

    const poll = async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return // Pause polling when tab is hidden
      }
      await fetchSelectedAlbumPhotos(selectedAlbumId, true)
    }

    const timer = setInterval(poll, 5000)

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Immediate poll upon becoming visible
        poll()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [albumNeedsPoll, selectedAlbumId, fetchSelectedAlbumPhotos])

  // Load more photos in selected album
  const handleLoadMorePhotos = async () => {
    if (!selectedAlbum?.id || !photosCursor || loadingMorePhotos) return
    const albumId = selectedAlbum.id
    const request = photoRequests.start()
    setLoadingMorePhotos(true)
    try {
      const data = await getAdminAlbumPhotos(albumId, { cursor: photosCursor, signal: request.signal })
      if (!request.isCurrent() || selectedAlbumIdRef.current !== albumId) return
      loadedPageCountRef.current += 1
      if (data?.album) {
        setSelectedAlbum(data.album)
      }
      setPhotos((prev) => mergePhotoList(prev, data?.photos || []))
      setPhotosCursor(data?.next_cursor ?? null)
    } catch (err) {
      if (!request.isCurrent() || err.name === 'AbortError') return
      setPhotosError(getPhotoErrorMessage(err, 'Không thể tải thêm ảnh.'))
    } finally {
      if (request.isCurrent()) setLoadingMorePhotos(false)
      request.finish()
    }
  }

  // Create Album Action
  const handleCreateAlbum = async (e) => {
    e.preventDefault()
    if (!newTitle.trim() || !newDriveUrl.trim() || creatingAlbum) return

    setCreatingAlbum(true)
    setCreateError('')
    try {
      const res = await createAdminAlbum({
        title: newTitle.trim(),
        description: newDescription.trim(),
        drive_folder_url: newDriveUrl.trim(),
      })
      const created = res?.album
      if (created) {
        setAlbums((prev) => [created, ...prev])
        selectAlbum(created)
      }
      setIsCreateOpen(false)
      setNewTitle('')
      setNewDescription('')
      setNewDriveUrl('')
      setActionSuccessMessage('Tạo album thành công và đã bắt đầu lên lịch nhập ảnh.')
    } catch (err) {
      setCreateError(getPhotoErrorMessage(err, 'Không thể tạo album mới.'))
    } finally {
      setCreatingAlbum(false)
    }
  }

  // Edit Album Action
  const handleOpenEdit = (album) => {
    setEditingTitle(album.title)
    setEditingDescription(album.description || '')
    setEditingStatus(album.status)
    setEditError('')
    setIsEditOpen(true)
  }

  const handleSaveEdit = async (e) => {
    e.preventDefault()
    if (!selectedAlbum || savingAlbum) return

    setSavingAlbum(true)
    setEditError('')
    try {
      const res = await updateAdminAlbum(selectedAlbum.id, {
        title: editingTitle.trim(),
        description: editingDescription.trim(),
        status: editingStatus,
      })
      const updated = res?.album
      if (updated) {
        setSelectedAlbum((current) => current?.id === updated.id ? updated : current)
        setAlbums((prev) => prev.map((a) => (a.id === updated.id ? updated : a)))
      }
      setIsEditOpen(false)
      setActionSuccessMessage('Cập nhật thông tin album thành công.')
    } catch (err) {
      setEditError(getPhotoErrorMessage(err, 'Không thể lưu thay đổi album.'))
    } finally {
      setSavingAlbum(false)
    }
  }

  // Trigger Drive Re-sync
  const handleTriggerSync = async (albumId) => {
    if (syncingAlbumId) return
    setSyncingAlbumId(albumId)
    try {
      const res = await triggerDriveImport(albumId)
      if (res?.album) {
        setAlbums((prev) => prev.map((a) => (a.id === res.album.id ? res.album : a)))
        setSelectedAlbum((current) => current?.id === albumId ? res.album : current)
      }
      setActionSuccessMessage('Đã yêu cầu đồng bộ lại từ Google Drive.')
    } catch (err) {
      setActionSuccessMessage(getPhotoErrorMessage(err, 'Đồng bộ thất bại.'))
    } finally {
      setSyncingAlbumId(null)
    }
  }

  // Retry Album processing
  const handleRetryAlbum = async (albumId) => {
    if (retryingAlbumId) return
    setRetryingAlbumId(albumId)
    try {
      const res = await retryAlbumProcessing(albumId)
      setActionSuccessMessage(`Đã xếp hàng thử lại ${res?.queued ?? 0} ảnh lỗi.`)
      // Refresh photos
      if (selectedAlbumIdRef.current === albumId) {
        fetchSelectedAlbumPhotos(albumId)
      }
    } catch (err) {
      setActionSuccessMessage(getPhotoErrorMessage(err, 'Thử lại ảnh lỗi không thành công.'))
    } finally {
      setRetryingAlbumId(null)
    }
  }

  // Retry single photo
  const handleRetryPhoto = async (photoId) => {
    if (retryingPhotoId) return
    const albumId = selectedAlbumIdRef.current
    setRetryingPhotoId(photoId)
    try {
      await retryPhotoProcessing(photoId)
      setActionSuccessMessage('Đã xếp hàng thử lại ảnh này.')
      // Refresh authoritative counters as well, so retry restarts polling.
      await fetchSelectedAlbumPhotos(albumId)
    } catch (err) {
      setActionSuccessMessage(getPhotoErrorMessage(err, 'Không thể thử lại ảnh này.'))
    } finally {
      setRetryingPhotoId(null)
    }
  }

  // Remove photo from gallery
  const handleConfirmRemovePhoto = async () => {
    if (!photoToRemove || removingPhoto) return
    setRemovingPhoto(true)
    setRemoveError('')
    try {
      await removePhotoFromGallery(photoToRemove.id)
      setPhotos((prev) => prev.filter((p) => p.id !== photoToRemove.id))
      await fetchSelectedAlbumPhotos(photoToRemove.album_id)
      setPhotoToRemove(null)
      setActionSuccessMessage('Đã gỡ ảnh khỏi thư viện thành công.')
    } catch (err) {
      setRemoveError(getPhotoErrorMessage(err, 'Không thể gỡ ảnh.'))
    } finally {
      setRemovingPhoto(false)
    }
  }

  // Clear toast status message after delay
  useEffect(() => {
    if (!actionSuccessMessage) return
    const t = setTimeout(() => setActionSuccessMessage(''), 4000)
    return () => clearTimeout(t)
  }, [actionSuccessMessage])

  // Filter photos
  const filteredPhotos = photos.filter((p) => {
    if (photoFilter === 'failed') return hasPhotoFailure(p)
    if (photoFilter === 'indexed') return hasCompletedPhotoIndex(p) && (p.face_count || 0) > 0
    if (photoFilter === 'no_faces') return hasCompletedPhotoIndex(p) && (p.face_count || 0) === 0
    return true
  })

  return (
    <div className="space-y-6">
      {/* Toast Alert */}
      {actionSuccessMessage && (
        <div
          role="status"
          className="rounded-xl border border-trail/30 bg-trail/10 px-4 py-3 text-sm font-semibold text-trail shadow-sm"
        >
          {actionSuccessMessage}
        </div>
      )}

      {/* Main Top Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            Quản Lý Ảnh Sự Kiện
          </h1>
          <p className="mt-1 text-xs text-ink/70 sm:text-sm">
            Tạo album từ Google Drive, theo dõi tiến độ xử lý AI và xuất bản thư viện ảnh công khai.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setCreateError('')
            setIsCreateOpen(true)
          }}
          className={PRIMARY_BTN}
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          <span>Tạo album mới</span>
        </button>
      </div>

      {albumsError && (
        <div className="rounded-xl border border-clay/30 bg-clay/10 p-4 text-sm font-medium text-clay">
          {albumsError}
        </div>
      )}

      {/* Album Selector Cards / Table */}
      <div className={`${CARD} overflow-hidden p-5`}>
        <h2 className="font-display text-base font-bold text-ink mb-4">Danh Sách Album ({albums.length})</h2>

        {loadingAlbums ? (
          <div className="py-12 text-center text-sm text-ink/60">Đang tải danh sách album...</div>
        ) : albums.length === 0 ? (
          <div className="py-12 text-center text-sm text-ink/60">
            Chưa có album nào. Bấm nút “Tạo album mới” phía trên để liên kết thư mục Google Drive.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {albums.map((alb) => {
              const isSelected = selectedAlbum?.id === alb.id
              const counts = alb.counts || {}
              const isSyncing = syncingAlbumId === alb.id
              const isProcessing = isAlbumProcessing(alb)

              return (
                <div
                  key={alb.id}
                  className={`flex flex-col justify-between rounded-xl border p-4 transition ${
                    isSelected
                      ? 'border-trail bg-trail/[0.03] shadow-sm ring-1 ring-trail'
                      : 'border-stone bg-white hover:border-ink/20'
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-display text-base font-bold text-ink">{alb.title}</h3>
                          <Badge
                            label={STATUS_BADGES[alb.status]?.label || alb.status}
                            cls={STATUS_BADGES[alb.status]?.cls || 'bg-paper text-ink'}
                          />
                        </div>
                        {alb.description && <p className="mt-1 text-xs text-ink/70">{alb.description}</p>}
                      </div>

                      {alb.status === 'published' && (
                        <a
                          href={`/photos?album=${alb.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 rounded-lg border border-stone bg-paper px-2.5 py-1 text-xs font-semibold text-trail transition hover:bg-stone/50"
                        >
                          Xem gallery ↗
                        </a>
                      )}
                    </div>

                    {/* Google Drive Folder link */}
                    {alb.drive_folder_url && (
                      <div className="flex items-center gap-1.5 text-xs text-ink/60">
                        <span className="font-mono text-[10px] uppercase text-ink/40">Folder Drive:</span>
                        <a
                          href={alb.drive_folder_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="truncate text-trail hover:underline"
                        >
                          {alb.drive_folder_url}
                        </a>
                      </div>
                    )}

                    {/* Counts Breakdown */}
                    <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-paper/60 p-2 text-xs sm:grid-cols-4">
                      <div>
                        <span className="text-ink/50">Tổng ảnh:</span>{' '}
                        <strong className="text-ink">{counts.total || 0}</strong>
                      </div>
                      <div>
                        <span className="text-ink/50">Sẵn sàng:</span>{' '}
                        <strong className="text-trail">{counts.ready || 0}</strong>
                      </div>
                      <div>
                        <span className="text-ink/50">Đang xử lý:</span>{' '}
                        <strong className="text-gold">{(counts.pending || 0) + (counts.processing || 0)}</strong>
                      </div>
                      <div>
                        <span className="text-ink/50">Ảnh lỗi:</span>{' '}
                        <strong className="text-clay">{(counts.failed || 0) + (counts.indexing_failed || 0)}</strong>
                      </div>
                    </div>

                    {/* Import status */}
                    <div className="flex items-center justify-between text-xs pt-1">
                      <span className="text-ink/60">
                        Trạng thái quét:{' '}
                        <span className={IMPORT_STATUS_LABELS[alb.import_status]?.cls || 'text-ink/70'}>
                          {IMPORT_STATUS_LABELS[alb.import_status]?.label || alb.import_status || 'idle'}
                        </span>
                      </span>
                      {alb.import_error && (
                        <span className="text-clay text-xs" title={alb.import_error}>
                          Lỗi: {getPhotoErrorMessage(alb.import_error)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions Bar */}
                  <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-stone/50 pt-3">
                    <button
                      type="button"
                      onClick={() => handleTriggerSync(alb.id)}
                      disabled={isSyncing || isProcessing}
                      className={SECONDARY_BTN}
                      title="Quét lại Google Drive để cập nhật ảnh mới hoặc đã thay đổi"
                    >
                      {isSyncing ? 'Đang đồng bộ...' : 'Đồng bộ lại'}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        selectAlbum(alb)
                        handleOpenEdit(alb)
                      }}
                      className={SECONDARY_BTN}
                    >
                      Sửa thông tin
                    </button>

                    <button
                      type="button"
                      onClick={() => selectAlbum(alb)}
                      className={isSelected ? PRIMARY_BTN : SECONDARY_BTN}
                    >
                      {isSelected ? 'Đang xem ảnh' : 'Xem & Quản lý ảnh'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {albumsCursor && (
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              onClick={handleLoadMoreAlbums}
              disabled={loadingMoreAlbums}
              className={SECONDARY_BTN}
            >
              {loadingMoreAlbums ? 'Đang tải thêm...' : 'Tải thêm album'}
            </button>
          </div>
        )}
      </div>

      {/* Selected Album Photo Management Section */}
      {selectedAlbum && (
        <div className={`${CARD} p-5 space-y-5`}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-stone pb-4">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-display text-lg font-bold text-ink">
                  Chi Tiết Album: {selectedAlbum.title}
                </h2>
                <Badge
                  label={STATUS_BADGES[selectedAlbum.status]?.label || selectedAlbum.status}
                  cls={STATUS_BADGES[selectedAlbum.status]?.cls || ''}
                />
              </div>
              <p className="text-xs text-ink/70 mt-0.5">
                Hiển thị {photos.length} ảnh trong album này
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {((selectedAlbum.counts?.failed || 0) + (selectedAlbum.counts?.indexing_failed || 0)) > 0 && (
                <button
                  type="button"
                  onClick={() => handleRetryAlbum(selectedAlbum.id)}
                  disabled={retryingAlbumId === selectedAlbum.id}
                  className={DANGER_BTN}
                >
                  {retryingAlbumId === selectedAlbum.id ? 'Đang gửi...' : 'Thử lại tất cả ảnh lỗi'}
                </button>
              )}

              <button
                type="button"
                onClick={() => handleTriggerSync(selectedAlbum.id)}
                disabled={syncingAlbumId === selectedAlbum.id}
                className={SECONDARY_BTN}
              >
                Đồng bộ lại từ Drive
              </button>

              <button
                type="button"
                onClick={() => handleOpenEdit(selectedAlbum)}
                className={SECONDARY_BTN}
              >
                Đổi trạng thái / Sửa
              </button>
            </div>
          </div>

          {/* Counts statistics details */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8 rounded-xl bg-paper/70 p-3 text-xs">
            <div>
              <span className="text-ink/50">Tổng số:</span>{' '}
              <span className="font-bold text-ink">{selectedAlbum.counts?.total || 0}</span>
            </div>
            <div>
              <span className="text-ink/50">Sẵn sàng:</span>{' '}
              <span className="font-bold text-trail">{selectedAlbum.counts?.ready || 0}</span>
            </div>
            <div>
              <span className="text-ink/50">Đã index AI:</span>{' '}
              <span className="font-bold text-trail">{selectedAlbum.counts?.indexed || 0}</span>
            </div>
            <div>
              <span className="text-ink/50">Không có mặt:</span>{' '}
              <span className="font-bold text-ink/70">{selectedAlbum.counts?.no_faces || 0}</span>
            </div>
            <div>
              <span className="text-ink/50">Đang xử lý:</span>{' '}
              <span className="font-bold text-gold">
                {(selectedAlbum.counts?.pending || 0) + (selectedAlbum.counts?.processing || 0)}
              </span>
            </div>
            <div>
              <span className="text-ink/50">Lỗi ảnh:</span>{' '}
              <span className="font-bold text-clay">{selectedAlbum.counts?.failed || 0}</span>
            </div>
            <div>
              <span className="text-ink/50">Lỗi AI:</span>{' '}
              <span className="font-bold text-clay">{selectedAlbum.counts?.indexing_failed || 0}</span>
            </div>
            <div>
              <span className="text-ink/50">Đã gỡ:</span>{' '}
              <span className="font-bold text-ink/50">{selectedAlbum.counts?.removed || 0}</span>
            </div>
          </div>

          {/* Filter tabs */}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setPhotoFilter('all')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                photoFilter === 'all'
                  ? 'bg-ink text-white'
                  : 'border border-stone bg-white text-ink/70 hover:bg-paper'
              }`}
            >
              Tất cả ({photos.length})
            </button>
            <button
              type="button"
              onClick={() => setPhotoFilter('failed')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                photoFilter === 'failed'
                  ? 'bg-clay text-white'
                  : 'border border-stone bg-white text-clay hover:bg-clay/5'
              }`}
            >
              Ảnh lỗi ({photos.filter(hasPhotoFailure).length})
            </button>
            <button
              type="button"
              onClick={() => setPhotoFilter('indexed')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                photoFilter === 'indexed'
                  ? 'bg-trail text-white'
                  : 'border border-stone bg-white text-ink/70 hover:bg-paper'
              }`}
            >
              Có khuôn mặt ({photos.filter((p) => hasCompletedPhotoIndex(p) && (p.face_count || 0) > 0).length})
            </button>
            <button
              type="button"
              onClick={() => setPhotoFilter('no_faces')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                photoFilter === 'no_faces'
                  ? 'bg-ink text-white'
                  : 'border border-stone bg-white text-ink/70 hover:bg-paper'
              }`}
            >
              Không có mặt ({photos.filter((p) => hasCompletedPhotoIndex(p) && (p.face_count || 0) === 0).length})
            </button>
          </div>

          {photosError && (
            <div className="rounded-xl border border-clay/30 bg-clay/10 p-3 text-xs font-medium text-clay">
              {photosError}
            </div>
          )}

          {/* Photos Grid */}
          {loadingPhotos ? (
            <div className="py-16 text-center text-xs text-ink/60">Đang tải ảnh của album...</div>
          ) : filteredPhotos.length === 0 ? (
            <div className="rounded-xl border border-dashed border-stone p-8 text-center text-xs text-ink/50">
              Không có ảnh nào khớp với bộ lọc hiện tại.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 sm:gap-4">
              {filteredPhotos.map((photo) => {
                const isFailed = hasPhotoFailure(photo)
                const errorCode = photo.error || photo.indexing_error
                const isRetrying = retryingPhotoId === photo.id

                return (
                  <div
                    key={photo.id}
                    className="flex flex-col justify-between overflow-hidden rounded-xl border border-stone bg-white shadow-sm"
                  >
                    <div className="relative aspect-square w-full overflow-hidden bg-paper">
                      {photo.thumbnail_url || photo.preview_url ? (
                        <img
                          src={photo.thumbnail_url || photo.preview_url}
                          alt={photo.filename}
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center p-2 text-center text-[10px] text-ink/40">
                          {isFailed ? 'Không thể tạo preview' : 'Đang xử lý preview...'}
                        </div>
                      )}

                      {/* Status chip overlay */}
                      <div className="absolute left-1.5 top-1.5">
                        {isFailed ? (
                          <span className="rounded bg-clay/90 px-1.5 py-0.5 text-[10px] font-bold text-white">
                            {photo.indexing_error ? 'Lỗi AI · vẫn xem được' : 'Lỗi ảnh'}
                          </span>
                        ) : photo.status === 'ready' ? (
                          <span className="rounded bg-trail/90 px-1.5 py-0.5 text-[10px] font-bold text-white">
                            {photo.face_count > 0 ? `${photo.face_count} mặt` : '0 mặt'}
                          </span>
                        ) : (
                          <span className="rounded bg-gold/90 px-1.5 py-0.5 text-[10px] font-bold text-white">
                            Đang xử lý
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="p-2 space-y-1">
                      <p className="truncate font-mono text-[11px] font-medium text-ink" title={photo.filename}>
                        {photo.filename}
                      </p>

                      {isFailed && errorCode && (
                        <p className="text-[10px] text-clay line-clamp-2" title={getPhotoErrorMessage(errorCode)}>
                          {getPhotoErrorMessage(errorCode)}
                        </p>
                      )}

                      <div className="flex items-center justify-between gap-1 pt-1 border-t border-stone/50">
                        {isFailed ? (
                          <button
                            type="button"
                            onClick={() => handleRetryPhoto(photo.id)}
                            disabled={isRetrying}
                            className="text-[11px] font-semibold text-trail hover:underline"
                          >
                            {isRetrying ? 'Đang gửi...' : 'Thử lại'}
                          </button>
                        ) : (
                          <span className="text-[10px] text-ink/40">ID #{photo.id}</span>
                        )}

                        <button
                          type="button"
                          onClick={() => {
                            setRemoveError('')
                            setPhotoToRemove(photo)
                          }}
                          className="text-[11px] font-semibold text-clay hover:underline"
                        >
                          Gỡ ảnh
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {photosCursor && (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                onClick={handleLoadMorePhotos}
                disabled={loadingMorePhotos}
                className={SECONDARY_BTN}
              >
                {loadingMorePhotos ? 'Đang tải thêm...' : 'Tải thêm ảnh'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Create Album Modal */}
      {isCreateOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-album-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4 backdrop-blur-sm"
        >
          <div className="w-full max-w-lg rounded-2xl border border-stone bg-white p-6 shadow-xl">
            <h3 id="create-album-title" className="font-display text-lg font-bold text-ink">
              Tạo Album Mới từ Google Drive
            </h3>
            <p className="mt-1 text-xs text-ink/60">
              Nhập liên kết thư mục Google Drive chứa ảnh sự kiện. Hệ thống sẽ quét và nạp ảnh nền.
            </p>

            <form onSubmit={handleCreateAlbum} className="mt-4 space-y-4">
              <div>
                <label className={LABEL_CLASS}>Tên album *</label>
                <input
                  type="text"
                  required
                  placeholder="VD: Lễ Ra Quân VNUTour 2026"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className={FIELD_CLASS}
                />
              </div>

              <div>
                <label className={LABEL_CLASS}>Mô tả (tùy chọn)</label>
                <textarea
                  rows={2}
                  placeholder="Ghi chú về thời gian, địa điểm, sự kiện..."
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  className={FIELD_CLASS}
                />
              </div>

              <div>
                <label className={LABEL_CLASS}>Đường dẫn thư mục Google Drive *</label>
                <input
                  type="url"
                  required
                  placeholder="https://drive.google.com/drive/folders/..."
                  value={newDriveUrl}
                  onChange={(e) => setNewDriveUrl(e.target.value)}
                  className={FIELD_CLASS}
                />
                {driveServiceEmail ? (
                  <div className="mt-2 rounded-lg border border-stone bg-paper/60 p-2.5 text-[11px] text-ink/70">
                    <p>
                      Trên Google Drive, chia sẻ thư mục (quyền <strong>Người xem</strong>) cho email hệ thống bên dưới.
                      Thư mục chỉ nên chứa ảnh JPEG, PNG hoặc WebP; ảnh RAW và thư mục con sẽ bị bỏ qua.
                    </p>
                    <div className="mt-1.5 flex items-center gap-2">
                      <code className="min-w-0 flex-1 truncate rounded bg-white px-2 py-1 font-mono text-[11px] text-ink">
                        {driveServiceEmail}
                      </code>
                      <button
                        type="button"
                        onClick={async () => {
                          if (await copyTextToClipboard(driveServiceEmail)) {
                            setEmailCopied(true)
                            setTimeout(() => setEmailCopied(false), 2000)
                          }
                        }}
                        className="shrink-0 rounded-md border border-stone bg-white px-2 py-1 text-[11px] font-semibold text-ink transition hover:bg-paper"
                      >
                        {emailCopied ? 'Đã sao chép' : 'Sao chép'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-1 text-[11px] text-ink/50">
                    Đảm bảo thư mục Google Drive đã được cấp quyền đọc cho tài khoản hệ thống VNUTour.
                    Thư mục chỉ nên chứa ảnh JPEG, PNG hoặc WebP.
                  </p>
                )}
              </div>

              {createError && (
                <div className="rounded-lg border border-clay/30 bg-clay/10 p-3 text-xs text-clay">
                  {createError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  disabled={creatingAlbum}
                  className={SECONDARY_BTN}
                >
                  Hủy
                </button>
                <button type="submit" disabled={creatingAlbum} className={PRIMARY_BTN}>
                  {creatingAlbum ? 'Đang tạo...' : 'Tạo album & Bắt đầu quét'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Album Modal */}
      {isEditOpen && selectedAlbum && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-album-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4 backdrop-blur-sm"
        >
          <div className="w-full max-w-lg rounded-2xl border border-stone bg-white p-6 shadow-xl">
            <h3 id="edit-album-title" className="font-display text-lg font-bold text-ink">
              Cập Nhật Album: {selectedAlbum.title}
            </h3>
            <p className="mt-1 text-xs text-ink/60">
              Đổi tên, mô tả hoặc chuyển trạng thái hiển thị của album này.
            </p>

            <form onSubmit={handleSaveEdit} className="mt-4 space-y-4">
              <div>
                <label className={LABEL_CLASS}>Tên album *</label>
                <input
                  type="text"
                  required
                  value={editingTitle}
                  onChange={(e) => setEditingTitle(e.target.value)}
                  className={FIELD_CLASS}
                />
              </div>

              <div>
                <label className={LABEL_CLASS}>Mô tả</label>
                <textarea
                  rows={2}
                  value={editingDescription}
                  onChange={(e) => setEditingDescription(e.target.value)}
                  className={FIELD_CLASS}
                />
              </div>

              <div>
                <label className={LABEL_CLASS}>Trạng thái album</label>
                <select
                  value={editingStatus}
                  onChange={(e) => setEditingStatus(e.target.value)}
                  className={FIELD_CLASS}
                >
                  <option value="draft">Bản nháp (draft) — chỉ BTC thấy</option>
                  <option value="published">Đã xuất bản (published) — công khai trên gallery</option>
                  <option value="hidden">Đang ẩn (hidden) — tạm ngưng hiển thị công khai</option>
                </select>
                <p className="mt-1 text-[11px] text-ink/50">
                  Lưu ý: Hệ thống không tự động xuất bản sau khi import; BTC toàn quyền chọn thời điểm xuất bản.
                </p>
              </div>

              {editError && (
                <div className="rounded-lg border border-clay/30 bg-clay/10 p-3 text-xs text-clay">
                  {editError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsEditOpen(false)}
                  disabled={savingAlbum}
                  className={SECONDARY_BTN}
                >
                  Hủy
                </button>
                <button type="submit" disabled={savingAlbum} className={PRIMARY_BTN}>
                  {savingAlbum ? 'Đang lưu...' : 'Lưu thay đổi'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Remove Photo Confirmation Dialog */}
      {photoToRemove && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="remove-photo-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4 backdrop-blur-sm"
        >
          <div className="w-full max-w-md rounded-2xl border border-stone bg-white p-6 shadow-xl">
            <h3 id="remove-photo-title" className="font-display text-base font-bold text-clay">
              Xác Nhận Gỡ Ảnh Khỏi Thư Viện
            </h3>
            <p className="mt-2 text-xs text-ink/80">
              Bạn có chắc chắn muốn gỡ ảnh{' '}
              <strong className="font-mono text-ink">{photoToRemove.filename}</strong> khỏi thư viện?
            </p>
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              ℹ️ <strong>Lưu ý:</strong> Thao tác này chỉ gỡ ảnh khỏi thư viện VNUTour và không xóa tệp ảnh gốc trên
              Google Drive của bạn.
            </div>

            {removeError && (
              <div className="mt-3 rounded-lg border border-clay/30 bg-clay/10 p-2 text-xs text-clay">
                {removeError}
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPhotoToRemove(null)}
                disabled={removingPhoto}
                className={SECONDARY_BTN}
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleConfirmRemovePhoto}
                disabled={removingPhoto}
                className="inline-flex items-center justify-center rounded-lg bg-clay px-4 py-2 text-xs font-semibold text-white transition hover:bg-clay/90 disabled:opacity-50"
              >
                {removingPhoto ? 'Đang gỡ...' : 'Xác nhận gỡ ảnh'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
