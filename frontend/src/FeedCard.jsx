import { useEffect, useState } from 'react'
import { apiRequest } from './api.js'
import MarkdownPreview from './MarkdownPreview.jsx'
import { stripMarkdown } from './markdownUtils.jsx'
import { navigate } from './router.js'

const PARTICIPANT_CARD = 'rounded-xl border border-[#DCD8CC] bg-white shadow-[0_1px_3px_rgba(32,49,43,0.05)]'
const TRAIL_BUTTON = 'inline-flex items-center justify-center gap-2 rounded-lg bg-[#1F7A6B] px-4 py-2 text-sm font-semibold text-white transition hover:brightness-95 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45'

const EMOJIS = [
  { type: 'heart', emoji: '❤️' },
  { type: 'like', emoji: '👍' },
  { type: 'fire', emoji: '🔥' },
  { type: 'haha', emoji: '😂' },
  { type: 'wow', emoji: '😮' },
]

function formatRelativeTime(dateStr) {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  const now = new Date()
  const diffSec = Math.floor((now - date) / 1000)
  if (diffSec < 60) return 'Vừa xong'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin} phút trước`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour} giờ trước`
  const diffDay = Math.floor(diffHour / 24)
  if (diffDay < 7) return `${diffDay} ngày trước`
  return date.toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

