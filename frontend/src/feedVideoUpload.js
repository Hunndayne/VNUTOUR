export const MAX_VIDEO_BYTES = 100 * 1024 * 1024

export function validateFeedVideo(file) {
  if (!/\.(mp4|webm)$/i.test(file.name)) throw new Error('video_type_not_allowed')
  if (file.size <= 0) throw new Error('invalid_video_size')
  if (file.size > MAX_VIDEO_BYTES) throw new Error('video_too_large')
}

export function videoErrorMessage(error) {
  const messages = {
    video_too_large: 'Mỗi video được tải lên tối đa 100 MB.',
    video_type_not_allowed: 'Chọn video MP4 hoặc WebM. MP4 H.264 tương thích tốt nhất.',
    invalid_video_size: 'File video rỗng hoặc có dung lượng không hợp lệ.',
    invalid_video_file: 'Nội dung file không đúng định dạng MP4/WebM.',
    video_storage_unavailable: 'Kho video chưa sẵn sàng. Vui lòng thử lại sau.',
    video_delete_failed: 'Chưa xóa được video khỏi R2. Vui lòng thử lại; video vẫn được theo dõi để dọn sạch.',
  }
  return messages[error?.message] || 'Thao tác video thất bại. Vui lòng thử lại.'
}

export async function discardFeedVideo(id, request) {
  try {
    await request(`/admin/feed/videos/${id}`, { method: 'DELETE' })
  } catch (error) {
    // Retrying cleanup after a lost successful response is safe.
    if (error?.status !== 404) throw error
  }
}

export async function uploadFeedVideo(file, { signal, onStarted, onProgress, request }) {
  validateFeedVideo(file)
  // Do not abort this small request: retain its ID so cancellation can clean up.
  const started = await request('/admin/feed/videos', {
    method: 'POST', body: { name: file.name, size: file.size },
  })
  onStarted(started.video.id)
  const size = started.part_size
  if (!Number.isInteger(size) || size <= 0) throw new Error('invalid_part_size')
  for (let offset = 0, number = 1; offset < file.size; offset += size, number += 1) {
    if (signal.aborted) throw new DOMException('Upload cancelled', 'AbortError')
    const form = new FormData()
    form.append('part', file.slice(offset, offset + size), 'part.bin')
    await request(`/admin/feed/videos/${started.video.id}/parts/${number}`, {
      method: 'POST', body: form, signal,
    })
    onProgress(Math.round(Math.min(offset + size, file.size) / file.size * 100))
  }
  if (signal.aborted) throw new DOMException('Upload cancelled', 'AbortError')
  const result = await request(`/admin/feed/videos/${started.video.id}`, { method: 'POST', signal })
  return result.video
}
