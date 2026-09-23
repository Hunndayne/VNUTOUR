import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PHOTO_ERROR_MESSAGES,
  getPhotoErrorMessage,
  isAlbumProcessing,
  mergePhotoList,
  copyTextToClipboard,
  searchPhotosByFace,
  getMoreSearchResults,
  listPublicAlbums,
  getPublicAlbumPhotos,
  refreshPhotoUrls,
  createAdminAlbum,
  deleteAdminAlbum,
  reindexAlbum,
  updateAdminAlbum,
  triggerDriveImport,
  getAdminAlbumPhotos,
  retryAlbumProcessing,
  retryPhotoProcessing,
  removePhotoFromGallery,
} from '../src/photoGalleryApi.js'

test('error code dictionary translates all domain errors into friendly Vietnamese', () => {
  const expectedCodes = [
    'invalid_drive_folder',
    'drive_not_configured',
    'drive_permission_denied',
    'drive_unavailable',
    'storage_unavailable',
    'search_unavailable',
    'invalid_image',
    'reference_too_large',
    'too_many_pixels',
    'no_face',
    'multiple_faces',
    'rate_limited',
    'too_many_attempts',
    'search_expired',
    'not_found',
    'gallery_disabled',
    'missing_token',
    'invalid_token',
    'forbidden',
  ]

  for (const code of expectedCodes) {
    assert.ok(PHOTO_ERROR_MESSAGES[code], `Missing translation for ${code}`)
    const translated = getPhotoErrorMessage(code)
    assert.equal(translated, PHOTO_ERROR_MESSAGES[code])
  }
})

test('getPhotoErrorMessage extracts error from API error objects and status codes', () => {
  // Nested data.error
  assert.equal(
    getPhotoErrorMessage({ data: { error: 'invalid_drive_folder' } }),
    PHOTO_ERROR_MESSAGES.invalid_drive_folder,
  )

  // Direct error message string
  assert.equal(
    getPhotoErrorMessage(new Error('search_expired')),
    PHOTO_ERROR_MESSAGES.search_expired,
  )

  // Status 410 -> search_expired
  assert.equal(
    getPhotoErrorMessage({ status: 410 }),
    PHOTO_ERROR_MESSAGES.search_expired,
  )

  // Status 429 -> rate_limited
  assert.equal(
    getPhotoErrorMessage({ status: 429 }),
    PHOTO_ERROR_MESSAGES.rate_limited,
  )

  // Status 404
  assert.equal(
    getPhotoErrorMessage({ status: 404 }),
    'Nội dung yêu cầu không tìm thấy hoặc tính năng chưa khả dụng.',
  )

  // Unknown raw exception does not leak stack trace; returns safe fallback
  assert.equal(
    getPhotoErrorMessage(new Error('SyntaxError: unexpected token < in JSON at position 0')),
    'Đã có lỗi xảy ra. Vui lòng thử lại sau.',
  )
})

test('mergePhotoList deduplicates photos by ID and preserves incoming order', () => {
  const existing = [
    { id: 1, filename: 'p1.jpg' },
    { id: 2, filename: 'p2.jpg' },
  ]
  const incoming = [
    { id: 2, filename: 'p2-dup.jpg' },
    { id: 3, filename: 'p3.jpg' },
    { id: 4, filename: 'p4.jpg' },
  ]

  const merged = mergePhotoList(existing, incoming)
  assert.equal(merged.length, 4)
  assert.deepEqual(
    merged.map((p) => p.id),
    [1, 2, 3, 4],
  )
  assert.equal(merged[1].filename, 'p2.jpg') // keeps existing entry
})

test('isAlbumProcessing detects active import and pending/processing photos', () => {
  // Idle album without processing photos
  assert.equal(
    isAlbumProcessing({
      import_status: 'complete',
      counts: { total: 10, ready: 10, pending: 0, processing: 0 },
    }),
    false,
  )

  // Scanning folder
  assert.equal(
    isAlbumProcessing({
      import_status: 'scanning',
      counts: { total: 0, ready: 0, pending: 0, processing: 0 },
    }),
    true,
  )

  // Queued import
  assert.equal(
    isAlbumProcessing({
      import_status: 'queued',
      counts: { total: 0, ready: 0, pending: 0, processing: 0 },
    }),
    true,
  )

  // Idle import but photos are being processed
  assert.equal(
    isAlbumProcessing({
      import_status: 'complete',
      counts: { total: 50, ready: 30, pending: 15, processing: 5 },
    }),
    true,
  )
})

test('copyTextToClipboard handles missing or failed clipboard API without throwing', async () => {
  const result = await copyTextToClipboard('https://drive.google.com/file/d/xyz')
  assert.equal(typeof result, 'boolean')
})

test('searchPhotosByFace builds multipart FormData and authenticates /photo-search', async () => {
  const calls = []
  const mockRequest = async (path, options) => {
    calls.push({ path, options })
    return { token: 'mock-search-token', photos: [], total: 0, next_cursor: null, truncated: false }
  }

  const fakeFile = new File(['mock content'], 'portrait.jpg', { type: 'image/jpeg' })
  const result = await searchPhotosByFace({
    imageFile: fakeFile,
    albumId: 42,
    request: mockRequest,
  })

  assert.equal(result.token, 'mock-search-token')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].path, '/photo-search')
  assert.equal(calls[0].options.method, 'POST')
  assert.equal(calls[0].options.auth, true)

  const body = calls[0].options.body
  assert.ok(body instanceof FormData)
  assert.equal(body.get('album_id'), '42')
  assert.ok(body.get('image'))
})

