// ─────────────────────────────────────────────────────────────────────
// Error Code Translations (Tiếng Việt)
// ─────────────────────────────────────────────────────────────────────
export const PHOTO_ERROR_MESSAGES = {
  invalid_drive_folder: 'Đường dẫn thư mục Google Drive không hợp lệ. Vui lòng kiểm tra lại link.',
  drive_not_configured: 'Hệ thống chưa cấu hình kết nối Google Drive. Vui lòng liên hệ quản trị viên.',
  drive_permission_denied: 'Quyền truy cập thư mục Google Drive bị từ chối. Vui lòng kiểm tra quyền chia sẻ thư mục.',
  drive_unavailable: 'Dịch vụ Google Drive tạm thời không khả dụng. Vui lòng thử lại sau ít phút.',
  storage_unavailable: 'Dịch vụ lưu trữ hình ảnh tạm thời gián đoạn. Vui lòng thử lại sau.',
  search_unavailable: 'Dịch vụ tìm kiếm khuôn mặt AI tạm thời chưa sẵn sàng. Bạn vẫn có thể xem các album bình thường.',
  model_unavailable: 'AI chưa xử lý được ảnh này. Ảnh vẫn xem được; hãy thử xử lý AI lại sau.',
  too_many_faces: 'Ảnh có quá nhiều khuôn mặt để xử lý AI. Ảnh vẫn xem được trong album.',
  processing_failed: 'Xử lý ảnh thất bại. Vui lòng thử lại.',
  worker_interrupted: 'Quá trình xử lý bị gián đoạn. Vui lòng thử lại.',
  source_changed: 'Ảnh gốc đã thay đổi. Vui lòng đồng bộ lại album từ Drive.',
  source_unavailable: 'Ảnh gốc không còn trong thư mục Drive. Vui lòng kiểm tra và đồng bộ lại album.',
  invalid_image: 'Tệp ảnh không hợp lệ. Vui lòng chọn ảnh định dạng JPEG, PNG hoặc WebP.',
  reference_too_large: 'Dung lượng ảnh tham chiếu vượt quá giới hạn tối đa (10 MB).',
  too_many_pixels: 'Độ phân giải của ảnh quá lớn. Vui lòng chọn một ảnh nhỏ hơn.',
  no_face: 'Không tìm thấy khuôn mặt rõ ràng trong ảnh. Vui lòng chụp hoặc chọn ảnh rõ khuôn mặt của một người.',
  multiple_faces: 'Phát hiện nhiều hơn một khuôn mặt trong ảnh. Vui lòng chọn ảnh chỉ có một người chụp chính diện.',
  rate_limited: 'Bạn đã thực hiện quá nhiều yêu cầu. Vui lòng đợi trong giây lát rồi thử lại.',
  too_many_attempts: 'Có quá nhiều lượt thử không thành công. Vui lòng thử lại sau.',
  search_expired: 'Phiên tìm kiếm đã hết hạn sau 10 phút. Vui lòng chọn lại ảnh để tìm kiếm mới.',
  not_found: 'Album hoặc ảnh không tồn tại hoặc đã bị gỡ khỏi hệ thống.',
  gallery_disabled: 'Tính năng thư viện ảnh sự kiện tạm thời chưa được kích hoạt.',
  gallery_unavailable: 'Thư viện ảnh đang tạm gián đoạn. Vui lòng thử lại sau ít phút.',
  missing_token: 'Bạn cần đăng nhập để thực hiện tác vụ này.',
  invalid_token: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
  forbidden: 'Bạn không có quyền thực hiện thao tác này.',
  team_not_approved: 'Thư viện ảnh chỉ dành cho thành viên đội đã được duyệt, quản trị viên và cộng tác viên.',
}

/**
 * Lấy thông điệp lỗi tiếng Việt thân thiện, không để lộ exception kỹ thuật thô.
 */
