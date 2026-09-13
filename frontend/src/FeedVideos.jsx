export default function FeedVideos({ videos = [], compact = false }) {
  if (!videos.length) return null
  return (
    <div className="my-4 space-y-3" onClick={(event) => event.stopPropagation()}>
      {(compact ? videos.slice(0, 1) : videos).map((video) => (
        <video
          key={video.id}
          src={video.url}
          controls
          autoPlay
          muted
          playsInline
          preload="metadata"
          aria-label={video.name || 'Video bài viết'}
          className="max-h-[520px] w-full rounded-xl bg-black"
        >
          Trình duyệt không phát được video này. <a href={video.url}>Tải video</a>
        </video>
      ))}
      {compact && videos.length > 1 && <p className="text-xs text-ink/50">+{videos.length - 1} video trong bài viết</p>}
    </div>
  )
}
