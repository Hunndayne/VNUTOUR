// Public "ghép khung ảnh" (photo frame) editor — đồng bộ với giao diện VNUTour 2026.
//
// Bất kỳ ai (khách hoặc đã đăng nhập) đều có thể chọn một khung do BTC tải lên,
// tải ảnh của mình lên, căn chỉnh vị trí và tải ảnh đã ghép về máy.
// Mỗi khung ảnh sở hữu một URL riêng biệt (/frame/:id) để thuận tiện chia sẻ.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import SiteHeader from './SiteHeader.jsx'
import SiteFooter from './SiteFooter.jsx'
import MarkdownPreview from './MarkdownPreview'
import { stripMarkdown } from './markdownUtils.jsx'
import { Icon } from './ui.jsx'
import { frameImageUrl, listPublicFrames, getPublicFrame, logFrameDownload } from './frameApi.js'
import { navigate, useRouteSegments, useSearchParam } from './router.js'
import { TurnstileWidget } from './antibot.jsx'
import { apiRequest } from './api.js'

const PREVIEW_MAX_DIM = 1400 // internal preview canvas cap, in device pixels
const PHOTO_MAX_DIM = 4096 // downsample huge uploads before they ever hit the canvas
const SCALE_MIN = 0.3
const SCALE_MAX = 4

const DEFAULT_ADJUST = { brightness: 100, contrast: 100, saturation: 100, filter: 'none' }
const DEFAULT_TRANSFORM = { scale: 1, rotation: 0, offsetX: 0, offsetY: 0, flipX: false, ...DEFAULT_ADJUST }

// Bộ lọc màu dựng sẵn — mỗi mục nối thêm vào chuỗi filter của canvas.
const FILTER_PRESETS = [
  { key: 'none', label: 'Gốc', css: '' },
  { key: 'mono', label: 'Trắng đen', css: 'grayscale(100%)' },
  { key: 'sepia', label: 'Hoài niệm', css: 'sepia(75%)' },
  { key: 'warm', label: 'Ấm', css: 'sepia(30%) saturate(140%)' },
  { key: 'cool', label: 'Lạnh', css: 'hue-rotate(-18deg) saturate(115%)' },
  { key: 'vivid', label: 'Rực rỡ', css: 'saturate(165%) contrast(108%)' },
]

/** Build a canvas `ctx.filter` string from a transform's colour adjustments. */
function buildCanvasFilter(t) {
  const parts = [
    `brightness(${t.brightness ?? 100}%)`,
    `contrast(${t.contrast ?? 100}%)`,
    `saturate(${t.saturation ?? 100}%)`,
  ]
  const preset = FILTER_PRESETS.find((p) => p.key === t.filter)
  if (preset && preset.css) parts.push(preset.css)
  return parts.join(' ')
}

