// API client for the public "ghép khung ảnh" (photo frame) tool.
//
// Shared contract between the public editor (FramePage) and the admin
// management panel so the two never diverge on paths or payload shapes.
//
// A frame object looks like:
//   { id, title, description, width, height, image_url, download_count,
//     // admin listings additionally include:
//     is_active, sort_order, created_at }
//
// `image_url` is served from the API origin WITH CORS headers, so an
// <img crossOrigin="anonymous"> can be drawn onto a canvas and exported
// (toBlob) without tainting it.

import { API_BASE_URL, apiRequest } from './api.js'

// ---------------------------------------------------------------------------
// Public (no auth)
// ---------------------------------------------------------------------------

/**
 * Absolute, same-API-origin URL for a frame's image bytes. Load it with
 * `crossOrigin="anonymous"` so the composited canvas stays exportable.
 */
export function frameImageUrl(frameId) {
  return `${API_BASE_URL}/public/frames/${frameId}/image`
}

/** List active frames for the public gallery. */
export async function listPublicFrames() {
  const data = await apiRequest('/public/frames', { auth: false })
  return data?.frames || []
}

/** Get a single active public frame by ID. */
export async function getPublicFrame(frameId) {
  const data = await apiRequest(`/public/frames/${frameId}`, { auth: false })
  return data?.frame || null
}

/**
 * Record one successful compose + download. Best-effort telemetry — it must
 * never block or fail the user's download, so it swallows errors.
 * `turnstileToken` is required by the server when the anti-bot switch is on.
 */
export async function logFrameDownload(frameId, { turnstileToken = '' } = {}) {
  try {
    return await apiRequest(`/public/frames/${frameId}/download`, {
      method: 'POST',
      auth: false,
      body: turnstileToken ? { turnstile_token: turnstileToken } : {},
    })
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Admin (auth required, admin role)
// ---------------------------------------------------------------------------

/** List every frame (active + draft) with download counts, for admin. */
export async function listAdminFrames() {
  const data = await apiRequest('/admin/frames')
  return data?.frames || []
}

/** Create a frame from an uploaded image file (multipart). */
export async function createFrame({ file, title, description = '', isActive = false }) {
  const form = new FormData()
  form.append('file', file)
  form.append('title', title)
  form.append('description', description)
  form.append('is_active', isActive ? '1' : '0')
  return apiRequest('/admin/frames', { method: 'POST', body: form })
}

/**
 * Update a frame. `patch` may contain any of:
 *   { title, description, is_active, sort_order, file }
 * When `file` is present the request is sent multipart (image replaced),
 * otherwise a plain JSON PATCH.
 */
export async function updateFrame(id, patch = {}) {
  if (patch.file) {
    const form = new FormData()
    form.append('file', patch.file)
    if (patch.title != null) form.append('title', patch.title)
    if (patch.description != null) form.append('description', patch.description)
    if (patch.is_active != null) form.append('is_active', patch.is_active ? '1' : '0')
    if (patch.sort_order != null) form.append('sort_order', String(patch.sort_order))
    return apiRequest(`/admin/frames/${id}`, { method: 'PATCH', body: form })
  }
  return apiRequest(`/admin/frames/${id}`, { method: 'PATCH', body: patch })
}

/** Delete a frame (its download logs are kept, with the title snapshotted). */
export async function deleteFrame(id) {
  return apiRequest(`/admin/frames/${id}`, { method: 'DELETE' })
}

/**
 * Recent download activity across all frames plus totals.
 * Returns { total, frames: [{ id, title, download_count }], recent: [...] }.
 */
export async function getFrameStats({ limit = 50 } = {}) {
  return apiRequest(`/admin/frames/downloads?limit=${limit}`)
}