export function getPhotoErrorMessage(error, fallback = 'Đã có lỗi xảy ra. Vui lòng thử lại sau.') {
  if (!error) return fallback

  const code = error?.data?.error || error?.message || error
  if (typeof code === 'string' && PHOTO_ERROR_MESSAGES[code]) {
    return PHOTO_ERROR_MESSAGES[code]
  }

  // HTTP status handling fallback
  const status = error?.status || error?.originalStatus
  if (status === 404) {
    return 'Nội dung yêu cầu không tìm thấy hoặc tính năng chưa khả dụng.'
  }
  if (status === 410) {
    return PHOTO_ERROR_MESSAGES.search_expired
  }
  if (status === 429) {
    return PHOTO_ERROR_MESSAGES.rate_limited
  }
  if (status === 503) {
    return 'Dịch vụ máy chủ tạm thời bận hoặc đang bảo trì. Vui lòng thử lại sau.'
  }

  return fallback
}

// ─────────────────────────────────────────────────────────────────────
// Dynamic API Request Resolver (hỗ trợ DI trong test & lazy import)
// ─────────────────────────────────────────────────────────────────────
let customApiRequest = null

export function setApiRequest(fn) {
  customApiRequest = fn
}

async function resolveRequest(injectedRequest) {
  if (injectedRequest) return injectedRequest
  if (customApiRequest) return customApiRequest
  const mod = await import('./api.js')
  return mod.apiRequest
}

// ─────────────────────────────────────────────────────────────────────
// Gallery endpoints: approved team members, admins and collaborators.
// ─────────────────────────────────────────────────────────────────────

/**
 * Lấy danh sách album đã xuất bản cho người dùng công khai.
 * GET /photo-albums?cursor=<id>&limit=24
 */
export async function listPublicAlbums({ cursor = null, limit = 24, signal, request } = {}) {
  const req = await resolveRequest(request)
  const query = new URLSearchParams()
  if (cursor !== null && cursor !== undefined) query.set('cursor', String(cursor))
  if (limit) query.set('limit', String(limit))

  const queryString = query.toString()
  const path = `/photo-albums${queryString ? `?${queryString}` : ''}`

  return req(path, {
    method: 'GET',
    auth: true,
    signal,
  })
}

/**
 * Lấy danh sách ảnh trong một album công khai.
 * GET /photo-albums/<id>/photos?cursor=<id>&limit=48
 */
export async function getPublicAlbumPhotos({ albumId, cursor = null, limit = 48, signal, request } = {}) {
  if (!albumId) throw new Error('missing_album_id')
  const req = await resolveRequest(request)

  const query = new URLSearchParams()
  if (cursor !== null && cursor !== undefined) query.set('cursor', String(cursor))
  if (limit) query.set('limit', String(limit))

  const queryString = query.toString()
  const path = `/photo-albums/${albumId}/photos${queryString ? `?${queryString}` : ''}`

  return req(path, {
    method: 'GET',
    auth: true,
    signal,
  })
}

/**
 * Lấy lại link R2 mới cho một ảnh khi link cũ (hạn 5 phút) đã hết hạn.
 * Dùng cursor = id - 1, limit = 1 của trang album để nhận đúng ảnh đó; áp dụng
 * được cả cho ảnh trong kết quả tìm kiếm vì mọi kết quả đều thuộc album đã xuất bản.
 * Trả về null nếu ảnh không còn hiển thị công khai.
 */
export async function refreshPhotoUrls({ photo, signal, request } = {}) {
  if (!photo?.id || !photo?.album_id) return null
  const data = await getPublicAlbumPhotos({
    albumId: photo.album_id,
    cursor: photo.id - 1,
    limit: 1,
    signal,
    request,
  })
  const fresh = Array.isArray(data?.photos) ? data.photos[0] : null
  return fresh?.id === photo.id ? fresh : null
}

/**
 * Tìm ảnh theo khuôn mặt bằng cách tải lên một ảnh chân dung tham chiếu.
 * POST /photo-search (multipart FormData)
 */