export default function FeedCard({ post, compact = false, onPostUpdated }) {
  const [postState, setPostState] = useState(post)
  const [comments, setComments] = useState([])
  const [commentsLoaded, setCommentsLoaded] = useState(false)
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [hasMoreComments, setHasMoreComments] = useState(false)
  const [commentInput, setCommentInput] = useState('')
  const [sendingComment, setSendingComment] = useState(false)
  const [reacting, setReacting] = useState(false)

  useEffect(() => {
    setPostState(post)
  }, [post])

  const totalReactions = Object.values(postState?.reaction_counts || {}).reduce(
    (acc, count) => acc + (Number(count) || 0),
    0,
  )

  const commentCount = postState?.comment_count || 0

  // Load initial comments in full view
  useEffect(() => {
    if (!compact && postState?.id && !commentsLoaded) {
      loadComments(0)
    }
  }, [compact, postState?.id, commentsLoaded])

  const loadComments = async (offset = 0) => {
    if (!postState?.id) return
    setCommentsLoading(true)
    try {
      const res = await apiRequest(`/feed/${postState.id}/comments?limit=5&offset=${offset}`)
      const newComments = res.comments || []
      if (offset === 0) {
        setComments(newComments)
      } else {
        setComments((prev) => [...prev, ...newComments])
      }
      setHasMoreComments((offset + newComments.length) < (res.total || 0))
      setCommentsLoaded(true)
    } catch {
      // ignore
    } finally {
      setCommentsLoading(false)
    }
  }

  const handleReact = async (reactionType) => {
    if (reacting || !postState?.id) return
    setReacting(true)

    // Optimistic reaction update
    const currentReaction = postState.my_reaction
    const isTogglingOff = currentReaction === reactionType
    const newReactionCounts = { ...(postState.reaction_counts || {}) }

    if (currentReaction && newReactionCounts[currentReaction] > 0) {
      newReactionCounts[currentReaction] -= 1
    }
    if (!isTogglingOff) {
      newReactionCounts[reactionType] = (newReactionCounts[reactionType] || 0) + 1
    }

    const optimisticPost = {
      ...postState,
      my_reaction: isTogglingOff ? null : reactionType,
      reaction_counts: newReactionCounts,
    }
    setPostState(optimisticPost)

    try {
      const res = await apiRequest(`/feed/${postState.id}/react`, {
        method: 'POST',
        body: { type: reactionType },
      })
      const updated = {
        ...postState,
        my_reaction: res.my_reaction,
        reaction_counts: res.reaction_counts,
      }
      setPostState(updated)
      if (onPostUpdated) onPostUpdated(updated)
    } catch {
      // rollback to previous postState
      setPostState(post)
    } finally {
      setReacting(false)
    }
  }

  const handleSendComment = async (e) => {
    e.preventDefault()
    const trimmed = commentInput.trim()
    if (!trimmed || sendingComment || !postState?.id) return

    setSendingComment(true)
    try {
      const res = await apiRequest(`/feed/${postState.id}/comments`, {
        method: 'POST',
        body: { body: trimmed },
      })
      if (res.comment) {
        setComments((prev) => [res.comment, ...prev])
        setCommentInput('')
        const updated = {
          ...postState,
          comment_count: (postState.comment_count || 0) + 1,
        }
        setPostState(updated)
        if (onPostUpdated) onPostUpdated(updated)
      }
    } catch {
      // comment error
    } finally {
      setSendingComment(false)
    }
  }

  const handleDeleteComment = async (commentId) => {
    if (!postState?.id) return
    try {
      await apiRequest(`/feed/${postState.id}/comments/${commentId}`, {
        method: 'DELETE',
      })
      setComments((prev) => prev.filter((c) => c.id !== commentId))
      const updated = {
        ...postState,
        comment_count: Math.max(0, (postState.comment_count || 0) - 1),
      }
      setPostState(updated)
      if (onPostUpdated) onPostUpdated(updated)
    } catch {
      // ignore
    }
  }

  // Compact Mode (for ParticipantDashboard)
  if (compact) {
    const plainText = stripMarkdown(postState.body || '')
    return (
      <article
        onClick={() => navigate('/feed')}
        className={`${PARTICIPANT_CARD} cursor-pointer p-4 sm:p-5 transition hover:border-[#1F7A6B]/50 hover:shadow-md`}
      >
        <div className="flex items-center gap-2 text-xs text-ink/60 mb-2">
          {postState.is_pinned && (
            <span className="inline-flex items-center rounded bg-[#E0A23A]/15 px-2 py-0.5 text-[11px] font-semibold text-[#9A6B12]">
              Đã ghim
            </span>
          )}
          <span className="font-medium text-ink/80">{postState.author_name || 'BTC VNUTour'}</span>
          <span>•</span>
          <span>{formatRelativeTime(postState.published_at || postState.created_at)}</span>
        </div>

        <h3 className="font-display text-base font-bold text-ink sm:text-lg line-clamp-1">
          {postState.title}
        </h3>

        {postState.cover_image_url && (
          <div className="mt-3 overflow-hidden rounded-lg border border-[#DCD8CC] max-h-48">
            <img
              src={postState.cover_image_url}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
            />
          </div>
        )}

        <p className="mt-2 text-sm leading-relaxed text-ink/70 line-clamp-3">
          {plainText}
        </p>

        <div className="mt-3 flex items-center justify-between border-t border-[#DCD8CC]/60 pt-3 text-xs text-ink/60">
          <div className="flex items-center gap-2">
            {totalReactions > 0 ? (
              <span className="font-medium text-ink/80">{totalReactions} tương tác</span>
            ) : (
              <span>Chưa có tương tác</span>
            )}
          </div>
          <div>{commentCount} bình luận</div>
        </div>
      </article>
    )
  }

  // Full Mode (for FeedPage)
  return (
    <article className={`${PARTICIPANT_CARD} overflow-hidden p-5 sm:p-6`}>
      {/* Header */}
      <div className="mb-3 flex items-center gap-2 text-xs text-ink/60">
        {postState.is_pinned && (
          <span className="inline-flex items-center rounded bg-[#E0A23A]/15 px-2.5 py-0.5 text-xs font-semibold text-[#9A6B12]">
            Đã ghim
          </span>
        )}
        <span className="font-semibold text-ink/90">{postState.author_name || 'BTC VNUTour'}</span>
        <span>•</span>
        <span>{formatRelativeTime(postState.published_at || postState.created_at)}</span>
      </div>

      <h2 className="font-display text-xl sm:text-2xl font-bold text-ink leading-snug">
        {postState.title}
      </h2>

      {/* Cover Image */}
      {postState.cover_image_url && (
        <div className="my-4 overflow-hidden rounded-xl border border-[#DCD8CC]">
          <img
            src={postState.cover_image_url}
            alt={postState.title}
            className="w-full max-h-96 object-cover"
            loading="lazy"
          />
        </div>
      )}

      {/* Markdown Body */}
      <div className="my-4 text-ink leading-relaxed">
        <MarkdownPreview content={postState.body || ''} />
      </div>

      {/* Reaction Bar */}
      <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-[#DCD8CC]/70 pt-4">
        {EMOJIS.map(({ type, emoji }) => {
          const count = postState.reaction_counts?.[type] || 0
          const isSelected = postState.my_reaction === type
          return (
            <button
              key={type}
              type="button"
              onClick={() => handleReact(type)}
              disabled={reacting}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs sm:text-sm font-medium transition active:scale-95 ${
                isSelected
                  ? 'border border-[#1F7A6B] bg-[#1F7A6B]/15 text-[#1F7A6B] font-bold shadow-sm'
                  : 'border border-[#DCD8CC] bg-white text-ink/75 hover:bg-[#F3F4F1] hover:text-ink'
              }`}
            >
              <span>{emoji}</span>
              {count > 0 && <span>{count}</span>}
            </button>
          )
        })}
      </div>

      {/* Comment Section */}
      <section className="mt-6 border-t border-[#DCD8CC]/70 pt-5">
        <h3 className="font-display text-sm font-bold text-ink/90 mb-3">
          {commentCount} bình luận
        </h3>

        {/* Comment input */}
        <form onSubmit={handleSendComment} className="mb-4 space-y-2">
          <textarea
            value={commentInput}
            onChange={(e) => setCommentInput(e.target.value)}
            placeholder="Viết bình luận cho bài viết này..."
            maxLength={1000}
            rows={2}
            className="w-full rounded-lg border border-[#DCD8CC] bg-[#F3F4F1]/30 p-2.5 text-sm text-ink placeholder-ink/40 transition focus:border-[#1F7A6B] focus:bg-white focus:outline-none"
          />
          <div className="flex justify-between items-center text-xs text-ink/40">
            <span>{commentInput.length}/1000</span>
            <button
              type="submit"
              disabled={!commentInput.trim() || sendingComment}
              className={TRAIL_BUTTON}
            >
              {sendingComment ? 'Đang gửi...' : 'Gửi'}
            </button>
          </div>
        </form>

        {/* Comments list */}
        {comments.length > 0 ? (
          <div className="space-y-3 divide-y divide-[#DCD8CC]/40">
            {comments.map((comment) => (
              <div key={comment.id} className="pt-3 first:pt-0">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    {comment.team_name && (
                      <span className="font-bold text-[#1F7A6B]">{comment.team_name}</span>
                    )}
                    {comment.team_name && comment.author_name && <span>•</span>}
                    {comment.author_name && (
                      <span className="font-medium text-ink/80">{comment.author_name}</span>
                    )}
                    <span>•</span>
                    <span className="text-ink/40">{formatRelativeTime(comment.created_at)}</span>
                  </div>
                  {comment.is_my_comment && (
                    <button
                      type="button"
                      onClick={() => handleDeleteComment(comment.id)}
                      className="text-[#D6492B] hover:underline"
                    >
                      Xoá
                    </button>
                  )}
                </div>
                <p className="mt-1 text-sm text-ink/85 whitespace-pre-line leading-relaxed">
                  {comment.body}
                </p>
              </div>
            ))}

            {hasMoreComments && (
              <div className="pt-3 text-center">
                <button
                  type="button"
                  onClick={() => loadComments(comments.length)}
                  disabled={commentsLoading}
                  className="text-xs font-semibold text-[#1F7A6B] hover:underline"
                >
                  {commentsLoading ? 'Đang tải...' : 'Xem thêm bình luận cũ hơn'}
                </button>
              </div>
            )}
          </div>
        ) : commentsLoaded ? (
          <p className="py-2 text-xs italic text-ink/40">Chưa có bình luận nào. Hãy là người đầu tiên bình luận!</p>
        ) : null}
      </section>
    </article>
  )
}
