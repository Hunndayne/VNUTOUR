import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, test } from 'node:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'

// Render the real gallery/admin components, API wrappers, and history router.
// Only unrelated site chrome and the network transport are replaced.
const frontend = fileURLToPath(new URL('..', import.meta.url))
const cacheRoot = path.resolve(frontend, 'node_modules/.cache')
let bundleDir, app, dom, root, container, requests, respond, intervals
const originalGlobals = new Map()
const originalInterval = globalThis.setInterval
const originalClearInterval = globalThis.clearInterval

const albumA = { id: 1, title: 'Album A', status: 'published', import_status: 'complete', counts: { total: 3, ready: 3, indexed: 2, no_faces: 1 } }
const albumB = { ...albumA, id: 2, title: 'Album B' }
const photo = (id, albumId = 1, extra = {}) => ({ id, album_id: albumId, filename: `photo-${id}.jpg`, status: 'ready', face_count: 1, thumbnail_url: `https://images.test/${id}.webp`, ...extra })
const page = (album, photos, cursor = null) => ({ album, photos, next_cursor: cursor })
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

before(async () => {
  await mkdir(cacheRoot, { recursive: true })
  bundleDir = await mkdtemp(path.join(cacheRoot, 'photo-ui-'))
  const outfile = path.join(bundleDir, 'components.mjs')
  await build({
    stdin: { contents: `export { default as Gallery } from './src/PhotoGalleryPage.jsx'; export { default as Admin } from './src/PhotosAdminPanel.jsx'; export { setApiRequest } from './src/photoGalleryApi.js'; export { navigate } from './src/router.js';`, resolveDir: frontend },
    bundle: true, outfile, format: 'esm', platform: 'node', jsx: 'automatic',
    external: ['react', 'react/jsx-runtime'],
    plugins: [{ name: 'isolate-site-chrome', setup(builder) {
      builder.onResolve({ filter: /\/Site(Header|Footer)\.jsx$/ }, args => ({ path: args.path, namespace: 'chrome' }))
      builder.onLoad({ filter: /.*/, namespace: 'chrome' }, () => ({ contents: 'export default function Chrome() { return null }' }))
      builder.onResolve({ filter: /^\.\/api\.js$/ }, () => ({ path: 'transport', namespace: 'transport' }))
      builder.onLoad({ filter: /.*/, namespace: 'transport' }, () => ({ contents: 'export function apiRequest() { throw new Error("Network must be injected") }' }))
    } }],
  })
  app = await import(pathToFileURL(outfile).href)
})

beforeEach(() => {
  dom = new JSDOM('<div id="root"></div>', { url: 'https://vnutour.test/photos?album=1', pretendToBeVisual: true })
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, Event: dom.window.Event, IS_REACT_ACT_ENVIRONMENT: true })) {
    originalGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  intervals = new Map()
  let nextInterval = 0
  globalThis.setInterval = (callback) => { const id = ++nextInterval; intervals.set(id, callback); return id }
  globalThis.clearInterval = (id) => intervals.delete(id)
  container = document.getElementById('root')
  root = createRoot(container)
  requests = []
  respond = (url) => {
    if (url.pathname === '/photo-albums' || url.pathname === '/admin/photo-albums') return { albums: [albumA, albumB], next_cursor: null }
    if (url.pathname.endsWith('/1/photos')) return page(albumA, [photo(11)], 11)
    if (url.pathname.endsWith('/2/photos')) return page(albumB, [photo(21, 2)])
    throw new Error(`Unexpected request ${url}`)
  }
  app.setApiRequest((pathname, options) => {
    const url = new URL(pathname, 'https://api.test')
    requests.push({ url, options })
    return respond(url, options)
  })
})

