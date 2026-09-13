import { useEffect, useRef } from 'react'

function FeedVideo({ video }) {
  const ref = useRef(null)

  // Play only while the video is in view; pause when scrolled away so
  // off-screen posts don't stream. Muted playback is what browsers allow.
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) el.play().catch(() => {})
        else el.pause()
      },
      { threshold: 0.5 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <video
      ref={ref}
      src={video.url}
      controls
      muted
      playsInline
      preload="metadata"
      aria-label={video.name || 'Video bài viết'}
      className="max-h-[520px] w-full rounded-xl bg-black"
    >
      Trình duyệt không phát được video này. <a href={video.url}>Tải video</a>
    </video>
  )
}

export default function FeedVideos({ videos = [], compact = false }) {
  if (!videos.length) return null
  return (
    <div className="my-4 space-y-3" onClick={(event) => event.stopPropagation()}>
      {(compact ? videos.slice(0, 1) : videos).map((video) => (
        <FeedVideo key={video.id} video={video} />
      ))}
      {compact && videos.length > 1 && <p className="text-xs text-ink/50">+{videos.length - 1} video trong bài viết</p>}
    </div>
  )
}