export async function searchPhotosByFace({ imageFile, albumId = null, signal, request } = {}) {
  if (!imageFile) throw new Error('missing_image')
  const req = await resolveRequest(request)

  const formData = new FormData()
  formData.append('image', imageFile)
  if (albumId !== null && albumId !== undefined && albumId !== '') {
    formData.append('album_id', String(albumId))
  }

  return req('/photo-search', {
    method: 'POST',
    body: formData,
    auth: true,
    signal,
  })
}

/**
 * Lấy thêm trang kết quả tìm kiếm thông qua search token (không gửi lại ảnh).
 * GET /photo-search/<token>?cursor=<offset>&limit=48
 */
export async function getMoreSearchResults({ token, cursor = null, limit = 48, signal, request } = {}) {
  if (!token) throw new Error('missing_token')
  const req = await resolveRequest(request)

  const query = new URLSearchParams()
  if (cursor !== null && cursor !== undefined) query.set('cursor', String(cursor))
  if (limit) query.set('limit', String(limit))

  const queryString = query.toString()
  const path = `/photo-search/${encodeURIComponent(token)}${queryString ? `?${queryString}` : ''}`

  return req(path, {
    method: 'GET',
    auth: true,
    signal,
  })
}

// ─────────────────────────────────────────────────────────────────────
// Admin Endpoints (auth: true mặc định)
// ─────────────────────────────────────────────────────────────────────

/**
 * Lấy danh sách album cho quản trị viên.
 * GET /admin/photo-albums?cursor=<id>&limit=24
 */
export async function listAdminAlbums({ cursor = null, limit = 24, signal, request } = {}) {
  const req = await resolveRequest(request)
  const query = new URLSearchParams()
  if (cursor !== null && cursor !== undefined) query.set('cursor', String(cursor))
  if (limit) query.set('limit', String(limit))

  const queryString = query.toString()
  const path = `/admin/photo-albums${queryString ? `?${queryString}` : ''}`

  return req(path, {
    method: 'GET',
    signal,
  })
}

/**
 * Tạo album mới từ link Google Drive (tạo nháp và lên lịch import).
 * POST /admin/photo-albums
 */
export async function createAdminAlbum({ title, description = '', drive_folder_url, request } = {}) {
  const req = await resolveRequest(request)
  return req('/admin/photo-albums', {
    method: 'POST',
    body: {
      title,
      description,
      drive_folder_url,
    },
  })
}

/**
 * Cập nhật thông tin album (tiêu đề, mô tả, trạng thái).
 * PATCH /admin/photo-albums/<id>
 */
export async function updateAdminAlbum(id, { title, description, status, request } = {}) {
  const req = await resolveRequest(request)
  const body = {}
  if (title !== undefined) body.title = title
  if (description !== undefined) body.description = description
  if (status !== undefined) body.status = status

  return req(`/admin/photo-albums/${id}`, {
    method: 'PATCH',
    body,
  })
}

/**
 * Kích hoạt đồng bộ lại album từ Google Drive đã gắn.
 * POST /admin/photo-albums/<id>/import-drive
 */
export async function triggerDriveImport(id, { request } = {}) {
  const req = await resolveRequest(request)
  return req(`/admin/photo-albums/${id}/import-drive`, {
    method: 'POST',
    body: {},
  })
}

/**
 * Lấy danh sách ảnh trong album phía quản trị kèm tiến độ counts.
 * GET /admin/photo-albums/<id>/photos?cursor=<id>&limit=48
 */
export async function getAdminAlbumPhotos(id, { cursor = null, limit = 48, signal, request } = {}) {
  const req = await resolveRequest(request)
  const query = new URLSearchParams()
  if (cursor !== null && cursor !== undefined) query.set('cursor', String(cursor))
  if (limit) query.set('limit', String(limit))

  const queryString = query.toString()
  const path = `/admin/photo-albums/${id}/photos${queryString ? `?${queryString}` : ''}`

  return req(path, {
    method: 'GET',
    signal,
  })
}

