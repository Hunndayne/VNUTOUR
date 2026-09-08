import { useEffect, useRef, useState } from 'react'

export default function FeedImageCarousel({ images, title = '', compact = false }) {
  const imageUrls = Array.isArray(images) ? images.filter(Boolean) : []
  const imageKey = imageUrls.join('\n')
  const scrollerRef = useRef(null)
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    setActiveIndex(0)
    if (scrollerRef.current) scrollerRef.current.scrollLeft = 0
  }, [imageKey])

  if (imageUrls.length === 0) return null

  const goTo = (index) => {
    const nextIndex = Math.max(0, Math.min(imageUrls.length - 1, index))
    const scroller = scrollerRef.current
    if (!scroller) return
    scroller.scrollTo({ left: scroller.clientWidth * nextIndex, behavior: 'smooth' })
    setActiveIndex(nextIndex)
  }

  const handleScroll = (event) => {
    const width = event.currentTarget.clientWidth
    if (!width) return
    const nextIndex = Math.max(
      0,
      Math.min(imageUrls.length - 1, Math.round(event.currentTarget.scrollLeft / width)),
    )
    setActiveIndex(nextIndex)
  }

  const hasMultiple = imageUrls.length > 1
  const aspectClass = compact ? 'aspect-[16/9] max-h-48' : 'aspect-[4/3] max-h-[32rem]'

  return (
    <div
      className="group relative overflow-hidden rounded-xl border border-[#DCD8CC] bg-[#F3F4F1]"
      role="region"
      aria-label={`Bộ ảnh bài viết${title ? `: ${title}` : ''}`}
      onClick={(event) => event.stopPropagation()}
    >
      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain scroll-smooth [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: 'none', touchAction: 'pan-x pan-y' }}
      >
        {imageUrls.map((url, index) => (
          <div key={`${url}-${index}`} className={`${aspectClass} w-full shrink-0 snap-center`}>
            <img
              src={url}
              alt={imageUrls.length > 1 ? `${title || 'Ảnh bài viết'} — ảnh ${index + 1}` : title}
              className="h-full w-full select-none object-contain"
              loading="lazy"
              draggable="false"
            />
          </div>
        ))}
      </div>

      {hasMultiple && (
        <>
          <span className="absolute right-3 top-3 rounded-full bg-[#20312B]/75 px-2.5 py-1 font-mono text-[11px] font-semibold text-white shadow-sm backdrop-blur-sm">
            {activeIndex + 1}/{imageUrls.length}
          </span>

          <button
            type="button"
            onClick={() => goTo(activeIndex - 1)}
            disabled={activeIndex === 0}
            aria-label="Xem ảnh trước"
            className="absolute left-2 top-1/2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-lg text-[#20312B] shadow-md transition hover:bg-white disabled:pointer-events-none disabled:opacity-0 sm:flex"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => goTo(activeIndex + 1)}
            disabled={activeIndex === imageUrls.length - 1}
            aria-label="Xem ảnh tiếp theo"
            className="absolute right-2 top-1/2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-lg text-[#20312B] shadow-md transition hover:bg-white disabled:pointer-events-none disabled:opacity-0 sm:flex"
          >
            ›
          </button>

          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center gap-1.5" aria-hidden="true">
            {imageUrls.map((url, index) => (
              <span
                key={`${url}-dot-${index}`}
                className={`h-1.5 rounded-full shadow-sm transition-all ${
                  index === activeIndex ? 'w-4 bg-white' : 'w-1.5 bg-white/65'
                }`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
