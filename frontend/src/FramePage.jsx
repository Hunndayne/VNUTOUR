// Public "ghép khung ảnh" (photo frame) editor — the khunghinh.net-style tool.
//
// Anyone (guest or signed-in) picks a frame an admin uploaded, drops in their
// own photo, positions it under the frame, and downloads the composite PNG.
// No account, no auth. See App.jsx's PUBLIC_PATHS for the routing side.
//
// The preview canvas and the export canvas share one draw function
// (`drawComposite`) parameterized by a resolution factor `k`, so what the
// visitor sees is exactly what gets exported — just at a capped preview
// resolution for smooth dragging versus the frame's full resolution on
// download.

import { useCallback, useEffect, useRef, useState } from 'react'
import logoImage from './assets/vnutour-logo.webp'
import { Icon } from './ui.jsx'
import { frameImageUrl, listPublicFrames, logFrameDownload } from './frameApi.js'
import { navigate } from './router.js'
import { TurnstileWidget } from './antibot.jsx'
import { apiRequest } from './api.js'

const PREVIEW_MAX_DIM = 1400 // internal preview canvas cap, in device pixels
const PHOTO_MAX_DIM = 4096 // downsample huge uploads before they ever hit the canvas
const SCALE_MIN = 0.3
const SCALE_MAX = 4

const DEFAULT_TRANSFORM = { scale: 1, rotation: 0, offsetX: 0, offsetY: 0, flipX: false }

const PRIMARY_BUTTON = 'inline-flex items-center justify-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-[0.92] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45'
const SECONDARY_BUTTON = 'inline-flex items-center justify-center gap-2 rounded-lg border border-stone bg-white px-3.5 py-2 text-sm font-semibold text-ink/70 transition hover:bg-paper hover:text-ink disabled:cursor-not-allowed disabled:opacity-45'

const CHECKER_BG = {
  backgroundImage:
    'linear-gradient(45deg, #e2ded0 25%, transparent 25%), linear-gradient(-45deg, #e2ded0 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e2ded0 75%), linear-gradient(-45deg, transparent 75%, #e2ded0 75%)',
  backgroundSize: '20px 20px',
  backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
  backgroundColor: '#f3f4f1',
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

/** Fold any degree value back into (-180, 180], the slider's own range. */
function normalizeAngle(deg) {
  let a = deg % 360
  if (a > 180) a -= 360
  if (a <= -180) a += 360
  return a
}

/** Scale that makes the photo cover the frame's bounding box (may overflow). */
function computeCoverScale(photoW, photoH, frameW, frameH) {
  if (!photoW || !photoH || !frameW || !frameH) return 1
  return Math.max(frameW / photoW, frameH / photoH)
}

/**
 * Draw photo (bottom) + frame (top) onto `ctx`, sized `canvasW`x`canvasH`.
 * `k` converts frame-space pixels (the transform's own unit, independent of
 * output resolution) into canvas pixels — 1 for a full-resolution export,
 * <1 for a downscaled live preview. Anything the photo draws outside the
 * canvas simply isn't part of the image: the frame's bounding box IS the
 * crop viewport.
 */
function drawComposite(ctx, canvasW, canvasH, k, { frameImg, photoSource, transform, frameW, frameH }) {
  ctx.clearRect(0, 0, canvasW, canvasH)

  if (photoSource && frameW && frameH) {
    const photoW = photoSource.naturalWidth || photoSource.width
    const photoH = photoSource.naturalHeight || photoSource.height
    const baseScale = computeCoverScale(photoW, photoH, frameW, frameH)
    const drawW = photoW * baseScale * transform.scale * k
    const drawH = photoH * baseScale * transform.scale * k
    const cx = (frameW / 2 + transform.offsetX) * k
    const cy = (frameH / 2 + transform.offsetY) * k

    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate((transform.rotation * Math.PI) / 180)
    ctx.scale(transform.flipX ? -1 : 1, 1)
    ctx.drawImage(photoSource, -drawW / 2, -drawH / 2, drawW, drawH)
    ctx.restore()
  }

  if (frameImg) {
    ctx.drawImage(frameImg, 0, 0, canvasW, canvasH)
  }
}

/** Load a frame's PNG bytes as a CORS-clean, drawable+exportable <img>. */
function loadFrameImage(frame) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('frame_load_failed'))
    img.src = frameImageUrl(frame.id)
  })
}