// Refresh every page already opened, so polling updates statuses and signed
// URLs without collapsing the gallery back to its first page.
export async function getAdminLoadedPhotoPages(id, { pageCount = 1, signal, request } = {}) {
  let photos = []
  let cursor = null
  let album = null
  let pages = 0
  do {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const data = await getAdminAlbumPhotos(id, { cursor, signal, request })
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    album = data.album
    photos = mergePhotoList(photos, data.photos || [])
    cursor = data.next_cursor ?? null
    pages += 1
  } while (cursor !== null && pages < pageCount)
  return { album, photos, next_cursor: cursor, pageCount: pages }
}

/**
 * Thử lại tất cả các ảnh lỗi trong album.
 * POST /admin/photo-albums/<id>/retry
 */
export async function retryAlbumProcessing(id, { request } = {}) {
  const req = await resolveRequest(request)
  return req(`/admin/photo-albums/${id}/retry`, {
    method: 'POST',
    body: {},
  })
}

/**
 * Lập chỉ mục lại toàn album, kể cả ảnh đã xử lý xong.
 * Dùng khi đổi ngưỡng nhận diện hoặc phiên bản model.
 * POST /admin/photo-albums/<id>/reindex
 */
export async function reindexAlbum(id, { request } = {}) {
  const req = await resolveRequest(request)
  return req(`/admin/photo-albums/${id}/reindex`, {
    method: 'POST',
    body: {},
  })
}

/**
 * Xóa album và toàn bộ dữ liệu ảnh của nó trong hệ thống.
 * Không đụng tới thư mục và ảnh gốc trên Google Drive.
 * DELETE /admin/photo-albums/<id>
 */
export async function deleteAdminAlbum(id, { request } = {}) {
  const req = await resolveRequest(request)
  return req(`/admin/photo-albums/${id}`, { method: 'DELETE' })
}

/**
 * Thử lại một ảnh lỗi cụ thể.
 * POST /admin/photos/<id>/retry
 */
export async function retryPhotoProcessing(photoId, { request } = {}) {
  const req = await resolveRequest(request)
  return req(`/admin/photos/${photoId}/retry`, {
    method: 'POST',
    body: {},
  })
}

/**
 * Gỡ ảnh khỏi gallery (vẫn giữ tombstone).
 * DELETE /admin/photos/<id>
 */
export async function removePhotoFromGallery(photoId, { request } = {}) {
  const req = await resolveRequest(request)
  return req(`/admin/photos/${photoId}`, {
    method: 'DELETE',
  })
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * Nối danh sách ảnh mới vào danh sách hiện có mà không bị trùng lặp ID.
 */
export function mergePhotoList(existingPhotos = [], newPhotos = []) {
  const seenIds = new Set(existingPhotos.map((p) => p.id))
  const uniqueNext = []
  for (const photo of newPhotos) {
    if (photo && photo.id && !seenIds.has(photo.id)) {
      seenIds.add(photo.id)
      uniqueNext.push(photo)
    }
  }
  return [...existingPhotos, ...uniqueNext]
}

/**
 * Sao chép chuỗi vào clipboard an toàn, có hỗ trợ fallback.
 */
export async function copyTextToClipboard(text) {
  if (!text) return false
  if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Fallback bên dưới
    }
  }

  // Fallback: dùng textarea ẩn và execCommand nếu trình duyệt hỗ trợ
  try {
    if (typeof document !== 'undefined') {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.focus()
      textarea.select()
      const successful = document.execCommand('copy')
      document.body.removeChild(textarea)
      return Boolean(successful)
    }
  } catch {
    return false
  }

  return false
}

/**
 * Kiểm tra xem album có tác vụ import hoặc xử lý ảnh đang chạy hay không.
 */
export function isAlbumProcessing(album) {
  if (!album) return false
  const importActive = album.import_status === 'queued' || album.import_status === 'scanning'
  const counts = album.counts || {}
  const photosPending = (counts.pending || 0) > 0 || (counts.processing || 0) > 0
  return Boolean(importActive || photosPending)
}