// Checkerboard pattern với tone xanh đại dương nhạt để xem rõ các vùng trong suốt của frame PNG
const CHECKER_BG = {
  backgroundImage:
    'linear-gradient(45deg, #e3eff7 25%, transparent 25%), linear-gradient(-45deg, #e3eff7 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e3eff7 75%), linear-gradient(-45deg, transparent 75%, #e3eff7 75%)',
  backgroundSize: '20px 20px',
  backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
  backgroundColor: '#f6fafe',
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
 * Draw photo (bottom) + frame (top) onto ctx, sized canvasW x canvasH.
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
    // Colour adjustments/filters apply to the photo only — restore() clears
    // ctx.filter before the frame overlay is drawn on top.
    ctx.filter = buildCanvasFilter(transform)
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
 * Decode a visitor's photo file into a drawable source.
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

function Toast({ message }) {
  if (!message) return null
  return (
    <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 transform">
      <div className="flex items-center gap-2.5 rounded-full border border-white/20 bg-[#0c1d33] px-5 py-3 text-xs font-bold uppercase tracking-[0.06em] text-white shadow-[0_10px_30px_rgba(12,29,51,0.35)] backdrop-blur-md animate-in fade-in slide-in-from-bottom-3 duration-200">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#00B6F1] text-white text-[10px]">
          ✓
        </span>
        <span>{message}</span>
      </div>
    </div>
  )
}

function FrameCard({ frame, onSelect, onShare }) {
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-2xl border border-[#00B6F1]/20 bg-white shadow-[0_6px_25px_rgba(12,29,51,0.05)] transition-all duration-300 hover:-translate-y-1.5 hover:border-[#1478D4]/50 hover:shadow-[0_16px_40px_rgba(20,120,212,0.14)]">
      <div
        className="relative aspect-square cursor-pointer overflow-hidden"
        style={CHECKER_BG}
        onClick={() => onSelect(frame)}
      >
        <img
          src={frameImageUrl(frame.id)}
          alt={frame.title || 'Khung ảnh'}
          loading="lazy"
          className="h-full w-full object-contain p-4 transition-transform duration-300 group-hover:scale-105"
        />
        {frame.download_count > 0 && (
          <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full border border-[#00B6F1]/20 bg-white/95 px-2.5 py-1 text-[11px] font-bold text-[#1478D4] shadow-sm backdrop-blur-sm">
            🔥 {frame.download_count}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col justify-between p-5">
        <div>
          <h3
            onClick={() => onSelect(frame)}
            className="cursor-pointer font-display text-base font-bold uppercase leading-snug tracking-[-0.01em] text-[#0c1d33] transition-colors group-hover:text-[#1478D4]"
          >
            {frame.title || 'Khung ảnh VNUTour'}
          </h3>
          {frame.description ? (
            <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-[#0c1d33]/60">
              {stripMarkdown(frame.description)}
            </p>
          ) : (
            <p className="mt-2 text-xs italic text-[#0c1d33]/35">Chưa có mô tả</p>
          )}
        </div>

        <div className="mt-5 flex items-center gap-2 border-t border-[#00B6F1]/15 pt-4">
          <button
            type="button"
            onClick={() => onSelect(frame)}
            className="flex-1 inline-flex min-h-10 items-center justify-center gap-1.5 rounded-full border-2 border-[#1478D4] bg-[#1478D4] px-4 text-xs font-bold uppercase tracking-[0.06em] text-white transition-all duration-200 hover:border-[#0c1d33] hover:bg-[#0c1d33] active:translate-y-px"
          >
            <span>Ghép ảnh ngay</span>
            <span aria-hidden="true">→</span>
          </button>
          <button
            type="button"
            title="Sao chép link chia sẻ khung này"
            onClick={(e) => onShare(frame, e)}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-[#00B6F1]/30 bg-white text-[#00B6F1] transition-all duration-200 hover:border-[#00B6F1] hover:bg-[#00B6F1] hover:text-white active:translate-y-px"
          >
            <Icon name="link" className="h-4 w-4" />
          </button>
        </div>
      </div>
    </article>
  )
}

function FramePage() {
  const segments = useRouteSegments()
  const [paramId] = useSearchParam('id', '')

  // Tách ID khung ảnh từ route: /frame/:id hoặc /frame/:id-:slug hoặc ?id=1
  const routeFrameId = useMemo(() => {
    if (segments[0] === 'frame' && segments[1]) {
      const firstSegment = segments[1].split('-')[0]
      const parsed = parseInt(firstSegment, 10)
      return isNaN(parsed) ? null : parsed
    }
    if (paramId) {
      const parsed = parseInt(paramId, 10)
      return isNaN(parsed) ? null : parsed
    }
    return null
  }, [segments, paramId])

  const [frames, setFrames] = useState([])
  const [loadingFrames, setLoadingFrames] = useState(true)
  const [framesError, setFramesError] = useState('')

  const [selectedFrame, setSelectedFrame] = useState(null)
  const [frameLoadingSpecific, setFrameLoadingSpecific] = useState(false)
  const [frameNotFound, setFrameNotFound] = useState(false)

  const [frameImg, setFrameImg] = useState(null)
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 })
  const [frameImgLoading, setFrameImgLoading] = useState(false)
  const [frameImgError, setFrameImgError] = useState('')

  const [photoSource, setPhotoSource] = useState(null)
  const [photoError, setPhotoError] = useState('')
  const [transform, setTransform] = useState(DEFAULT_TRANSFORM)

  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState('')
  const [toastMessage, setToastMessage] = useState('')

  // Chống bot cho đếm lượt tải
  const [antibot, setAntibot] = useState(null)
  const [turnstileToken, setTurnstileToken] = useState('')
  const [turnstileReset, setTurnstileReset] = useState(0)
  const antibotEnabled = Boolean(antibot?.enabled)

  const canvasRef = useRef(null)
  const fileInputRef = useRef(null)
  const transformRef = useRef(transform)
  transformRef.current = transform

  const pointersRef = useRef(new Map())
  const dragModeRef = useRef(null)
  const panStartRef = useRef(null)
  const pinchStartRef = useRef(null)

  const showToast = (msg) => {
    setToastMessage(msg)
    setTimeout(() => {
      setToastMessage((cur) => (cur === msg ? '' : cur))
    }, 3000)
  }

  // Nạp cấu hình antibot
  useEffect(() => {
    apiRequest('/public/site-config', { auth: false })
      .then((cfg) => { if (cfg?.antibot?.enabled) setAntibot(cfg.antibot) })
      .catch(() => {})
  }, [])

  // Nạp danh sách tất cả các khung ảnh công khai
  const loadFrames = useCallback(() => {
    setLoadingFrames(true)
    setFramesError('')
    listPublicFrames()
      .then((list) => {
        setFrames(list || [])
      })
      .catch(() => setFramesError('load_failed'))
      .finally(() => setLoadingFrames(false))
  }, [])

  useEffect(() => {
    loadFrames()
  }, [loadFrames])

  // Đồng bộ selectedFrame theo routeFrameId từ URL
  useEffect(() => {
    if (!routeFrameId) {
      setSelectedFrame(null)
      setFrameNotFound(false)
      document.title = 'Khung ảnh | VNUTour 2026'
      return
    }

    // Nếu danh sách frames đã tải, tìm trong frames trước
    const found = frames.find((f) => String(f.id) === String(routeFrameId))
    if (found) {
      setSelectedFrame(found)
      setFrameNotFound(false)
      document.title = `${found.title || 'Khung ảnh'} | VNUTour 2026`
      return
    }

    // Nếu chưa có trong danh sách (có thể chưa tải xong hoặc truy cập thẳng), fetch trực tiếp
    if (!loadingFrames) {
      setFrameLoadingSpecific(true)
      getPublicFrame(routeFrameId)
        .then((f) => {
          if (f) {
            setSelectedFrame(f)
            setFrameNotFound(false)
            document.title = `${f.title || 'Khung ảnh'} | VNUTour 2026`
          } else {
            setFrameNotFound(true)
          }
        })
        .catch(() => {
          setFrameNotFound(true)
        })
        .finally(() => {
          setFrameLoadingSpecific(false)
        })
    }
  }, [routeFrameId, frames, loadingFrames])

  // Nạp ảnh PNG của khung được chọn
  useEffect(() => {
    if (!selectedFrame) {
      setFrameImg(null)
      setFrameSize({ width: 0, height: 0 })
      return undefined
    }
    let cancelled = false
    setFrameImgLoading(true)
    setFrameImgError('')
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
      .catch(() => { if (!cancelled) setFrameImgError('load_failed') })
      .finally(() => { if (!cancelled) setFrameImgLoading(false) })

    return () => { cancelled = true }
  }, [selectedFrame])

  const previewScale = frameSize.width && frameSize.height
    ? Math.min(1, (PREVIEW_MAX_DIM * Math.min(window.devicePixelRatio || 1, 2)) / Math.max(frameSize.width, frameSize.height))
    : 1

  // Vẽ canvas xem trước mỗi khi có thay đổi
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

  // Thu phóng bằng con lăn chuột trên canvas
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
    navigate(`/frame/${frame.id}`)
  }

  const handleBackToGallery = () => {
    navigate('/frame')
  }

  const handleShareFrame = async (frame, e) => {
    if (e) e.stopPropagation()
    const url = `${window.location.origin}/frame/${frame.id}`
    const title = `${frame.title || 'Khung ảnh'} - VNUTour 2026`
    const text = `Tạo ảnh đại diện rực rỡ với khung "${frame.title || 'VNUTour'}" tại VNUTour 2026!`

    if (navigator.share && /mobile|android|iphone|ipad/i.test(navigator.userAgent)) {
      try {
        await navigator.share({ title, text, url })
        return
      } catch (err) {
        if (err.name === 'AbortError') return
      }
    }

    try {
      await navigator.clipboard.writeText(url)
      showToast('Đã sao chép liên kết khung ảnh!')
    } catch {
      const input = document.createElement('input')
      input.value = url
      document.body.appendChild(input)
      input.select()
      document.execCommand('copy')
      document.body.removeChild(input)
      showToast('Đã sao chép liên kết khung ảnh!')
    }
  }

  const handleFiles = useCallback(async (fileList) => {
    const file = fileList && fileList[0]
    if (!file) return
    if (!file.type || !file.type.startsWith('image/')) {
      setPhotoError('Vui lòng chọn một tệp ảnh hợp lệ (JPG, PNG, WEBP...).')
      return
    }
    setPhotoError('')
    try {
      const source = await loadPhotoFile(file)
      setPhotoSource(source)
      setTransform(DEFAULT_TRANSFORM)
      setDownloadError('')
    } catch {
      setPhotoError('Không thể mở tệp ảnh này. Vui lòng thử ảnh khác.')
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
  const handleResetAdjust = () => setTransform((t) => ({ ...t, ...DEFAULT_ADJUST }))
  const handleRotate90 = () => setTransform((t) => ({ ...t, rotation: normalizeAngle(t.rotation + 90) }))
  const handleFlip = () => setTransform((t) => ({ ...t, flipX: !t.flipX }))

  const handleDownload = async () => {
    if (!photoSource || !frameImg || !frameSize.width || !frameSize.height || downloading) return
    if (antibotEnabled && !turnstileToken) {
      setDownloadError('Vui lòng hoàn thành xác minh bảo mật trước khi tải xuống.')
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
      if (antibotEnabled) setTurnstileReset((n) => n + 1)
      showToast('Đã tải ảnh về máy thành công!')
    } catch (err) {
      const isSecurity = err?.name === 'SecurityError' || /tainted|security/i.test(String(err?.message || ''))
      setDownloadError(
        isSecurity
          ? 'Không thể xuất ảnh do giới hạn bảo mật của trình duyệt. Vui lòng tải lại trang rồi thử lại.'
          : 'Có lỗi khi kết xuất ảnh. Vui lòng thử lại.',
      )
    } finally {
      setDownloading(false)
    }
  }

  // Danh sách các khung khác (ngoài khung hiện tại)
  const otherFrames = useMemo(() => {
    if (!selectedFrame) return []
    return frames.filter((f) => String(f.id) !== String(selectedFrame.id))
  }, [frames, selectedFrame])

  return (
    <div className="flex min-h-screen min-h-[100dvh] flex-col bg-white font-sans text-[#0c1d33]">
      <SiteHeader />

      <main className="flex-1">
        {/* VIEW 1: GALLERY - KHI ĐANG Ở ĐƯỜNG DẪN /frame */}
        {!selectedFrame && !routeFrameId && (
          <div className="mx-auto w-full max-w-[1400px] px-4 py-10 sm:px-6 md:py-16">
            {/* HERO SECTION */}
            <div className="mx-auto mb-12 max-w-3xl text-center">
              <p className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-[#1478D4] sm:text-sm">
                CÔNG CỤ GHÉP KHUNG ẢNH · VNUTOUR 2026
              </p>
              <h1 className="font-display text-3xl font-bold uppercase leading-[1.05] tracking-[-0.035em] text-[#0c1d33] sm:text-5xl md:text-6xl">
                Khung ảnh <span className="text-[#1478D4]">VNUTour 2026</span>
              </h1>
              <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-[#0c1d33]/65 md:text-lg">
                Chọn mẫu khung yêu thích do Ban tổ chức thiết kế, tải ảnh của bạn lên và sở hữu ngay tấm ảnh đại diện rực rỡ để sẵn sàng đồng hành cùng chuyến hành trình!
              </p>
            </div>

            {/* GALLERY GRID */}
            {loadingFrames ? (
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {Array.from({ length: 8 }, (_, i) => (
                  <div
                    key={`frame-skel-${i}`}
                    className="flex flex-col overflow-hidden rounded-2xl border border-[#00B6F1]/15 bg-white p-4 shadow-sm"
                  >
                    <div className="aspect-square animate-pulse rounded-xl bg-[#E8F8FF]" />
                    <div className="mt-4 h-5 w-3/4 animate-pulse rounded bg-[#E8F8FF]" />
                    <div className="mt-2 h-4 w-1/2 animate-pulse rounded bg-[#E8F8FF]" />
                  </div>
                ))}
              </div>
            ) : framesError ? (
              <div className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-2xl border border-red-200 bg-red-50/50 p-8 text-center">
                <p className="text-sm font-semibold text-red-600">Không tải được danh sách khung ảnh.</p>
                <button
                  type="button"
                  onClick={loadFrames}
                  className="inline-flex min-h-10 items-center justify-center rounded-full border-2 border-[#1478D4] bg-[#1478D4] px-6 text-xs font-bold uppercase tracking-[0.06em] text-white hover:bg-[#0c1d33]"
                >
                  Thử lại
                </button>
              </div>
            ) : frames.length === 0 ? (
              <div className="mx-auto flex max-w-lg flex-col items-center gap-3 rounded-2xl border border-[#00B6F1]/20 bg-[#F0FAFF] px-6 py-16 text-center">
                <p className="text-lg font-bold text-[#0c1d33]">Hiện chưa có khung ảnh nào.</p>
                <p className="text-sm text-[#0c1d33]/55">
                  Ban tổ chức đang cập nhật các mẫu khung mới, bạn hãy quay lại sau nhé!
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {frames.map((frame) => (
                  <FrameCard
                    key={frame.id}
                    frame={frame}
                    onSelect={handleSelectFrame}
                    onShare={handleShareFrame}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* VIEW 2: KHUNG ĐANG TẢI HOẶC KHÔNG TÌM THẤY */}
        {routeFrameId && (frameLoadingSpecific || (!selectedFrame && loadingFrames)) && (
          <div className="mx-auto flex max-w-lg flex-col items-center justify-center px-4 py-28 text-center">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#1478D4] border-t-transparent" />
            <p className="mt-4 text-sm font-semibold text-[#0c1d33]/70">Đang tải khung ảnh...</p>
          </div>
        )}

        {routeFrameId && !loadingFrames && !frameLoadingSpecific && frameNotFound && (
          <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-24 text-center">
            <span className="text-5xl">🖼️</span>
            <h2 className="font-display text-2xl font-bold uppercase text-[#0c1d33]">Không tìm thấy khung ảnh</h2>
            <p className="text-sm text-[#0c1d33]/60">
              Khung ảnh này có thể chưa được mở công khai hoặc đã bị gỡ bỏ.
            </p>
            <button
              type="button"
              onClick={handleBackToGallery}
              className="mt-2 inline-flex min-h-11 items-center justify-center rounded-full border-2 border-[#1478D4] bg-[#1478D4] px-6 text-xs font-bold uppercase tracking-[0.06em] text-white hover:bg-[#0c1d33]"
            >
              ← Xem tất cả khung ảnh
            </button>
          </div>
        )}

        {/* VIEW 3: STUDIO GHÉP KHUNG ẢNH CỤ THỂ (/frame/:id) */}
        {selectedFrame && (
          <div className="mx-auto w-full max-w-[1400px] px-4 py-8 sm:px-6 md:py-12">
            {/* THANH ĐIỀU HƯỚNG VÀ CHIA SẺ */}
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={handleBackToGallery}
                className="inline-flex min-h-10 items-center gap-2 rounded-full border-2 border-[#00B6F1]/30 bg-white px-5 text-xs font-bold uppercase tracking-[0.06em] text-[#1478D4] transition-all hover:border-[#1478D4] hover:bg-[#F0FAFF] active:translate-y-px shadow-sm"
              >
                <span aria-hidden="true">←</span>
                <span>Tất cả khung ảnh</span>
              </button>

              <button
                type="button"
                onClick={(e) => handleShareFrame(selectedFrame, e)}
                className="inline-flex min-h-10 items-center gap-2 rounded-full border-2 border-[#00B6F1] bg-white px-5 text-xs font-bold uppercase tracking-[0.06em] text-[#00B6F1] transition-all hover:bg-[#00B6F1] hover:text-white active:translate-y-px shadow-sm"
              >
                <Icon name="link" className="h-4 w-4" />
                <span>Chia sẻ khung này</span>
              </button>
            </div>

            {/* TIÊU ĐỀ & THÔNG TIN KHUNG */}
            <div className="mb-8">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="font-display text-2xl font-bold uppercase tracking-[-0.02em] text-[#0c1d33] sm:text-3xl md:text-4xl">
                  {selectedFrame.title || 'Khung ảnh VNUTour'}
                </h1>
                {selectedFrame.download_count > 0 && (
                  <span className="rounded-full bg-[#D9F5FF] px-3 py-1 text-xs font-bold text-[#1478D4]">
                    🔥 {selectedFrame.download_count} lượt tải
                  </span>
                )}
                {frameSize.width > 0 && frameSize.height > 0 && (
                  <span className="rounded-full border border-[#00B6F1]/25 bg-white px-3 py-1 font-mono text-xs font-semibold text-[#0c1d33]/60">
                    {frameSize.width} × {frameSize.height} px
                  </span>
                )}
              </div>
              {selectedFrame.description ? (
                <div className="mt-2 max-w-2xl text-sm leading-relaxed text-[#0c1d33]/70">
                  <MarkdownPreview content={selectedFrame.description} />
                </div>
              ) : null}
            </div>

            {/* TRẠNG THÁI TẢI KHUNG */}
            {frameImgLoading && (
              <div className="flex items-center justify-center rounded-2xl border border-[#00B6F1]/20 bg-white px-6 py-28 text-sm font-semibold text-[#0c1d33]/50 shadow-sm">
                Đang tải mẫu khung ảnh…
              </div>
            )}

            {!frameImgLoading && frameImgError && (
              <div className="flex flex-col items-center gap-3 rounded-2xl border border-red-200 bg-red-50/50 px-6 py-16 text-center">
                <p className="text-sm font-semibold text-red-600">Không tải được khung ảnh này.</p>
                <button
                  type="button"
                  onClick={() => setSelectedFrame({ ...selectedFrame })}
                  className="inline-flex min-h-10 items-center justify-center rounded-full border-2 border-[#1478D4] bg-[#1478D4] px-6 text-xs font-bold uppercase tracking-[0.06em] text-white hover:bg-[#0c1d33]"
                >
                  Thử lại
                </button>
              </div>
            )}

            {/* GIAO DIỆN GHÉP ẢNH (CANVAS + CONTROLS) */}
            {!frameImgLoading && !frameImgError && frameImg && (
              <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_24rem]">
                {/* CỘT TRÁI: CANVAS HIỂN THỊ */}
                <div className="flex flex-col items-center">
                  <div className="w-full max-w-xl rounded-2xl border border-[#00B6F1]/25 bg-white p-3 sm:p-5 shadow-[0_12px_35px_rgba(12,29,51,0.08)]">
                    <div
                      className="relative mx-auto overflow-hidden rounded-xl border border-[#00B6F1]/20 shadow-inner"
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
                          className="absolute inset-0 flex flex-col items-center justify-center gap-3 border-2 border-dashed border-[#00B6F1]/40 bg-white/70 px-4 text-center backdrop-blur-[2px] transition-all hover:border-[#1478D4] hover:bg-white/85"
                        >
                          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#D9F5FF] text-[#1478D4]">
                            <Icon name="paperclip" className="h-6 w-6" />
                          </div>
                          <span className="text-sm font-bold text-[#0c1d33]">
                            Kéo thả ảnh vào đây hoặc bấm để chọn ảnh
                          </span>
                          <span className="text-xs text-[#0c1d33]/50">Hỗ trợ định dạng JPG, PNG, WEBP...</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {photoSource && (
                    <p className="mt-3 text-center text-xs text-[#0c1d33]/50">
                      💡 Kéo ảnh để căn chỉnh vị trí · Cuộn chuột hoặc chụm 2 ngón tay trên màn hình để thu phóng
                    </p>
                  )}
                  {photoError && (
                    <p className="mt-2 text-center text-sm font-semibold text-red-600">{photoError}</p>
                  )}
                </div>

                {/* CỘT PHẢI: BẢNG ĐIỀU KHIỂN CÔNG CỤ */}
                <div className="flex flex-col gap-6">
                  <div className="rounded-2xl border border-[#00B6F1]/25 bg-white p-6 shadow-[0_12px_35px_rgba(12,29,51,0.06)]">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={onFileInputChange}
                    />

                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex w-full min-h-12 items-center justify-center gap-2 rounded-full border-2 border-[#1478D4] bg-[#1478D4] px-6 text-sm font-bold uppercase tracking-[0.06em] text-white shadow-[0_4px_14px_rgba(20,120,212,0.2)] transition-all hover:border-[#0c1d33] hover:bg-[#0c1d33] active:translate-y-px"
                    >
                      <Icon name="paperclip" className="h-4 w-4" />
                      <span>{photoSource ? 'Đổi ảnh khác' : 'Chọn ảnh của bạn'}</span>
                    </button>

                    {photoSource && (
                      <div className="mt-6 space-y-5 border-t border-[#00B6F1]/15 pt-5">
                        {/* THANH TRƯỢT PHÓNG TO / THU NHỎ */}
                        <div>
                          <div className="mb-2 flex items-center justify-between text-xs font-bold uppercase tracking-wider text-[#0c1d33]/60">
                            <span>Phóng to / thu nhỏ</span>
                            <span className="rounded-full bg-[#D9F5FF] px-2 py-0.5 font-mono text-xs font-bold text-[#1478D4]">
                              {Math.round(transform.scale * 100)}%
                            </span>
                          </div>
                          <input
                            type="range"
                            min={SCALE_MIN}
                            max={SCALE_MAX}
                            step={0.01}
                            value={transform.scale}
                            onChange={(e) => setTransform((t) => ({ ...t, scale: Number(e.target.value) }))}
                            className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-[#E8F8FF] accent-[#1478D4]"
                          />
                        </div>

                        {/* THANH TRƯỢT XOAY */}
                        <div>
                          <div className="mb-2 flex items-center justify-between text-xs font-bold uppercase tracking-wider text-[#0c1d33]/60">
                            <span>Xoay góc</span>
                            <span className="rounded-full bg-[#D9F5FF] px-2 py-0.5 font-mono text-xs font-bold text-[#1478D4]">
                              {Math.round(transform.rotation)}°
                            </span>
                          </div>
                          <input
                            type="range"
                            min={-180}
                            max={180}
                            step={1}
                            value={transform.rotation}
                            onChange={(e) => setTransform((t) => ({ ...t, rotation: Number(e.target.value) }))}
                            className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-[#E8F8FF] accent-[#1478D4]"
                          />
                        </div>

                        {/* CÁC NÚT THAO TÁC NHANH */}
                        <div className="grid grid-cols-2 gap-2 pt-1">
                          <button
                            type="button"
                            onClick={handleFitCover}
                            className="inline-flex min-h-9 items-center justify-center rounded-full border border-[#00B6F1]/30 bg-white px-3 text-xs font-bold uppercase tracking-wider text-[#0c1d33] transition-all hover:border-[#1478D4] hover:bg-[#F0FAFF] hover:text-[#1478D4]"
                          >
                            Vừa khung
                          </button>
                          <button
                            type="button"
                            onClick={handleCenter}
                            className="inline-flex min-h-9 items-center justify-center rounded-full border border-[#00B6F1]/30 bg-white px-3 text-xs font-bold uppercase tracking-wider text-[#0c1d33] transition-all hover:border-[#1478D4] hover:bg-[#F0FAFF] hover:text-[#1478D4]"
                          >
                            Căn giữa
                          </button>
                          <button
                            type="button"
                            onClick={handleRotate90}
                            className="inline-flex min-h-9 items-center justify-center rounded-full border border-[#00B6F1]/30 bg-white px-3 text-xs font-bold uppercase tracking-wider text-[#0c1d33] transition-all hover:border-[#1478D4] hover:bg-[#F0FAFF] hover:text-[#1478D4]"
                          >
                            Xoay 90°
                          </button>
                          <button
                            type="button"
                            onClick={handleFlip}
                            className="inline-flex min-h-9 items-center justify-center rounded-full border border-[#00B6F1]/30 bg-white px-3 text-xs font-bold uppercase tracking-wider text-[#0c1d33] transition-all hover:border-[#1478D4] hover:bg-[#F0FAFF] hover:text-[#1478D4]"
                          >
                            Lật ngang
                          </button>
                          <button
                            type="button"
                            onClick={handleReset}
                            className="col-span-2 inline-flex min-h-9 items-center justify-center rounded-full border border-[#00B6F1]/30 bg-white px-3 text-xs font-bold uppercase tracking-wider text-[#0c1d33]/60 transition-all hover:border-[#1478D4] hover:bg-[#F0FAFF] hover:text-[#1478D4]"
                          >
                            Đặt lại vị trí gốc
                          </button>
                        </div>

                        {/* CHỈNH MÀU: SÁNG / TƯƠNG PHẢN / BÃO HÒA */}
                        <div className="space-y-4 border-t border-[#00B6F1]/15 pt-5">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold uppercase tracking-wider text-[#0c1d33]/60">Chỉnh màu ảnh</span>
                            <button
                              type="button"
                              onClick={handleResetAdjust}
                              className="text-xs font-bold uppercase tracking-wider text-[#1478D4] transition-colors hover:text-[#0c1d33]"
                            >
                              Đặt lại màu
                            </button>
                          </div>

                          {[
                            { key: 'brightness', label: 'Độ sáng' },
                            { key: 'contrast', label: 'Tương phản' },
                            { key: 'saturation', label: 'Độ bão hòa' },
                          ].map(({ key, label }) => (
                            <div key={key}>
                              <div className="mb-1.5 flex items-center justify-between text-xs font-semibold text-[#0c1d33]/60">
                                <span>{label}</span>
                                <span className="rounded-full bg-[#D9F5FF] px-2 py-0.5 font-mono text-xs font-bold text-[#1478D4]">
                                  {Math.round(transform[key])}%
                                </span>
                              </div>
                              <input
                                type="range"
                                min={0}
                                max={200}
                                step={1}
                                value={transform[key]}
                                onChange={(e) => setTransform((t) => ({ ...t, [key]: Number(e.target.value) }))}
                                className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-[#E8F8FF] accent-[#1478D4]"
                              />
                            </div>
                          ))}
                        </div>

                        {/* BỘ LỌC MÀU DỰNG SẴN */}
                        <div className="space-y-2 border-t border-[#00B6F1]/15 pt-5">
                          <span className="text-xs font-bold uppercase tracking-wider text-[#0c1d33]/60">Bộ lọc</span>
                          <div className="grid grid-cols-3 gap-2">
                            {FILTER_PRESETS.map((preset) => {
                              const active = transform.filter === preset.key
                              return (
                                <button
                                  key={preset.key}
                                  type="button"
                                  onClick={() => setTransform((t) => ({ ...t, filter: preset.key }))}
                                  className={`inline-flex min-h-9 items-center justify-center rounded-full border px-2 text-xs font-bold uppercase tracking-wider transition-all ${
                                    active
                                      ? 'border-[#1478D4] bg-[#1478D4] text-white'
                                      : 'border-[#00B6F1]/30 bg-white text-[#0c1d33]/70 hover:border-[#1478D4] hover:bg-[#F0FAFF] hover:text-[#1478D4]'
                                  }`}
                                >
                                  {preset.label}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* KHU VỰC TẢI XUỐNG & XÁC MINH */}
                    <div className="mt-6 space-y-4 border-t border-[#00B6F1]/15 pt-5">
                      {antibotEnabled && (
                        <div className="flex justify-center">
                          <TurnstileWidget
                            siteKey={antibot.site_key}
                            onToken={setTurnstileToken}
                            onError={() =>
                              setDownloadError('Không tải được công cụ xác minh. Vui lòng kiểm tra kết nối mạng.')
                            }
                            resetSignal={turnstileReset}
                          />
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={handleDownload}
                        disabled={!photoSource || downloading}
                        className="inline-flex w-full min-h-13 items-center justify-center gap-2 rounded-full border-2 border-[#1478D4] bg-[#1478D4] px-7 py-3.5 text-sm font-bold uppercase tracking-[0.06em] text-white shadow-[0_6px_20px_rgba(20,120,212,0.3)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[#0c1d33] hover:bg-[#0c1d33] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:border-[#1478D4] disabled:hover:bg-[#1478D4]"
                      >
                        {downloading ? (
                          <>
                            <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                            <span>Đang tạo ảnh chất lượng cao...</span>
                          </>
                        ) : (
                          <>
                            <span>Tải ảnh về máy</span>
                            <span aria-hidden="true">↓</span>
                          </>
                        )}
                      </button>

                      {downloadError && (
                        <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-center text-xs font-semibold text-red-600">
                          {downloadError}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* MỤC KHÁM PHÁ CÁC KHUNG ẢNH KHÁC */}
            {otherFrames.length > 0 && (
              <div className="mt-16 border-t border-[#00B6F1]/15 pt-12">
                <div className="mb-6 flex items-center justify-between">
                  <h2 className="font-display text-xl font-bold uppercase tracking-[-0.02em] text-[#0c1d33] sm:text-2xl">
                    Khám phá các khung ảnh khác
                  </h2>
                  <button
                    type="button"
                    onClick={handleBackToGallery}
                    className="text-xs font-bold uppercase tracking-[0.08em] text-[#1478D4] hover:underline"
                  >
                    Xem tất cả ({frames.length}) →
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
                  {otherFrames.slice(0, 4).map((frame) => (
                    <div
                      key={frame.id}
                      onClick={() => handleSelectFrame(frame)}
                      className="group flex cursor-pointer flex-col overflow-hidden rounded-xl border border-[#00B6F1]/20 bg-white shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-[#1478D4] hover:shadow-md"
                    >
                      <div className="relative aspect-square overflow-hidden" style={CHECKER_BG}>
                        <img
                          src={frameImageUrl(frame.id)}
                          alt={frame.title}
                          loading="lazy"
                          className="h-full w-full object-contain p-3 transition-transform duration-200 group-hover:scale-105"
                        />
                      </div>
                      <div className="p-3">
                        <p className="line-clamp-1 text-xs font-bold uppercase text-[#0c1d33] group-hover:text-[#1478D4]">
                          {frame.title || 'Khung ảnh'}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      <SiteFooter />
      <Toast message={toastMessage} />
    </div>
  )
}

export default FramePage