afterEach(async () => {
  await act(async () => root.unmount())
  app.setApiRequest(null)
  globalThis.setInterval = originalInterval
  globalThis.clearInterval = originalClearInterval
  dom.window.close()
  for (const [key, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else delete globalThis[key]
  }
  originalGlobals.clear()
})

after(async () => {
  if (!bundleDir?.startsWith(cacheRoot + path.sep)) throw new Error('Invalid test bundle directory')
  await rm(bundleDir, { recursive: true, force: true })
})

const render = async (Component) => act(async () => root.render(createElement(Component)))
const text = () => container.textContent.replace(/\s+/g, ' ')
function button(label) {
  const match = [...container.querySelectorAll('button')].find(el => el.textContent.trim() === label)
  assert.ok(match, `Missing button: ${label}`)
  return match
}
const click = async (target) => act(async () => (typeof target === 'string' ? button(target) : target).click())
const settle = async (job, value, fail = false) => act(async () => fail ? job.reject(value) : job.resolve(value))
const navigate = async (albumId) => act(async () => app.navigate(`/photos?album=${albumId}`))
async function chooseFile() {
  const input = container.querySelector('input[type="file"]')
  Object.defineProperty(input, 'files', { configurable: true, value: [new File(['portrait'], 'reference.png', { type: 'image/png' })] })
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
}
async function selectAdminAlbum(id) {
  const cards = [...container.querySelectorAll('button')].filter(el => /^(Xem & Quản lý ảnh|Đang xem ảnh)$/.test(el.textContent.trim()))
  await click(cards[id - 1])
}
async function poll() {
  await act(async () => { await Promise.all([...intervals.values()].map(fn => fn())) })
}

test('gallery sends current album by default and omits album_id for all albums', async () => {
  const fallback = respond
  respond = (url, options) => url.pathname === '/photo-search'
    ? { token: 'token', photos: [], total: 0, next_cursor: null }
    : fallback(url, options)
  await render(app.Gallery)
  await chooseFile()
  await click('Bắt đầu tìm ảnh')
  assert.equal(requests.find(r => r.url.pathname === '/photo-search').options.body.get('album_id'), '1')
  await click('Tìm trong tất cả album')
  await click('Bắt đầu tìm ảnh')
  assert.equal(requests.filter(r => r.url.pathname === '/photo-search').at(-1).options.body.has('album_id'), false)
})

test('late gallery pagination cannot mix photos into a different album', async () => {
  const stale = deferred()
  const fallback = respond
  respond = (url, options) => url.pathname === '/photo-albums/1/photos' && url.searchParams.has('cursor') ? stale.promise : fallback(url, options)
  await render(app.Gallery)
  await click('Tải thêm ảnh')
  const pending = requests.at(-1)
  await navigate(2)
  assert.equal(pending.options.signal.aborted, true)
  await settle(stale, page(albumA, [photo(12)]))
  assert.ok(container.querySelector('img[alt="photo-21.jpg"]'))
  assert.equal(container.querySelector('img[alt="photo-12.jpg"]'), null)
  assert.equal(container.querySelector('img[alt="photo-11.jpg"]'), null)
})

test('an old initial album failure cannot replace a new album or its loading state', async () => {
  const old = deferred(), next = deferred()
  const fallback = respond
  respond = (url, options) => url.pathname === '/photo-albums/1/photos' ? old.promise
    : url.pathname === '/photo-albums/2/photos' ? next.promise : fallback(url, options)
  await render(app.Gallery)
  await navigate(2)
  await settle(old, new Error('storage_unavailable'), true)
  assert.doesNotMatch(text(), /Dịch vụ lưu trữ hình ảnh tạm thời gián đoạn/)
  await settle(next, page(albumB, [photo(21, 2)]))
  assert.ok(container.querySelector('img[alt="photo-21.jpg"]'))
})

test('late search pagination cannot append to a new search token', async () => {
  const oldPage = deferred()
  let searchCount = 0
  const fallback = respond
  respond = (url, options) => {
    if (url.pathname === '/photo-search') {
      searchCount += 1
      return { token: `search-${searchCount}`, photos: [photo(searchCount * 100)], total: 2, next_cursor: 1 }
    }
    if (url.pathname === '/photo-search/search-1') return oldPage.promise
    return fallback(url, options)
  }
  await render(app.Gallery)
  await chooseFile()
  await click('Bắt đầu tìm ảnh')
  await click('Tải thêm ảnh')
  const pending = requests.at(-1)
  await click('Bắt đầu tìm ảnh')
  assert.equal(pending.options.signal.aborted, true)
  await settle(oldPage, { token: 'search-1', photos: [photo(101)], total: 2, next_cursor: null })
  assert.ok(container.querySelector('img[alt="photo-200.jpg"]'))
  assert.equal(container.querySelector('img[alt="photo-101.jpg"]'), null)
})

test('changing album cancels a face search and clears the previous search result', async () => {
  const pendingSearch = deferred()
  const fallback = respond
  respond = (url, options) => url.pathname === '/photo-search' ? pendingSearch.promise : fallback(url, options)
  await render(app.Gallery)
  await chooseFile()
  await click('Bắt đầu tìm ảnh')
  const pending = requests.at(-1)
  await navigate(2)
  assert.equal(pending.options.signal.aborted, true)
  await settle(pendingSearch, { token: 'old', photos: [photo(100)], total: 1 })
  assert.ok(container.querySelector('img[alt="photo-21.jpg"]'))
  assert.equal(container.querySelector('img[alt="photo-100.jpg"]'), null)
  assert.equal(button('Bắt đầu tìm ảnh').disabled, false)
})

test('public AI progress excludes ready photos whose indexing failed', async () => {
  const fallback = respond
  respond = (url, options) => url.pathname.endsWith('/1/photos')
    ? page({ ...albumA, counts: { total: 3, ready: 3, indexed: 1, no_faces: 1, indexing_failed: 1 } }, [photo(11)])
    : fallback(url, options)
  await render(app.Gallery)
  assert.match(text(), /Đã xử lý AI: 2\/3/)
  assert.match(text(), /1 ảnh vẫn xem được nhưng chưa xử lý AI thành công/)
})

test('gallery hides photos and search controls when team approval is denied', async () => {
  respond = () => { throw Object.assign(new Error('team_not_approved'), { status: 403 }) }
  await render(app.Gallery)
  assert.match(text(), /chỉ dành cho thành viên đội đã được duyệt/)
  assert.equal(container.querySelector('input[type="file"]'), null)
  assert.equal(container.querySelector('img'), null)
})

test('revoked access while loading more clears previously displayed photos', async () => {
  const fallback = respond
  respond = (url, options) => {
    if (url.searchParams.has('cursor')) throw Object.assign(new Error('team_not_approved'), { status: 403 })
    return fallback(url, options)
  }
  await render(app.Gallery)
  assert.ok(container.querySelector('img[alt="photo-11.jpg"]'))
  await click('Tải thêm ảnh')
  assert.equal(container.querySelector('img[alt="photo-11.jpg"]'), null)
  assert.equal(container.querySelector('input[type="file"]'), null)
  assert.match(text(), /chỉ dành cho thành viên đội đã được duyệt/)
})

test('admin polling refreshes all loaded pages and preserves the final cursor', async () => {
  const processing = { ...albumA, counts: { ...albumA.counts, pending: 1 } }
  let refreshed = false
  const fallback = respond
  respond = (url, options) => {
    if (url.pathname === '/admin/photo-albums') return { albums: [processing, albumB] }
    if (url.pathname === '/admin/photo-albums/1/photos') {
      if (url.searchParams.get('cursor') === '11') return page(processing, [photo(12, 1, { filename: refreshed ? 'updated.jpg' : 'photo-12.jpg' })], 12)
      if (url.searchParams.get('cursor') === '12') return page(processing, [photo(13)])
      return page(processing, [photo(11)], 11)
    }
    return fallback(url, options)
  }
  await render(app.Admin)
  await selectAdminAlbum(1)
  await click('Tải thêm ảnh')
  refreshed = true
  await poll()
  assert.match(text(), /Hiển thị 2 ảnh/)
  assert.ok(container.querySelector('img[alt="updated.jpg"]'))
  await click('Tải thêm ảnh')
  assert.equal(requests.at(-1).url.searchParams.get('cursor'), '12')
  assert.match(text(), /Hiển thị 3 ảnh/)
})

test('admin ignores a delayed poll after selecting a different album', async () => {
  const oldPoll = deferred()
  const processing = { ...albumA, counts: { ...albumA.counts, pending: 1 } }
  let reads = 0
  const fallback = respond
  respond = (url, options) => {
    if (url.pathname === '/admin/photo-albums') return { albums: [processing, albumB] }
    if (url.pathname === '/admin/photo-albums/1/photos') return ++reads === 1 ? page(processing, [photo(11)]) : oldPoll.promise
    return fallback(url, options)
  }
  await render(app.Admin)
  await selectAdminAlbum(1)
  // Start the timer without awaiting its deliberately delayed network call.
  await act(async () => { for (const fn of intervals.values()) void fn() })
  const pending = requests.at(-1)
  await selectAdminAlbum(2)
  assert.equal(pending.options.signal.aborted, true)
  await settle(oldPoll, page(processing, [photo(12)]))
  assert.match(text(), /Chi Tiết Album: Album B/)
  assert.ok(container.querySelector('img[alt="photo-21.jpg"]'))
  assert.equal(container.querySelector('img[alt="photo-12.jpg"]'), null)
})

test('admin exposes indexing failures, excludes them from no-face filter, and retries them', async () => {
  const failed = photo(11, 1, { indexing_error: 'model_unavailable', face_count: 0 })
  const noFace = photo(12, 1, { face_count: 0 })
  const album = { ...albumA, counts: { total: 2, ready: 2, failed: 0, indexing_failed: 1, no_faces: 1 } }
  let retried = false
  respond = (url, options) => {
    if (url.pathname === '/admin/photo-albums') return { albums: [album] }
    if (url.pathname === '/admin/photos/11/retry') { retried = true; return { queued: 1 } }
    if (url.pathname === '/admin/photo-albums/1/photos') return page(retried ? { ...album, counts: { ...album.counts, pending: 1 } } : album, [retried ? { ...failed, status: 'pending', indexing_error: null } : failed, noFace])
    throw new Error(`Unexpected ${options.method} ${url}`)
  }
  await render(app.Admin)
  await selectAdminAlbum(1)
  assert.ok(button('Thử lại tất cả ảnh lỗi'))
  assert.match(text(), /Lỗi AI · vẫn xem được/)
  await click('Không có mặt (1)')
  assert.equal(container.querySelector('img[alt="photo-11.jpg"]'), null)
  assert.ok(container.querySelector('img[alt="photo-12.jpg"]'))
  await click('Ảnh lỗi (1)')
  assert.ok(container.querySelector('img[alt="photo-11.jpg"]'))
  await click('Thử lại')
  assert.equal(retried, true)
  assert.ok(intervals.size > 0, 'retry must restart polling from refreshed counters')
})