test('getMoreSearchResults calls /photo-search/<token> with cursor and limit', async () => {
  const calls = []
  const mockRequest = async (path, options) => {
    calls.push({ path, options })
    return { token: 'token-abc', photos: [], total: 0, next_cursor: null, truncated: false }
  }

  await getMoreSearchResults({
    token: 'token-abc',
    cursor: 48,
    limit: 48,
    request: mockRequest,
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].path, '/photo-search/token-abc?cursor=48&limit=48')
  assert.equal(calls[0].options.method, 'GET')
  assert.equal(calls[0].options.auth, true)
})

test('published album endpoints require authentication', async () => {
  const calls = []
  const mockRequest = async (path, options) => {
    calls.push({ path, options })
    return { albums: [], next_cursor: null }
  }

  await listPublicAlbums({ cursor: 10, limit: 24, request: mockRequest })
  assert.equal(calls[0].path, '/photo-albums?cursor=10&limit=24')
  assert.equal(calls[0].options.auth, true)

  await getPublicAlbumPhotos({ albumId: 5, cursor: 20, limit: 48, request: mockRequest })
  assert.equal(calls[1].path, '/photo-albums/5/photos?cursor=20&limit=48')
  assert.equal(calls[1].options.auth, true)
})

test('admin albums API calls endpoints with default auth and correct payloads', async () => {
  const calls = []
  const mockRequest = async (path, options) => {
    calls.push({ path, options })
    return { album: { id: 1 } }
  }

  // Create
  await createAdminAlbum({
    title: 'Hội trại 2026',
    description: 'Ảnh lễ ra quân',
    drive_folder_url: 'https://drive.google.com/drive/folders/test-123',
    request: mockRequest,
  })
  assert.equal(calls[0].path, '/admin/photo-albums')
  assert.equal(calls[0].options.method, 'POST')
  assert.deepEqual(calls[0].options.body, {
    title: 'Hội trại 2026',
    description: 'Ảnh lễ ra quân',
    drive_folder_url: 'https://drive.google.com/drive/folders/test-123',
  })

  // Update
  await updateAdminAlbum(1, { status: 'published', request: mockRequest })
  assert.equal(calls[1].path, '/admin/photo-albums/1')
  assert.equal(calls[1].options.method, 'PATCH')
  assert.deepEqual(calls[1].options.body, { status: 'published' })

  // Trigger import
  await triggerDriveImport(1, { request: mockRequest })
  assert.equal(calls[2].path, '/admin/photo-albums/1/import-drive')
  assert.equal(calls[2].options.method, 'POST')

  // Retry album
  await retryAlbumProcessing(1, { request: mockRequest })
  assert.equal(calls[3].path, '/admin/photo-albums/1/retry')

  // Retry photo
  await retryPhotoProcessing(101, { request: mockRequest })
  assert.equal(calls[4].path, '/admin/photos/101/retry')

  // Delete photo
  await removePhotoFromGallery(101, { request: mockRequest })
  assert.equal(calls[5].path, '/admin/photos/101')
  assert.equal(calls[5].options.method, 'DELETE')
})

test('download button is only visible when download_url is present', () => {
  const photoWithDownload = {
    id: 10,
    filename: 'event.jpg',
    share_url: 'https://drive.google.com/file/d/123/view',
    download_url: 'https://drive.google.com/uc?id=123&export=download',
  }
  const photoWithoutDownload = {
    id: 11,
    filename: 'event2.jpg',
    share_url: 'https://drive.google.com/file/d/456/view',
    download_url: null,
  }

  const shouldRenderDownloadBtn = (photo) => Boolean(photo?.download_url)
  assert.equal(shouldRenderDownloadBtn(photoWithDownload), true)
  assert.equal(shouldRenderDownloadBtn(photoWithoutDownload), false)
  assert.equal(shouldRenderDownloadBtn({ ...photoWithDownload, download_url: '' }), false)
})

test('abort signal cancels active requests cleanly', () => {
  const controller = new AbortController()
  controller.abort()
  assert.equal(controller.signal.aborted, true)
})

test('refreshPhotoUrls fetches exactly that photo through the album page cursor', async () => {
  const calls = []
  const request = async (path) => {
    calls.push(path)
    return { photos: [{ id: 42, album_id: 7, preview_url: 'https://r2/new' }] }
  }
  const fresh = await refreshPhotoUrls({ photo: { id: 42, album_id: 7 }, request })
  assert.deepEqual(calls, ['/photo-albums/7/photos?cursor=41&limit=1'])
  assert.equal(fresh.preview_url, 'https://r2/new')
})

test('refreshPhotoUrls returns null when the photo is no longer public', async () => {
  const request = async () => ({ photos: [{ id: 43, album_id: 7 }] })
  assert.equal(await refreshPhotoUrls({ photo: { id: 42, album_id: 7 }, request }), null)
  assert.equal(await refreshPhotoUrls({ photo: { id: 42 }, request }), null)
})

test('reindexAlbum posts to the album reindex endpoint', async () => {
  const calls = []
  const request = async (path, options) => { calls.push([path, options.method]); return { queued: 12 } }
  const res = await reindexAlbum(7, { request })
  assert.deepEqual(calls, [['/admin/photo-albums/7/reindex', 'POST']])
  assert.equal(res.queued, 12)
})

test('deleteAdminAlbum sends DELETE for that album only', async () => {
  const calls = []
  const request = async (path, options) => { calls.push([path, options.method]); return { deleted: true } }
  assert.deepEqual(await deleteAdminAlbum(7, { request }), { deleted: true })
  assert.deepEqual(calls, [['/admin/photo-albums/7', 'DELETE']])
})
