import { useCallback, useEffect, useRef, useState } from 'react'
import { apiRequest, formatDateTime } from './api.js'
import { compressImage } from './imageCompress.js'
import FeedImageCarousel from './FeedImageCarousel.jsx'
import FeedVideos from './FeedVideos.jsx'
import useFeedVideoUploads from './useFeedVideoUploads.js'
import { videoErrorMessage } from './feedVideoUpload.js'
import { getFeedImageUrls } from './feedImages.js'
import MarkdownPreview from './MarkdownPreview.jsx'
import { navigate } from './router.js'
import { Badge, CARD, Icon } from './ui.jsx'

const FIELD_CLASS = 'w-full rounded-lg border border-stone bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10'
const LABEL_CLASS = 'mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40'
const PRIMARY_BTN = 'inline-flex items-center justify-center gap-1.5 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-[0.9] disabled:cursor-not-allowed disabled:opacity-40'
const SECONDARY_BTN = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-stone bg-white px-3 py-2 text-sm font-semibold text-ink/70 transition hover:bg-paper disabled:cursor-not-allowed disabled:opacity-40'
const DANGER_BTN = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-clay/30 bg-white px-3 py-2 text-sm font-semibold text-clay transition hover:bg-clay/5 disabled:cursor-not-allowed disabled:opacity-40'
const MAX_GALLERY_IMAGES = 10

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
  return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export default function FeedAdminPanel() {
  const [posts, setPosts] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [apiError, setApiError] = useState('')

  // Create/Edit modal state
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [editingPost, setEditingPost] = useState(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [imageUrls, setImageUrls] = useState([])
  const [status, setStatus] = useState('draft')
  const [isPinned, setIsPinned] = useState(false)
  const [uploadingGallery, setUploadingGallery] = useState(false)
  const [uploadingBodyImg, setUploadingBodyImg] = useState(false)
  const [savingPost, setSavingPost] = useState(false)
  const [editorError, setEditorError] = useState('')
  const videoUploads = useFeedVideoUploads(setEditorError)

  const handleCloseEditor = async () => {
    if (savingPost || uploadingGallery || uploadingBodyImg) return
    if (await videoUploads.discard()) setIsEditorOpen(false)
  }

  // Comment management modal state
  const [isCommentModalOpen, setIsCommentModalOpen] = useState(false)
  const [commentPost, setCommentPost] = useState(null)
  const [comments, setComments] = useState([])
  const [loadingComments, setLoadingComments] = useState(false)
  const [deletingCommentId, setDeletingCommentId] = useState(null)

  // Delete post modal state
  const [postToDelete, setPostToDelete] = useState(null)
  const [deletingPost, setDeletingPost] = useState(false)
  const [deletePostError, setDeletePostError] = useState('')

  // Post detail/view modal state
  const [viewingPost, setViewingPost] = useState(null)
  const [viewComments, setViewComments] = useState([])
  const [viewCommentsLoading, setViewCommentsLoading] = useState(false)
  const [viewHasMore, setViewHasMore] = useState(false)
  const [viewCommentInput, setViewCommentInput] = useState('')
  const [viewSendingComment, setViewSendingComment] = useState(false)
  const [viewReacting, setViewReacting] = useState(false)
  const [replyingTo, setReplyingTo] = useState(null)
  const [replyInput, setReplyInput] = useState('')
  const [deletingViewCommentId, setDeletingViewCommentId] = useState(null)

  const textareaRef = useRef(null)
  const galleryInputRef = useRef(null)
  const bodyImgInputRef = useRef(null)
  const videoInputRef = useRef(null)

  const fetchPosts = useCallback(async () => {
    setLoading(true)
    setApiError('')
    try {
      const res = await apiRequest('/admin/feed?limit=50&offset=0')
      setPosts(res.posts || [])
      setTotal(res.total || 0)
    } catch {
      setApiError('Không thể tải danh sách bài viết bảng tin.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchPosts()
  }, [fetchPosts])

  // Open editor for creating
  const handleOpenCreate = () => {
    setEditingPost(null)
    setTitle('')
    setBody('')
    setImageUrls([])
    videoUploads.reset()
    setStatus('draft')
    setIsPinned(false)
    setEditorError('')
    setIsEditorOpen(true)
  }

  // Open editor for editing
  const handleOpenEdit = (post) => {
    setEditingPost(post)
    setTitle(post.title || '')
    setBody(post.body || '')
    setImageUrls(getFeedImageUrls(post))
    videoUploads.reset(post.videos || [])
    setStatus(post.status || 'draft')
    setIsPinned(Boolean(post.is_pinned))
    setEditorError('')
    setIsEditorOpen(true)
  }

  // Upload one or many ordered gallery images. The first image is the table thumbnail.
  const handleGalleryUpload = async (e) => {
    const selectedFiles = Array.from(e.target.files || [])
    if (selectedFiles.length === 0) return

    const remainingSlots = MAX_GALLERY_IMAGES - imageUrls.length
    if (remainingSlots <= 0) {
      setEditorError(`Mỗi bài viết được đăng tối đa ${MAX_GALLERY_IMAGES} ảnh.`)
      if (galleryInputRef.current) galleryInputRef.current.value = ''
      return
    }

    const files = selectedFiles.slice(0, remainingSlots)
    setUploadingGallery(true)
    setEditorError('')
    try {
      const uploads = await Promise.allSettled(files.map(async (file) => {
        const compressed = await compressImage(file, { maxDim: 1600, quality: 0.8 })
        const formData = new FormData()
        formData.append('image', compressed, compressed.name || 'gallery.webp')
        if (editingPost?.id) formData.append('post_id', editingPost.id)
        const res = await apiRequest('/admin/feed/upload-image', {
          method: 'POST',
          body: formData,
        })
        if (!res.url) throw new Error('missing_image_url')
        return res.url
      }))

      const uploadedUrls = uploads
        .filter((result) => result.status === 'fulfilled')
        .map((result) => result.value)
      if (uploadedUrls.length > 0) {
        setImageUrls((current) => [...current, ...uploadedUrls].slice(0, MAX_GALLERY_IMAGES))
      }

      const failedCount = uploads.length - uploadedUrls.length
      if (failedCount > 0) {
        setEditorError(`${failedCount} ảnh tải lên thất bại. Các ảnh còn lại đã được thêm.`)
      } else if (selectedFiles.length > files.length) {
        setEditorError(`Đã thêm đủ ${MAX_GALLERY_IMAGES} ảnh; các ảnh vượt giới hạn chưa được tải lên.`)
      }
    } catch {
      setEditorError('Tải ảnh bài viết thất bại. Vui lòng kiểm tra định dạng hoặc thử lại.')
    } finally {
      setUploadingGallery(false)
      if (galleryInputRef.current) galleryInputRef.current.value = ''
    }
  }

  const moveGalleryImage = (index, direction) => {
    const nextIndex = index + direction
    if (nextIndex < 0 || nextIndex >= imageUrls.length) return
    setImageUrls((current) => {
      const reordered = [...current]
      const currentUrl = reordered[index]
      reordered[index] = reordered[nextIndex]
      reordered[nextIndex] = currentUrl
      return reordered
    })
  }

  const removeGalleryImage = (index) => {
    setImageUrls((current) => current.filter((_, imageIndex) => imageIndex !== index))
  }

  // Handle Body Image upload (one or many) & insert into textarea
  const handleBodyImageUpload = async (e) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return
    setUploadingBodyImg(true)
    setEditorError('')

    // Capture the caret up front — focus can drift across the awaits below.
    const textarea = textareaRef.current
    const start = textarea ? textarea.selectionStart : body.length
    const end = textarea ? textarea.selectionEnd : body.length

    try {
      const tags = []
      for (const file of files) {
        const compressed = await compressImage(file, { maxDim: 1600, quality: 0.8 })
        const formData = new FormData()
        formData.append('image', compressed, compressed.name || 'image.webp')
        if (editingPost?.id) formData.append('post_id', editingPost.id)
        const res = await apiRequest('/admin/feed/upload-image', {
          method: 'POST',
          body: formData,
        })
        if (res.url) {
          const altText = file.name.replace(/\.[^/.]+$/, '')
          tags.push(`![${altText}](${res.url})`)
        }
      }

      if (tags.length > 0) {
        const markdownTag = `\n\n${tags.join('\n\n')}\n\n`
        setBody(body.substring(0, start) + markdownTag + body.substring(end))
      }
    } catch {
      setEditorError('Tải ảnh chèn vào nội dung thất bại.')
    } finally {
      setUploadingBodyImg(false)
      if (bodyImgInputRef.current) bodyImgInputRef.current.value = ''
    }
  }

  // Save post (create or update)
  const handleSavePost = async (e) => {
    e.preventDefault()
    if (videoUploads.busy) return
    if (!title.trim()) {
      setEditorError('Vui lòng nhập tiêu đề bài viết.')
      return
    }

    setSavingPost(true)
    setEditorError('')
    try {
      const payload = {
        title: title.trim(),
        body: body || '',
        image_urls: imageUrls,
        video_ids: videoUploads.videos.map((video) => video.id),
        status,
        is_pinned: isPinned,
      }

      if (editingPost?.id) {
        await apiRequest(`/admin/feed/${editingPost.id}`, {
          method: 'PUT',
          body: payload,
        })
      } else {
        await apiRequest('/admin/feed', {
          method: 'POST',
          body: payload,
        })
      }

      videoUploads.saved()
      setIsEditorOpen(false)
      fetchPosts()
    } catch (err) {
      setEditorError(err?.message?.startsWith('video_') ? videoErrorMessage(err) : err?.message || 'Có lỗi xảy ra khi lưu bài viết.')
    } finally {
      setSavingPost(false)
    }
  }

  // Toggle pin
  const handleTogglePin = async (post) => {
    try {
      await apiRequest(`/admin/feed/${post.id}/pin`, { method: 'POST' })
      fetchPosts()
    } catch {
      // ignore
    }
  }

  // Confirm delete post
  const handleDeletePost = async () => {
    if (!postToDelete) return
    setDeletingPost(true)
    setDeletePostError('')
    try {
      await apiRequest(`/admin/feed/${postToDelete.id}`, { method: 'DELETE' })
      setPostToDelete(null)
      fetchPosts()
    } catch (error) {
      setDeletePostError(error?.message === 'video_delete_failed' ? videoErrorMessage(error) : 'Xoá bài viết thất bại.')
    } finally {
      setDeletingPost(false)
    }
  }

  // Open comments modal
  const handleOpenComments = async (post) => {
    setCommentPost(post)
    setIsCommentModalOpen(true)
    setLoadingComments(true)
    try {
      const res = await apiRequest(`/feed/${post.id}/comments?limit=100&offset=0`)
      setComments(res.comments || [])
    } catch {
      setComments([])
    } finally {
      setLoadingComments(false)
    }
  }

  // Admin delete a comment
  const handleDeleteComment = async (commentId) => {
    if (!commentPost) return
    setDeletingCommentId(commentId)
    try {
      await apiRequest(`/admin/feed/${commentPost.id}/comments/${commentId}`, {
        method: 'DELETE',
      })
      setComments((prev) => prev.filter((c) => c.id !== commentId))
      setPosts((prev) =>
        prev.map((p) =>
          p.id === commentPost.id
            ? { ...p, comment_count: Math.max(0, (p.comment_count || 0) - 1) }
            : p,
        ),
      )
    } catch {
      // ignore
    } finally {
      setDeletingCommentId(null)
    }
  }

  // ── Post Detail Modal handlers ──
  const handleOpenView = async (post) => {
    setViewingPost(post)
    setViewComments([])
    setViewCommentInput('')
    setReplyingTo(null)
    setReplyInput('')
    setViewCommentsLoading(true)
    try {
      const res = await apiRequest(`/feed/${post.id}/comments?limit=20&offset=0`)
      setViewComments(res.comments || [])
      setViewHasMore((res.comments?.length || 0) < (res.total || 0))
    } catch {
      setViewComments([])
    } finally {
      setViewCommentsLoading(false)
    }
  }

  const handleViewLoadMore = async () => {
    if (!viewingPost) return
    setViewCommentsLoading(true)
    try {
      const offset = viewComments.length
      const res = await apiRequest(`/feed/${viewingPost.id}/comments?limit=20&offset=${offset}`)
      const newComments = res.comments || []
      setViewComments((prev) => [...prev, ...newComments])
      setViewHasMore((offset + newComments.length) < (res.total || 0))
    } catch {
      // ignore
    } finally {
      setViewCommentsLoading(false)
    }
  }

  const handleViewReact = async (reactionType) => {
    if (viewReacting || !viewingPost) return
    setViewReacting(true)
    try {
      const res = await apiRequest(`/feed/${viewingPost.id}/react`, {
        method: 'POST',
        body: { type: reactionType },
      })
      setViewingPost((prev) => ({
        ...prev,
        my_reaction: res.my_reaction,
        reaction_counts: res.reaction_counts,
      }))
      // Also update in main posts list
      setPosts((prev) =>
        prev.map((p) =>
          p.id === viewingPost.id
            ? { ...p, reaction_counts: res.reaction_counts, my_reaction: res.my_reaction }
            : p,
        ),
      )
    } catch {
      // ignore
    } finally {
      setViewReacting(false)
    }
  }

  const handleViewSendComment = async (e) => {
    e.preventDefault()
    const trimmed = viewCommentInput.trim()
    if (!trimmed || viewSendingComment || !viewingPost) return
    setViewSendingComment(true)
    try {
      const res = await apiRequest(`/feed/${viewingPost.id}/comments`, {
        method: 'POST',
        body: { body: trimmed },
      })
      if (res.comment) {
        setViewComments((prev) => [res.comment, ...prev])
        setViewCommentInput('')
        setViewingPost((prev) => ({ ...prev, comment_count: (prev.comment_count || 0) + 1 }))
        setPosts((prev) =>
          prev.map((p) =>
            p.id === viewingPost.id ? { ...p, comment_count: (p.comment_count || 0) + 1 } : p,
          ),
        )
      }
    } catch {
      // ignore
    } finally {
      setViewSendingComment(false)
    }
  }

  const handleViewSendReply = async (parentComment) => {
    const trimmed = replyInput.trim()
    if (!trimmed || viewSendingComment || !viewingPost) return
    setViewSendingComment(true)
    try {
      const res = await apiRequest(`/feed/${viewingPost.id}/comments`, {
        method: 'POST',
        body: { body: trimmed, parent_id: parentComment.id },
      })
      if (res.comment) {
        // Add reply under the parent comment
        setViewComments((prev) =>
          prev.map((c) =>
            c.id === parentComment.id
              ? { ...c, replies: [...(c.replies || []), res.comment] }
              : c,
          ),
        )
        setReplyingTo(null)
        setReplyInput('')
        setViewingPost((prev) => ({ ...prev, comment_count: (prev.comment_count || 0) + 1 }))
        setPosts((prev) =>
          prev.map((p) =>
            p.id === viewingPost.id ? { ...p, comment_count: (p.comment_count || 0) + 1 } : p,
          ),
        )
      }
    } catch {
      // ignore
    } finally {
      setViewSendingComment(false)
    }
  }

  const handleViewDeleteComment = async (commentId, parentId) => {
    if (!viewingPost) return
    setDeletingViewCommentId(commentId)
    try {
      await apiRequest(`/admin/feed/${viewingPost.id}/comments/${commentId}`, {
        method: 'DELETE',
      })
      // Deleting a top-level comment also removes its replies (server cascades).
      const removed = parentId
        ? 1
        : 1 + (viewComments.find((c) => c.id === commentId)?.replies?.length || 0)
      if (parentId) {
        // Remove reply from parent
        setViewComments((prev) =>
          prev.map((c) =>
            c.id === parentId
              ? { ...c, replies: (c.replies || []).filter((r) => r.id !== commentId) }
              : c,
          ),
        )
      } else {
        // Remove top-level comment
        setViewComments((prev) => prev.filter((c) => c.id !== commentId))
      }
      setViewingPost((prev) => ({ ...prev, comment_count: Math.max(0, (prev.comment_count || 0) - removed) }))
      setPosts((prev) =>
        prev.map((p) =>
          p.id === viewingPost.id
            ? { ...p, comment_count: Math.max(0, (p.comment_count || 0) - removed) }
            : p,
        ),
      )
    } catch {
      // ignore
    } finally {
      setDeletingViewCommentId(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-xl font-bold text-ink">Bảng tin Ban tổ chức</h2>
          <p className="mt-0.5 text-xs text-ink/50">
            Đăng thông báo, tin tức và cập nhật sự kiện tới các đội đã được duyệt ({total} bài viết)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => navigate('/feed')} className={SECONDARY_BTN}>
            <Icon name="eye" className="h-4 w-4" />
            <span>Xem trang bảng tin</span>
          </button>
          <button type="button" onClick={handleOpenCreate} className={PRIMARY_BTN}>
            <span>+ Tạo bài viết mới</span>
          </button>
        </div>
      </div>

      {apiError && (
        <div className="rounded-lg border border-clay/20 bg-clay/10 p-3 text-sm text-clay">
          {apiError}
        </div>
      )}

      {/* Posts Table */}
      <div className={`${CARD} overflow-hidden`}>
        {loading ? (
          <div className="py-12 text-center text-sm text-ink/40">Đang tải danh sách bài viết...</div>
        ) : posts.length === 0 ? (
          <div className="py-12 text-center text-sm text-ink/40">
            Chưa có bài viết nào. Hãy bấm &quot;Tạo bài viết mới&quot; để bắt đầu!
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-stone bg-paper text-xs uppercase text-ink/50">
                <tr>
                  <th className="px-4 py-3">Bài viết</th>
                  <th className="px-3 py-3">Trạng thái</th>
                  <th className="px-3 py-3">Ghim</th>
                  <th className="px-3 py-3">Tương tác</th>
                  <th className="px-3 py-3">Bình luận</th>
                  <th className="px-3 py-3">Tác giả</th>
                  <th className="px-3 py-3">Ngày đăng</th>
                  <th className="px-4 py-3 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone/60">
                {posts.map((post) => {
                  const totalReactions = Object.values(post.reaction_counts || {}).reduce(
                    (a, b) => a + (Number(b) || 0),
                    0,
                  )
                  const isDraft = post.status === 'draft'
                  const postImageUrls = getFeedImageUrls(post)

                  return (
                    <tr key={post.id} className="transition hover:bg-paper/50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {postImageUrls.length > 0 ? (
                            <div className="relative h-10 w-14 shrink-0">
                              <img
                                src={postImageUrls[0]}
                                alt=""
                                className="h-full w-full rounded border border-stone object-cover"
                              />
                              {postImageUrls.length > 1 && (
                                <span className="absolute -right-1.5 -top-1.5 rounded-full bg-ink px-1.5 py-0.5 font-mono text-[9px] font-bold text-white shadow-sm">
                                  +{postImageUrls.length - 1}
                                </span>
                              )}
                            </div>
                          ) : (
                            <div className="flex h-10 w-14 shrink-0 items-center justify-center rounded bg-stone/40 text-xs text-ink/30 font-mono">
                              {post.videos?.length ? `▶ ${post.videos.length} video` : 'No img'}
                            </div>
                          )}
                          <div className="min-w-0 max-w-xs">
                            <button type="button" onClick={() => handleOpenView(post)} className="font-semibold text-ink truncate text-left hover:text-trail transition">{post.title}</button>
                            <p className="text-xs text-ink/40 truncate">
                              {post.body ? post.body.replace(/\n+/g, ' ').substring(0, 50) : '(Không có nội dung)'}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <Badge
                          label={isDraft ? 'Bản nháp' : 'Đã xuất bản'}
                          cls={isDraft ? 'bg-stone/50 text-ink/60' : 'bg-trail/15 text-trail'}
                        />
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleTogglePin(post)}
                          className={`rounded px-2 py-1 text-xs font-semibold transition ${
                            post.is_pinned
                              ? 'bg-[#E0A23A]/15 text-[#9A6B12] hover:bg-[#E0A23A]/25'
                              : 'text-ink/30 hover:bg-stone/30 hover:text-ink'
                          }`}
                          title="Bấm để bật/tắt ghim"
                        >
                          {post.is_pinned ? 'Đã ghim' : '—'}
                        </button>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap font-mono text-xs text-ink/70">
                        {totalReactions > 0 ? (
                          <span title={JSON.stringify(post.reaction_counts)}>{totalReactions}</span>
                        ) : (
                          '0'
                        )}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleOpenComments(post)}
                          className="font-mono text-xs text-trail hover:underline font-semibold"
                        >
                          {post.comment_count || 0}
                        </button>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-xs text-ink/60">
                        {post.author_name || 'BTC VNUTour'}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap font-mono text-xs text-ink/50">
                        {post.published_at ? formatDateTime(post.published_at) : '—'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-right space-x-1.5">
                        <button
                          type="button"
                          onClick={() => handleOpenView(post)}
                          className="rounded p-1 text-ink/60 hover:bg-stone/30 hover:text-ink"
                          title="Xem chi tiết bài viết"
                        >
                          <Icon name="eye" className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenEdit(post)}
                          className="rounded p-1 text-ink/60 hover:bg-stone/30 hover:text-ink"
                          title="Chỉnh sửa bài viết"
                        >
                          <Icon name="edit" className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => { setDeletePostError(''); setPostToDelete(post) }}
                          className="rounded p-1 text-clay/70 hover:bg-clay/10 hover:text-clay"
                          title="Xoá bài viết"
                        >
                          <Icon name="trash" className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Editor Modal (Split-pane) */}
      {isEditorOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="flex h-[90vh] w-full max-w-5xl flex-col rounded-2xl bg-white shadow-2xl overflow-hidden border border-stone">
            {/* Modal header */}
            <div className="flex items-center justify-between border-b border-stone px-6 py-4 bg-paper">
              <h3 className="font-display text-lg font-bold text-ink">
                {editingPost ? 'Chỉnh sửa bài viết' : 'Tạo bài viết mới'}
              </h3>
              <button
                type="button"
                onClick={handleCloseEditor}
                disabled={videoUploads.busy || savingPost}
                className="rounded-lg p-1.5 text-ink/40 hover:bg-stone/30 hover:text-ink"
              >
                ✕
              </button>
            </div>

            {editorError && (
              <div className="border-b border-clay/20 bg-clay/10 px-6 py-2.5 text-xs text-clay">
                {editorError}
              </div>
            )}

            {/* Split pane body */}
            <div className="flex-1 grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-stone overflow-hidden">
              {/* Left pane: Form controls */}
              <div className="flex flex-col h-full overflow-y-auto p-6 space-y-4">
                <div>
                  <label className={LABEL_CLASS}>Tiêu đề bài viết *</label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Nhập tiêu đề thông báo..."
                    className={FIELD_CLASS}
                    maxLength={300}
                  />
                </div>

                {/* Ordered post gallery */}
                <div className="space-y-2.5">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <label className={LABEL_CLASS}>Ảnh bài viết</label>
                      <p className="text-xs text-ink/50">
                        Tải tối đa {MAX_GALLERY_IMAGES} ảnh. Ảnh đầu tiên là ảnh đại diện.
                      </p>
                    </div>
                    <span className="shrink-0 font-mono text-[11px] text-ink/45">
                      {imageUrls.length}/{MAX_GALLERY_IMAGES}
                    </span>
                  </div>

                  <input
                    ref={galleryInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    multiple
                    onChange={handleGalleryUpload}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => galleryInputRef.current?.click()}
                    disabled={uploadingGallery || imageUrls.length >= MAX_GALLERY_IMAGES}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-trail/40 bg-trail/[0.04] px-4 py-3 text-sm font-semibold text-trail transition hover:border-trail/70 hover:bg-trail/[0.08] disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <span className="text-lg leading-none">+</span>
                    {uploadingGallery ? 'Đang tải ảnh lên...' : 'Chọn một hoặc nhiều ảnh'}
                  </button>

                  {imageUrls.length > 0 && (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {imageUrls.map((url, index) => (
                        <div key={`${url}-${index}`} className="group relative overflow-hidden rounded-lg border border-stone bg-paper">
                          <img
                            src={url}
                            alt={`Ảnh bài viết ${index + 1}`}
                            className="aspect-[4/3] w-full object-cover"
                          />
                          <div className="absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent p-1.5 text-white">
                            <span className="rounded bg-black/35 px-1.5 py-0.5 font-mono text-[10px] font-bold backdrop-blur-sm">
                              {index === 0 ? 'Ảnh bìa' : index + 1}
                            </span>
                            <button
                              type="button"
                              onClick={() => removeGalleryImage(index)}
                              className="flex h-6 w-6 items-center justify-center rounded-full bg-black/35 text-xs transition hover:bg-clay"
                              aria-label={`Xoá ảnh ${index + 1}`}
                            >
                              ✕
                            </button>
                          </div>
                          {imageUrls.length > 1 && (
                            <div className="absolute inset-x-0 bottom-0 flex justify-center gap-1 bg-gradient-to-t from-black/65 to-transparent p-1.5 pt-5">
                              <button
                                type="button"
                                onClick={() => moveGalleryImage(index, -1)}
                                disabled={index === 0}
                                className="flex h-6 w-7 items-center justify-center rounded bg-white/90 text-sm font-bold text-ink transition hover:bg-white disabled:opacity-30"
                                aria-label={`Đưa ảnh ${index + 1} sang trước`}
                              >
                                ←
                              </button>
                              <button
                                type="button"
                                onClick={() => moveGalleryImage(index, 1)}
                                disabled={index === imageUrls.length - 1}
                                className="flex h-6 w-7 items-center justify-center rounded bg-white/90 text-sm font-bold text-ink transition hover:bg-white disabled:opacity-30"
                                aria-label={`Đưa ảnh ${index + 1} ra sau`}
                              >
                                →
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2.5">
                  <label className={LABEL_CLASS}>Video bài viết</label>
                  <p className="text-xs text-ink/50">MP4 hoặc WebM, tối đa 100 MB/file. Video đã đăng được xóa khỏi R2 khi bạn gỡ video và lưu bài, hoặc xóa bài.</p>
                  <input
                    ref={videoInputRef}
                    type="file"
                    accept="video/mp4,video/webm,.mp4,.webm"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      event.target.value = ''
                      videoUploads.upload(file)
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => videoInputRef.current?.click()}
                    disabled={videoUploads.busy || savingPost}
                    aria-label="Tải video bảng tin, tối đa 100 MB"
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-trail/40 bg-trail/[0.04] px-4 py-3 text-sm font-semibold text-trail transition hover:border-trail/70 hover:bg-trail/[0.08] disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <span className="text-lg leading-none">+</span>
                    {videoUploads.busy ? 'Đang tải video lên...' : 'Chọn video'}
                  </button>
                  {videoUploads.busy && (
                    <div className="space-y-1" role="status">
                      <progress value={videoUploads.progress} max="100" className="w-full accent-trail" />
                      <div className="flex items-center justify-between text-xs text-ink/60">
                        <span>Đang xử lý video… {videoUploads.progress}%</span>
                        <button type="button" onClick={videoUploads.cancel} className="text-clay">Dừng tải lên</button>
                      </div>
                    </div>
                  )}
                  {videoUploads.videos.map((video) => (
                    <div key={video.id} className="flex items-center justify-between gap-3 rounded-lg border border-stone p-3 text-xs">
                      <span className="min-w-0 truncate">{video.name} · {(video.size / 1024 / 1024).toFixed(1)} MB</span>
                      <button type="button" disabled={videoUploads.busy || savingPost} onClick={() => videoUploads.remove(video)} className="shrink-0 text-clay disabled:opacity-40">Gỡ video</button>
                    </div>
                  ))}
                </div>

                {/* Body editor */}
                <div className="flex-1 flex flex-col min-h-[220px]">
                  <div className="flex items-center justify-between mb-1.5">
                    <label className={LABEL_CLASS}>Nội dung Markdown</label>
                    <div className="flex items-center gap-2">
                      <input
                        ref={bodyImgInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        multiple
                        onChange={handleBodyImageUpload}
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={() => bodyImgInputRef.current?.click()}
                        disabled={uploadingBodyImg}
                        className="text-xs font-semibold text-trail hover:underline"
                      >
                        {uploadingBodyImg ? 'Đang tải ảnh...' : 'Chèn ảnh vào bài'}
                      </button>
                    </div>
                  </div>
                  <textarea
                    ref={textareaRef}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="Soạn Markdown; nhúng video bằng @[video](link Facebook hoặc YouTube)"
                    className={`${FIELD_CLASS} flex-1 resize-none font-mono text-xs leading-relaxed`}
                  />
                  <p className="mt-1.5 text-[11px] text-ink/45">
                    Video: dán riêng link Facebook/YouTube, iframe được copy, hoặc dùng @[video](link).
                  </p>
                </div>

                {/* Post Options */}
                <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-stone/60">
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
                      <input
                        type="radio"
                        name="post_status"
                        checked={status === 'draft'}
                        onChange={() => setStatus('draft')}
                        className="accent-trail"
                      />
                      <span>Bản nháp</span>
                    </label>
                    <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
                      <input
                        type="radio"
                        name="post_status"
                        checked={status === 'published'}
                        onChange={() => setStatus('published')}
                        className="accent-trail"
                      />
                      <span className="font-semibold text-trail">Xuất bản ngay</span>
                    </label>
                  </div>

                  <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isPinned}
                      onChange={(e) => setIsPinned(e.target.checked)}
                      className="accent-[#E0A23A] rounded"
                    />
                    <span>Ghim bài lên đầu</span>
                  </label>
                </div>
              </div>

              {/* Right pane: Live preview */}
              <div className="flex flex-col h-full overflow-y-auto p-6 bg-[#F3F4F1]/40">
                <p className="font-mono text-[10px] uppercase tracking-widest text-ink/40 mb-3">
                  Xem trước trực tiếp (Live Preview)
                </p>
                <div className="rounded-xl border border-stone bg-white p-5 shadow-sm space-y-4">
                  <div className="flex items-center gap-2 text-xs text-ink/50">
                    {isPinned && (
                      <span className="rounded bg-[#E0A23A]/15 px-2 py-0.5 text-xs font-semibold text-[#9A6B12]">
                        Đã ghim
                      </span>
                    )}
                    <span>BTC VNUTour</span>
                    <span>•</span>
                    <span>Vừa xong</span>
                  </div>

                  <h2 className="font-display text-xl font-bold text-ink">
                    {title || '(Chưa có tiêu đề)'}
                  </h2>

                  {imageUrls.length > 0 && (
                    <FeedImageCarousel images={imageUrls} title={title || 'Bài viết xem trước'} compact />
                  )}

                  <div className="border-t border-stone/50 pt-3">
                    <FeedVideos videos={videoUploads.videos} />
                    <MarkdownPreview
                      content={body || ''}
                      emptyMessage="Nội dung xem trước sẽ hiển thị ở đây..."
                      allowVideos
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Modal footer */}
            <div className="flex items-center justify-end gap-3 border-t border-stone px-6 py-3.5 bg-paper">
              <button
                type="button"
                onClick={handleCloseEditor}
                disabled={videoUploads.busy || savingPost}
                className={SECONDARY_BTN}
              >
                Huỷ
              </button>
              <button
                type="button"
                onClick={handleSavePost}
                disabled={savingPost || videoUploads.busy || uploadingGallery || uploadingBodyImg}
                className={PRIMARY_BTN}
              >
                {savingPost ? 'Đang lưu...' : status === 'published' ? 'Xuất bản' : 'Lưu bản nháp'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Post Detail / View Modal */}
      {viewingPost && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="flex h-[90vh] w-full max-w-3xl flex-col rounded-2xl bg-white shadow-2xl overflow-hidden border border-stone">
            {/* Modal header */}
            <div className="flex items-center justify-between border-b border-stone px-6 py-4 bg-paper">
              <h3 className="font-display text-lg font-bold text-ink truncate pr-4">
                {viewingPost.title}
              </h3>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setViewingPost(null)
                    handleOpenEdit(viewingPost)
                  }}
                  className={SECONDARY_BTN}
                >
                  <Icon name="edit" className="h-3.5 w-3.5" />
                  Chỉnh sửa
                </button>
                <button
                  type="button"
                  onClick={() => setViewingPost(null)}
                  className="rounded-lg p-1.5 text-ink/40 hover:bg-stone/30 hover:text-ink"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {/* Post meta */}
              <div className="flex items-center gap-2 text-xs text-ink/60">
                {viewingPost.is_pinned && (
                  <span className="rounded bg-[#E0A23A]/15 px-2.5 py-0.5 text-xs font-semibold text-[#9A6B12]">
                    Đã ghim
                  </span>
                )}
                <span className="font-semibold text-ink/90">{viewingPost.author_name || 'BTC VNUTour'}</span>
                <span>•</span>
                <span>{formatRelativeTime(viewingPost.published_at || viewingPost.created_at)}</span>
                <Badge
                  label={viewingPost.status === 'draft' ? 'Bản nháp' : 'Đã xuất bản'}
                  cls={viewingPost.status === 'draft' ? 'bg-stone/50 text-ink/60' : 'bg-trail/15 text-trail'}
                />
              </div>

              {/* Title */}
              <h2 className="font-display text-xl sm:text-2xl font-bold text-ink leading-snug">
                {viewingPost.title}
              </h2>

              {/* Image gallery */}
              {(() => {
                const urls = getFeedImageUrls(viewingPost)
                return urls.length > 0 ? <FeedImageCarousel images={urls} title={viewingPost.title} /> : null
              })()}

              {/* Uploaded videos */}
              <FeedVideos videos={viewingPost.videos} />

              {/* Markdown body */}
              <div className="border-t border-stone/50 pt-4">
                <MarkdownPreview content={viewingPost.body || ''} emptyMessage="(Không có nội dung)" allowVideos />
              </div>

              {/* Reaction bar */}
              <div className="flex flex-wrap items-center gap-2 border-t border-stone/50 pt-4">
                {EMOJIS.map(({ type, emoji }) => {
                  const count = viewingPost.reaction_counts?.[type] || 0
                  const isSelected = viewingPost.my_reaction === type
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => handleViewReact(type)}
                      disabled={viewReacting}
                      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition active:scale-95 ${
                        isSelected
                          ? 'border border-trail bg-trail/15 text-trail font-bold shadow-sm'
                          : 'border border-stone bg-white text-ink/75 hover:bg-paper hover:text-ink'
                      }`}
                    >
                      <span>{emoji}</span>
                      {count > 0 && <span>{count}</span>}
                    </button>
                  )
                })}
              </div>

              {/* Comments section */}
              <div className="border-t border-stone/50 pt-5 space-y-4">
                <h3 className="font-display text-sm font-bold text-ink/90">
                  {viewingPost.comment_count || 0} bình luận
                </h3>

                {/* Comment input */}
                <form onSubmit={handleViewSendComment} className="space-y-2">
                  <textarea
                    value={viewCommentInput}
                    onChange={(e) => setViewCommentInput(e.target.value)}
                    placeholder="Viết bình luận với tư cách BTC..."
                    maxLength={1000}
                    rows={2}
                    className={`${FIELD_CLASS} resize-none`}
                  />
                  <div className="flex justify-between items-center">
                    <span className="font-mono text-[11px] text-ink/40">{viewCommentInput.length}/1000</span>
                    <button
                      type="submit"
                      disabled={!viewCommentInput.trim() || viewSendingComment}
                      className={PRIMARY_BTN}
                    >
                      {viewSendingComment ? 'Đang gửi...' : 'Gửi bình luận'}
                    </button>
                  </div>
                </form>

                {/* Comments list */}
                {viewCommentsLoading && viewComments.length === 0 ? (
                  <div className="py-6 text-center text-sm text-ink/40">Đang tải bình luận...</div>
                ) : viewComments.length === 0 ? (
                  <div className="py-6 text-center text-sm text-ink/40">Chưa có bình luận nào.</div>
                ) : (
                  <div className="space-y-3">
                    {viewComments.map((comment) => (
                      <div key={comment.id} className="space-y-2">
                        {/* Top-level comment */}
                        <div className="rounded-lg border border-stone/60 bg-paper/50 p-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 text-xs">
                              {comment.team_name && (
                                <span className="font-bold text-trail">{comment.team_name}</span>
                              )}
                              {comment.team_name && comment.author_name && <span>•</span>}
                              {comment.author_name && (
                                <span className="font-medium text-ink/80">{comment.author_name}</span>
                              )}
                              <span>•</span>
                              <span className="font-mono text-ink/40">{formatRelativeTime(comment.created_at)}</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleViewDeleteComment(comment.id, null)}
                              disabled={deletingViewCommentId === comment.id}
                              className="text-xs font-semibold text-clay/70 hover:text-clay"
                              title="Xoá bình luận"
                            >
                              {deletingViewCommentId === comment.id ? '...' : 'Xoá'}
                            </button>
                          </div>
                          <p className="mt-1.5 text-sm text-ink whitespace-pre-line leading-relaxed">
                            {comment.body}
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              setReplyingTo(replyingTo === comment.id ? null : comment.id)
                              setReplyInput('')
                            }}
                            className="mt-2 text-xs font-semibold text-trail hover:underline"
                          >
                            Trả lời
                          </button>
                        </div>

                        {/* Replies */}
                        {(comment.replies || []).length > 0 && (
                          <div className="ml-6 space-y-2">
                            {comment.replies.map((reply) => (
                              <div key={reply.id} className="rounded-lg border border-stone/40 bg-white p-3">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2 text-xs">
                                    <span className="text-ink/30">↳</span>
                                    {reply.team_name && (
                                      <span className="font-bold text-trail">{reply.team_name}</span>
                                    )}
                                    {reply.team_name && reply.author_name && <span>•</span>}
                                    {reply.author_name && (
                                      <span className="font-medium text-ink/80">{reply.author_name}</span>
                                    )}
                                    <span>•</span>
                                    <span className="font-mono text-ink/40">{formatRelativeTime(reply.created_at)}</span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => handleViewDeleteComment(reply.id, comment.id)}
                                    disabled={deletingViewCommentId === reply.id}
                                    className="text-xs font-semibold text-clay/70 hover:text-clay"
                                    title="Xoá trả lời"
                                  >
                                    {deletingViewCommentId === reply.id ? '...' : 'Xoá'}
                                  </button>
                                </div>
                                <p className="mt-1.5 text-sm text-ink whitespace-pre-line leading-relaxed">
                                  {reply.body}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Reply input */}
                        {replyingTo === comment.id && (
                          <div className="ml-6">
                            <div className="flex gap-2">
                              <input
                                type="text"
                                value={replyInput}
                                onChange={(e) => setReplyInput(e.target.value)}
                                placeholder={`Trả lời ${comment.author_name || ''}...`}
                                maxLength={1000}
                                className={`${FIELD_CLASS} flex-1`}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault()
                                    handleViewSendReply(comment)
                                  }
                                }}
                              />
                              <button
                                type="button"
                                onClick={() => handleViewSendReply(comment)}
                                disabled={!replyInput.trim() || viewSendingComment}
                                className={PRIMARY_BTN}
                              >
                                Gửi
                              </button>
                              <button
                                type="button"
                                onClick={() => { setReplyingTo(null); setReplyInput('') }}
                                className={SECONDARY_BTN}
                              >
                                Huỷ
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}

                    {viewHasMore && (
                      <div className="pt-2 text-center">
                        <button
                          type="button"
                          onClick={handleViewLoadMore}
                          disabled={viewCommentsLoading}
                          className="text-xs font-semibold text-trail hover:underline"
                        >
                          {viewCommentsLoading ? 'Đang tải...' : 'Xem thêm bình luận'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Comment Management Modal */}
      {isCommentModalOpen && commentPost && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="flex h-[80vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-2xl overflow-hidden border border-stone">
            <div className="flex items-center justify-between border-b border-stone px-6 py-4 bg-paper">
              <div>
                <h3 className="font-display text-base font-bold text-ink">
                  Quản lý bình luận
                </h3>
                <p className="text-xs text-ink/50 truncate max-w-md">
                  Bài viết: {commentPost.title}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsCommentModalOpen(false)}
                className="rounded-lg p-1.5 text-ink/40 hover:bg-stone/30 hover:text-ink"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {loadingComments ? (
                <div className="py-12 text-center text-sm text-ink/40">Đang tải bình luận...</div>
              ) : comments.length === 0 ? (
                <div className="py-12 text-center text-sm text-ink/40">
                  Bài viết này chưa có bình luận nào.
                </div>
              ) : (
                <div className="space-y-3 divide-y divide-stone/60">
                  {comments.map((comment) => (
                    <div key={comment.id} className="pt-3 first:pt-0 flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-xs">
                          {comment.team_name && (
                            <span className="font-bold text-trail">{comment.team_name}</span>
                          )}
                          {comment.team_name && comment.author_name && <span>•</span>}
                          {comment.author_name && (
                            <span className="font-medium text-ink/80">{comment.author_name}</span>
                          )}
                          <span>•</span>
                          <span className="font-mono text-ink/40">{formatDateTime(comment.created_at)}</span>
                        </div>
                        <p className="mt-1 text-sm text-ink whitespace-pre-line leading-relaxed">
                          {comment.body}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleDeleteComment(comment.id)}
                        disabled={deletingCommentId === comment.id}
                        className={DANGER_BTN}
                        title="Xoá bình luận không phù hợp"
                      >
                        {deletingCommentId === comment.id ? 'Đang xoá...' : 'Xoá'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end border-t border-stone px-6 py-3.5 bg-paper">
              <button
                type="button"
                onClick={() => setIsCommentModalOpen(false)}
                className={SECONDARY_BTN}
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {postToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-stone space-y-4">
            <h3 className="font-display text-lg font-bold text-ink">Xác nhận xoá bài viết</h3>
            <p className="text-sm text-ink/70">
              Bạn có chắc chắn muốn xoá bài viết &quot;<strong className="text-ink">{postToDelete.title}</strong>&quot;? Mọi tương tác và bình luận liên quan cũng sẽ bị xoá vĩnh viễn.
            </p>
            {deletePostError && <p role="alert" className="text-sm text-clay">{deletePostError}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPostToDelete(null)}
                disabled={deletingPost}
                className={SECONDARY_BTN}
              >
                Huỷ
              </button>
              <button
                type="button"
                onClick={handleDeletePost}
                disabled={deletingPost}
                className={DANGER_BTN}
              >
                {deletingPost ? 'Đang xoá...' : 'Xác nhận xoá'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