/**
 * Decode a visitor's photo file into a drawable source. Huge uploads are
 * downsampled once onto an offscreen canvas so drag/zoom stays smooth; the
 * blob URL is revoked immediately after decode (safe — the pixels are
 * already decoded into the element by the time `onload` fires).
 */
async function loadPhotoFile(file) {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('photo_decode_failed'))
      el.src = url
    })
    const longest = Math.max(img.naturalWidth, img.naturalHeight)
    if (longest > PHOTO_MAX_DIM) {
      const scale = PHOTO_MAX_DIM / longest
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      return canvas
    }
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}

function TopBar() {
  return (
    <header className="border-b border-stone bg-white/80 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="flex items-center gap-2 text-sm font-semibold text-ink/70 transition hover:text-ink"
        >
          <img src={logoImage} alt="VNUTour" className="h-8 w-8 object-contain" />
          <span className="hidden sm:inline">VNUTour</span>
        </button>
        <h1 className="font-display text-sm font-bold uppercase tracking-[0.06em] text-ink sm:text-base">
          Ghép khung ảnh
        </h1>
        <button
          type="button"
          onClick={() => navigate('/')}
          className="text-sm font-semibold text-ink/50 transition hover:text-ink"
        >
          Trang chủ
        </button>
      </div>
    </header>
  )
}

function GallerySection({ frames, loading, error, onRetry, onSelect }) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={`frame-skeleton-${i}`} className="aspect-square animate-pulse rounded-xl border border-stone bg-stone/40" />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-clay/25 bg-clay/[0.04] px-6 py-14 text-center">
        <p className="text-sm font-semibold text-clay">Không tải được danh sách khung ảnh.</p>
        <button type="button" onClick={onRetry} className={SECONDARY_BUTTON}>Thử lại</button>
      </div>
    )
  }

  if (!frames.length) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-stone bg-white px-6 py-16 text-center">
        <p className="text-base font-semibold text-ink/70">Hiện chưa có khung ảnh nào.</p>
        <p className="text-sm text-ink/45">Quay lại sau khi Ban tổ chức thêm khung ảnh mới nhé.</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
      {frames.map((frame) => (
        <button
          key={frame.id}
          type="button"
          onClick={() => onSelect(frame)}
          className="group flex flex-col overflow-hidden rounded-xl border border-stone bg-white text-left shadow-[0_1px_3px_rgba(32,49,43,0.05)] transition hover:-translate-y-0.5 hover:shadow-md"
        >
          <div className="relative aspect-square overflow-hidden" style={CHECKER_BG}>
            <img
              src={frameImageUrl(frame.id)}
              alt={frame.title || 'Khung ảnh'}
              loading="lazy"
              className="h-full w-full object-contain p-2 transition duration-200 group-hover:scale-[1.03]"
            />
          </div>
          <div className="flex flex-1 flex-col gap-1 px-3 py-2.5">
            <p className="line-clamp-1 text-sm font-semibold text-ink">{frame.title || 'Khung ảnh'}</p>
            {frame.description ? (
              <p className="line-clamp-2 text-xs text-ink/50">{frame.description}</p>
            ) : null}
          </div>
        </button>
      ))}
    </div>
  )
}

