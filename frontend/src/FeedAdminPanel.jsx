import { useCallback, useEffect, useRef, useState } from 'react'
import { apiRequest, formatDateTime } from './api.js'
import { compressImage } from './imageCompress.js'
import MarkdownPreview from './MarkdownPreview.jsx'
import { Badge, CARD, Icon } from './ui.jsx'

const FIELD_CLASS = 'w-full rounded-lg border border-stone bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10'
const LABEL_CLASS = 'mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40'
const PRIMARY_BTN = 'inline-flex items-center justify-center gap-1.5 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-[0.9] disabled:cursor-not-allowed disabled:opacity-40'
const SECONDARY_BTN = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-stone bg-white px-3 py-2 text-sm font-semibold text-ink/70 transition hover:bg-paper disabled:cursor-not-allowed disabled:opacity-40'
const DANGER_BTN = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-clay/30 bg-white px-3 py-2 text-sm font-semibold text-clay transition hover:bg-clay/5 disabled:cursor-not-allowed disabled:opacity-40'

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
  const [coverImageUrl, setCoverImageUrl] = useState('')
  const [status, setStatus] = useState('draft')
  const [isPinned, setIsPinned] = useState(false)
  const [uploadingCover, setUploadingCover] = useState(false)
  const [uploadingBodyImg, setUploadingBodyImg] = useState(false)
  const [savingPost, setSavingPost] = useState(false)
  const [editorError, setEditorError] = useState('')

  // Comment management modal state
  const [isCommentModalOpen, setIsCommentModalOpen] = useState(false)
  const [commentPost, setCommentPost] = useState(null)
  const [comments, setComments] = useState([])
  const [loadingComments, setLoadingComments] = useState(false)
  const [deletingCommentId, setDeletingCommentId] = useState(null)

  // Delete post modal state
  const [postToDelete, setPostToDelete] = useState(null)
  const [deletingPost, setDeletingPost] = useState(false)

  const textareaRef = useRef(null)
  const coverInputRef = useRef(null)
  const bodyImgInputRef = useRef(null)

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
    setCoverImageUrl('')
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
    setCoverImageUrl(post.cover_image_url || '')
    setStatus(post.status || 'draft')
    setIsPinned(Boolean(post.is_pinned))
    setEditorError('')
    setIsEditorOpen(true)
  }

  // Handle Cover Image upload
  const handleCoverUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingCover(true)
    setEditorError('')
    try {
      const compressed = await compressImage(file, { maxDim: 1600, quality: 0.8 })
      const formData = new FormData()
      formData.append('image', compressed, compressed.name || 'cover.webp')
      if (editingPost?.id) formData.append('post_id', editingPost.id)
      const res = await apiRequest('/admin/feed/upload-image', {
        method: 'POST',
        body: formData,
      })
      if (res.url) {
        setCoverImageUrl(res.url)
      }
    } catch {
      setEditorError('Tải ảnh bìa thất bại. Vui lòng kiểm tra định dạng hoặc thử lại.')
    } finally {
      setUploadingCover(false)
      if (coverInputRef.current) coverInputRef.current.value = ''
    }
  }

  // Handle Body Image upload & insert into textarea
  const handleBodyImageUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingBodyImg(true)
    setEditorError('')
    try {
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
        const markdownTag = `\n\n![${altText}](${res.url})\n\n`
        const textarea = textareaRef.current
        if (textarea) {
          const start = textarea.selectionStart || body.length
          const end = textarea.selectionEnd || body.length
          const newBody = body.substring(0, start) + markdownTag + body.substring(end)
          setBody(newBody)
        } else {
          setBody((prev) => prev + markdownTag)
        }
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
        cover_image_url: coverImageUrl.trim(),
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

      setIsEditorOpen(false)
      fetchPosts()
    } catch (err) {
      setEditorError(err?.message || 'Có lỗi xảy ra khi lưu bài viết.')
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
    try {
      await apiRequest(`/admin/feed/${postToDelete.id}`, { method: 'DELETE' })
      setPostToDelete(null)
      fetchPosts()
    } catch {
      setApiError('Xoá bài viết thất bại.')
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
        <button type="button" onClick={handleOpenCreate} className={PRIMARY_BTN}>
          <span>+ Tạo bài viết mới</span>
        </button>
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

                  return (
                    <tr key={post.id} className="transition hover:bg-paper/50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {post.cover_image_url ? (
                            <img
                              src={post.cover_image_url}
                              alt=""
                              className="h-10 w-14 shrink-0 rounded object-cover border border-stone"
                            />
                          ) : (
                            <div className="flex h-10 w-14 shrink-0 items-center justify-center rounded bg-stone/40 text-xs text-ink/30 font-mono">
                              No img
                            </div>
                          )}
                          <div className="min-w-0 max-w-xs">
                            <p className="font-semibold text-ink truncate">{post.title}</p>
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
                          {post.is_pinned ? '📌 Ghim' : '—'}
                        </button>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap font-mono text-xs text-ink/70">
                        {totalReactions > 0 ? (
                          <span title={JSON.stringify(post.reaction_counts)}>❤️ {totalReactions}</span>
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
                          💬 {post.comment_count || 0}
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
                          onClick={() => handleOpenEdit(post)}
                          className="rounded p-1 text-ink/60 hover:bg-stone/30 hover:text-ink"
                          title="Chỉnh sửa bài viết"
                        >
                          <Icon name="edit" className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setPostToDelete(post)}
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
                onClick={() => setIsEditorOpen(false)}
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

                {/* Cover image upload */}
                <div>
                  <label className={LABEL_CLASS}>Ảnh bìa (Thumbnail/Cover)</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={coverImageUrl}
                      onChange={(e) => setCoverImageUrl(e.target.value)}
                      placeholder="URL ảnh bìa hoặc tải lên từ máy..."
                      className={`${FIELD_CLASS} flex-1`}
                    />
                    <input
                      ref={coverInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={handleCoverUpload}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => coverInputRef.current?.click()}
                      disabled={uploadingCover}
                      className={SECONDARY_BTN}
                    >
                      {uploadingCover ? 'Đang tải...' : 'Tải ảnh'}
                    </button>
                    {coverImageUrl && (
                      <button
                        type="button"
                        onClick={() => setCoverImageUrl('')}
                        className="text-xs text-clay hover:underline"
                      >
                        Xoá
                      </button>
                    )}
                  </div>
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
                        onChange={handleBodyImageUpload}
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={() => bodyImgInputRef.current?.click()}
                        disabled={uploadingBodyImg}
                        className="text-xs font-semibold text-trail hover:underline"
                      >
                        {uploadingBodyImg ? 'Đang tải ảnh...' : '📷 Chèn ảnh vào bài'}
                      </button>
                    </div>
                  </div>
                  <textarea
                    ref={textareaRef}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="Soạn nội dung bằng Markdown (tiêu đề ##, danh sách -, liên kết [tên](link), ảnh ![mô tả](link)...)"
                    className={`${FIELD_CLASS} flex-1 resize-none font-mono text-xs leading-relaxed`}
                  />
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
                    <span>📌 Ghim bài lên đầu</span>
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
                        📌 Đã ghim
                      </span>
                    )}
                    <span>BTC VNUTour</span>
                    <span>•</span>
                    <span>Vừa xong</span>
                  </div>

                  <h2 className="font-display text-xl font-bold text-ink">
                    {title || '(Chưa có tiêu đề)'}
                  </h2>

                  {coverImageUrl && (
                    <div className="overflow-hidden rounded-lg border border-stone max-h-56">
                      <img src={coverImageUrl} alt="" className="w-full object-cover" />
                    </div>
                  )}

                  <div className="border-t border-stone/50 pt-3">
                    <MarkdownPreview content={body || ''} emptyMessage="Nội dung xem trước sẽ hiển thị ở đây..." />
                  </div>
                </div>
              </div>
            </div>

            {/* Modal footer */}
            <div className="flex items-center justify-end gap-3 border-t border-stone px-6 py-3.5 bg-paper">
              <button
                type="button"
                onClick={() => setIsEditorOpen(false)}
                className={SECONDARY_BTN}
              >
                Huỷ
              </button>
              <button
                type="button"
                onClick={handleSavePost}
                disabled={savingPost}
                className={PRIMARY_BTN}
              >
                {savingPost ? 'Đang lưu...' : status === 'published' ? 'Xuất bản' : 'Lưu bản nháp'}
              </button>
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