function FramePage() {
  const [frames, setFrames] = useState([])
  const [loadingFrames, setLoadingFrames] = useState(true)
  const [framesError, setFramesError] = useState('')

  const [selectedFrame, setSelectedFrame] = useState(null)
  const [frameImg, setFrameImg] = useState(null)
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 })
  const [frameLoading, setFrameLoading] = useState(false)
  const [frameError, setFrameError] = useState('')

  const [photoSource, setPhotoSource] = useState(null)
  const [photoError, setPhotoError] = useState('')
  const [transform, setTransform] = useState(DEFAULT_TRANSFORM)

  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState('')

  // Chống bot cho đếm lượt tải (bật từ Cài đặt hệ thống).
  const [antibot, setAntibot] = useState(null)
  const [turnstileToken, setTurnstileToken] = useState('')
  const [turnstileReset, setTurnstileReset] = useState(0)
  const antibotEnabled = Boolean(antibot?.enabled)

  useEffect(() => {
    apiRequest('/public/site-config', { auth: false })
      .then((cfg) => { if (cfg?.antibot?.enabled) setAntibot(cfg.antibot) })
      .catch(() => {})
  }, [])

  const canvasRef = useRef(null)
  const fileInputRef = useRef(null)
  const transformRef = useRef(transform)
  transformRef.current = transform

  const pointersRef = useRef(new Map())
  const dragModeRef = useRef(null)
  const panStartRef = useRef(null)
  const pinchStartRef = useRef(null)

  const loadFrames = useCallback(() => {
    setLoadingFrames(true)
    setFramesError('')
    listPublicFrames()
      .then((list) => setFrames(list))
      .catch(() => setFramesError('load_failed'))
      .finally(() => setLoadingFrames(false))
  }, [])

  useEffect(() => {
    loadFrames()
  }, [loadFrames])

  // Load the frame's PNG whenever a new one is picked (or a retry is asked for).
  useEffect(() => {
    if (!selectedFrame) {
      setFrameImg(null)
      setFrameSize({ width: 0, height: 0 })
      return undefined
    }
    let cancelled = false
    setFrameLoading(true)
    setFrameError('')
    setFrameImg(null)
    loadFrameImage(selectedFrame)
      .then((img) => {
        if (cancelled) return
        setFrameImg(img)
        setFrameSize({
          width: Number(selectedFrame.width) || img.naturalWidth,
          height: Number(selectedFrame.height) || img.naturalHeight,
        })
      })
      .catch(() => { if (!cancelled) setFrameError('load_failed') })
      .finally(() => { if (!cancelled) setFrameLoading(false) })
    return () => { cancelled = true }
  }, [selectedFrame])

  const previewScale = frameSize.width && frameSize.height
    ? Math.min(1, (PREVIEW_MAX_DIM * Math.min(window.devicePixelRatio || 1, 2)) / Math.max(frameSize.width, frameSize.height))
    : 1

  // Redraw the preview canvas whenever anything that affects it changes.
  useEffect(() => {
    const canvasEl = canvasRef.current
    if (!canvasEl || !frameSize.width || !frameSize.height) return
    const w = Math.max(1, Math.round(frameSize.width * previewScale))
    const h = Math.max(1, Math.round(frameSize.height * previewScale))
    if (canvasEl.width !== w) canvasEl.width = w
    if (canvasEl.height !== h) canvasEl.height = h
    const ctx = canvasEl.getContext('2d')
    drawComposite(ctx, w, h, previewScale, {
      frameImg,
      photoSource,
      transform,
      frameW: frameSize.width,
      frameH: frameSize.height,
    })
  }, [frameImg, photoSource, transform, frameSize, previewScale])

  // Mouse-wheel zoom. A native listener (not React's onWheel) so
  // preventDefault reliably stops the page from scrolling underneath.
  useEffect(() => {
    const canvasEl = canvasRef.current
    if (!canvasEl) return undefined
    const handler = (e) => {
      if (!photoSource) return
      e.preventDefault()
      const factor = Math.exp(-e.deltaY * 0.0015)
      setTransform((t) => ({ ...t, scale: clamp(t.scale * factor, SCALE_MIN, SCALE_MAX) }))
    }
    canvasEl.addEventListener('wheel', handler, { passive: false })
    return () => canvasEl.removeEventListener('wheel', handler)
  }, [photoSource])

  const handleSelectFrame = (frame) => {
    setSelectedFrame(frame)
    setPhotoSource(null)
    setPhotoError('')
    setDownloadError('')
    setTransform(DEFAULT_TRANSFORM)
  }

  const handleBackToGallery = () => {
    setSelectedFrame(null)
    setPhotoSource(null)
    setPhotoError('')
    setDownloadError('')
    setTransform(DEFAULT_TRANSFORM)
  }

  const retryFrame = () => setSelectedFrame((f) => (f ? { ...f } : f))

  const handleFiles = useCallback(async (fileList) => {
    const file = fileList && fileList[0]
    if (!file) return
    if (!file.type || !file.type.startsWith('image/')) {
      setPhotoError('Vui lòng chọn một tệp ảnh (JPG, PNG, ...).')
      return
    }
    setPhotoError('')
    try {
      const source = await loadPhotoFile(file)
      setPhotoSource(source)
      setTransform(DEFAULT_TRANSFORM)
      setDownloadError('')
    } catch {
      setPhotoError('Không đọc được ảnh này. Vui lòng thử ảnh khác.')
    }
  }, [])

  const onFileInputChange = (e) => {
    handleFiles(e.target.files)
    e.target.value = ''
  }

  const onDrop = (e) => {
    e.preventDefault()
    if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files)
  }
  const onDragOver = (e) => e.preventDefault()

  function frameDeltaFromScreen(dxScreen, dyScreen) {
    const canvasEl = canvasRef.current
    if (!canvasEl) return { dx: 0, dy: 0 }
    const rect = canvasEl.getBoundingClientRect()
    if (!rect.width || !rect.height) return { dx: 0, dy: 0 }
    const pxPerCssX = canvasEl.width / rect.width
    const pxPerCssY = canvasEl.height / rect.height
    return {
      dx: (dxScreen * pxPerCssX) / previewScale,
      dy: (dyScreen * pxPerCssY) / previewScale,
    }
  }

  const restartPanBaseline = (clientX, clientY) => {
    panStartRef.current = {
      x: clientX,
      y: clientY,
      offsetX: transformRef.current.offsetX,
      offsetY: transformRef.current.offsetY,
    }
  }

  const onPointerDown = (e) => {
    if (!photoSource) return
    canvasRef.current?.setPointerCapture?.(e.pointerId)
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointersRef.current.size === 1) {
      dragModeRef.current = 'pan'
      restartPanBaseline(e.clientX, e.clientY)
    } else if (pointersRef.current.size === 2) {
      dragModeRef.current = 'pinch'
      const pts = [...pointersRef.current.values()]
      const dx = pts[0].x - pts[1].x
      const dy = pts[0].y - pts[1].y
      pinchStartRef.current = {
        distance: Math.hypot(dx, dy) || 1,
        centerX: (pts[0].x + pts[1].x) / 2,
        centerY: (pts[0].y + pts[1].y) / 2,
        scale: transformRef.current.scale,
        offsetX: transformRef.current.offsetX,
        offsetY: transformRef.current.offsetY,
      }
    }
  }

  const onPointerMove = (e) => {
    if (!pointersRef.current.has(e.pointerId)) return
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (dragModeRef.current === 'pan' && pointersRef.current.size === 1 && panStartRef.current) {
      const { dx, dy } = frameDeltaFromScreen(e.clientX - panStartRef.current.x, e.clientY - panStartRef.current.y)
      const base = panStartRef.current
      setTransform((t) => ({ ...t, offsetX: base.offsetX + dx, offsetY: base.offsetY + dy }))
    } else if (dragModeRef.current === 'pinch' && pointersRef.current.size === 2 && pinchStartRef.current) {
      const pts = [...pointersRef.current.values()]
      const dx0 = pts[0].x - pts[1].x
      const dy0 = pts[0].y - pts[1].y
      const distance = Math.hypot(dx0, dy0) || 1
      const centerX = (pts[0].x + pts[1].x) / 2
      const centerY = (pts[0].y + pts[1].y) / 2
      const base = pinchStartRef.current
      const scaleFactor = distance / base.distance
      const { dx, dy } = frameDeltaFromScreen(centerX - base.centerX, centerY - base.centerY)
      setTransform((t) => ({
        ...t,
        scale: clamp(base.scale * scaleFactor, SCALE_MIN, SCALE_MAX),
        offsetX: base.offsetX + dx,
        offsetY: base.offsetY + dy,
      }))
    }
  }

  const endPointer = (e) => {
    pointersRef.current.delete(e.pointerId)
    if (pointersRef.current.size === 1) {
      const [[, remaining]] = pointersRef.current
      dragModeRef.current = 'pan'
      restartPanBaseline(remaining.x, remaining.y)
    } else if (pointersRef.current.size === 0) {
      dragModeRef.current = null
      panStartRef.current = null
      pinchStartRef.current = null
    }
  }

  const handleFitCover = () => setTransform((t) => ({ ...t, scale: 1, offsetX: 0, offsetY: 0 }))
  const handleCenter = () => setTransform((t) => ({ ...t, offsetX: 0, offsetY: 0 }))
  const handleReset = () => setTransform(DEFAULT_TRANSFORM)
  const handleRotate90 = () => setTransform((t) => ({ ...t, rotation: normalizeAngle(t.rotation + 90) }))
  const handleFlip = () => setTransform((t) => ({ ...t, flipX: !t.flipX }))

  const handleDownload = async () => {
    if (!photoSource || !frameImg || !frameSize.width || !frameSize.height || downloading) return
    if (antibotEnabled && !turnstileToken) {
      setDownloadError('Vui lòng hoàn thành bước xác minh chống bot trước khi tải xuống.')
      setTurnstileReset((n) => n + 1)
      return
    }
    setDownloading(true)
    setDownloadError('')
    try {
      const exportCanvas = document.createElement('canvas')
      exportCanvas.width = frameSize.width
      exportCanvas.height = frameSize.height
      const ctx = exportCanvas.getContext('2d')
      drawComposite(ctx, frameSize.width, frameSize.height, 1, {
        frameImg,
        photoSource,
        transform: transformRef.current,
        frameW: frameSize.width,
        frameH: frameSize.height,
      })

      const blob = await new Promise((resolve, reject) => {
        try {
          exportCanvas.toBlob((b) => (b ? resolve(b) : reject(new Error('export_failed'))), 'image/png')
        } catch (err) {
          reject(err)
        }
      })

      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `vnutour-frame-${selectedFrame.id}.png`
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 2000)

      logFrameDownload(selectedFrame.id, { turnstileToken })
      // Token một lần dùng — chuẩn bị token mới cho lượt tải kế tiếp.
      if (antibotEnabled) setTurnstileReset((n) => n + 1)
    } catch (err) {
      const isSecurity = err?.name === 'SecurityError' || /tainted|security/i.test(String(err?.message || ''))
      setDownloadError(
        isSecurity
          ? 'Không thể xuất ảnh do giới hạn bảo mật của trình duyệt. Vui lòng tải lại trang rồi thử lại.'
          : 'Có lỗi khi tạo ảnh ghép. Vui lòng thử lại.',
      )
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="min-h-screen bg-paper font-sans text-ink">
      <TopBar />

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        {!selectedFrame ? (
          <>
            <div className="mb-6">
              <h2 className="font-display text-2xl font-bold uppercase tracking-[-0.01em] text-ink sm:text-3xl">
                Chọn một khung ảnh
              </h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-ink/55">
                Chọn khung do Ban tổ chức thiết kế, tải ảnh của bạn lên và ghép lại thành một tấm ảnh kỷ niệm VNUTour.
              </p>
            </div>
            <GallerySection
              frames={frames}
              loading={loadingFrames}
              error={framesError}
              onRetry={loadFrames}
              onSelect={handleSelectFrame}
            />
          </>
        ) : (
          <div>
            <button
              type="button"
              onClick={handleBackToGallery}
              className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-ink/60 transition hover:text-ink"
            >
              <Icon name="chevronR" className="h-4 w-4 rotate-180" />
              Chọn khung khác
            </button>

            <h2 className="font-display text-xl font-bold uppercase tracking-[-0.01em] text-ink sm:text-2xl">
              {selectedFrame.title || 'Khung ảnh'}
            </h2>
            {selectedFrame.description ? (
              <p className="mt-1 max-w-xl text-sm leading-6 text-ink/50">{selectedFrame.description}</p>
            ) : null}

            {frameLoading && (
              <div className="mt-6 flex items-center justify-center rounded-xl border border-stone bg-white px-6 py-24 text-sm font-semibold text-ink/50">
                Đang tải khung ảnh…
              </div>
            )}

            {!frameLoading && frameError && (
              <div className="mt-6 flex flex-col items-center gap-3 rounded-xl border border-clay/25 bg-clay/[0.04] px-6 py-16 text-center">
                <p className="text-sm font-semibold text-clay">Không tải được khung ảnh này.</p>
                <button type="button" onClick={retryFrame} className={SECONDARY_BUTTON}>Thử lại</button>
              </div>
            )}

            {!frameLoading && !frameError && frameImg && (
              <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
                <div className="mx-auto w-full max-w-xl">
                  <div
                    className="relative mx-auto overflow-hidden rounded-xl border border-stone shadow-[0_1px_3px_rgba(32,49,43,0.08)]"
                    style={{ ...CHECKER_BG, aspectRatio: `${frameSize.width} / ${frameSize.height}` }}
                    onDrop={onDrop}
                    onDragOver={onDragOver}
                  >
                    <canvas
                      ref={canvasRef}
                      className="block h-full w-full select-none"
                      style={{ touchAction: 'none' }}
                      onPointerDown={onPointerDown}
                      onPointerMove={onPointerMove}
                      onPointerUp={endPointer}
                      onPointerCancel={endPointer}
                      onPointerLeave={endPointer}
                    />
                    {!photoSource && (
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="absolute inset-0 flex flex-col items-center justify-center gap-2 border-2 border-dashed border-ink/25 bg-white/50 px-4 text-center backdrop-blur-[1px] transition hover:border-trail hover:bg-white/70"
                      >
                        <Icon name="paperclip" className="h-6 w-6 text-ink/50" />
                        <span className="text-sm font-semibold text-ink/65">Kéo thả ảnh vào đây hoặc bấm để chọn ảnh</span>
                        <span className="text-xs text-ink/40">JPG, PNG...</span>
                      </button>
                    )}
                  </div>
                  {photoSource && (
                    <p className="mt-3 text-center text-xs text-ink/40">
                      Kéo ảnh để di chuyển · cuộn chuột hoặc chụm hai ngón để phóng to
                    </p>
                  )}
                  {photoError && (
                    <p className="mt-2 text-center text-sm font-semibold text-clay">{photoError}</p>
                  )}
                </div>

                <div className="flex flex-col gap-5">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={onFileInputChange}
                  />
                  <button type="button" onClick={() => fileInputRef.current?.click()} className={SECONDARY_BUTTON}>
                    <Icon name="paperclip" className="h-4 w-4" />
                    {photoSource ? 'Đổi ảnh khác' : 'Chọn ảnh'}
                  </button>

                  {photoSource && (
                    <>
                      <div>
                        <div className="mb-1.5 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-ink/50">
                          <span>Phóng to / thu nhỏ</span>
                          <span className="font-mono text-ink/70">{Math.round(transform.scale * 100)}%</span>
                        </div>
                        <input
                          type="range"
                          min={SCALE_MIN}
                          max={SCALE_MAX}
                          step={0.01}
                          value={transform.scale}
                          onChange={(e) => setTransform((t) => ({ ...t, scale: Number(e.target.value) }))}
                          className="w-full accent-trail"
                        />
                      </div>

                      <div>
                        <div className="mb-1.5 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-ink/50">
                          <span>Xoay</span>
                          <span className="font-mono text-ink/70">{Math.round(transform.rotation)}°</span>
                        </div>
                        <input
                          type="range"
                          min={-180}
                          max={180}
                          step={1}
                          value={transform.rotation}
                          onChange={(e) => setTransform((t) => ({ ...t, rotation: Number(e.target.value) }))}
                          className="w-full accent-trail"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <button type="button" onClick={handleFitCover} className={SECONDARY_BUTTON}>Vừa khung</button>
                        <button type="button" onClick={handleCenter} className={SECONDARY_BUTTON}>Căn giữa</button>
                        <button type="button" onClick={handleRotate90} className={SECONDARY_BUTTON}>Xoay 90°</button>
                        <button type="button" onClick={handleFlip} className={SECONDARY_BUTTON}>Lật ngang</button>
                        <button type="button" onClick={handleReset} className={`${SECONDARY_BUTTON} col-span-2`}>Đặt lại</button>
                      </div>
                    </>
                  )}

                  <div className="mt-1 space-y-3 border-t border-stone pt-5">
                    {antibotEnabled && (
                      <div className="flex justify-center">
                        <TurnstileWidget
                          siteKey={antibot.site_key}
                          onToken={setTurnstileToken}
                          onError={() => setDownloadError('Không tải được công cụ xác minh. Kiểm tra kết nối rồi thử lại.')}
                          resetSignal={turnstileReset}
                        />
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={handleDownload}
                      disabled={!photoSource || downloading}
                      className={`${PRIMARY_BUTTON} w-full`}
                    >
                      {downloading ? 'Đang tạo ảnh…' : 'Tải xuống'}
                    </button>
                    {downloadError && (
                      <p className="text-sm font-semibold text-clay">{downloadError}</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}

export default FramePage
