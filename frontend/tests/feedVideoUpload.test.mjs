import assert from 'node:assert/strict'
import test from 'node:test'
import { MAX_VIDEO_BYTES, validateFeedVideo, uploadFeedVideo, discardFeedVideo } from '../src/feedVideoUpload.js'

test('100 MB allowed, one byte over and unsupported files rejected', () => {
  validateFeedVideo({ name: 'clip.mp4', size: MAX_VIDEO_BYTES })
  assert.throws(() => validateFeedVideo({ name: 'clip.mp4', size: MAX_VIDEO_BYTES + 1 }), /video_too_large/)
  assert.throws(() => validateFeedVideo({ name: 'clip.exe', size: 20 }), /video_type_not_allowed/)
  assert.throws(() => validateFeedVideo({ name: 'clip.webm', size: 0 }), /invalid_video_size/)
})

test('upload sends bounded parts in order and completes only after every part', async () => {
  const calls = []
  const progress = []
  const file = new File(['123456789'], 'clip.mp4')
  let startedId
  const result = await uploadFeedVideo(file, {
    signal: new AbortController().signal,
    onStarted: (id) => { startedId = id },
    onProgress: (value) => progress.push(value),
    request: async (path, options) => {
      calls.push([path, options])
      if (path === '/admin/feed/videos') return { video: { id: 7 }, part_size: 4 }
      if (path === '/admin/feed/videos/7') return { video: { id: 7, state: 'ready' } }
      return { ok: true }
    },
  })
  assert.equal(startedId, 7)
  assert.deepEqual(calls.map(([path]) => path), [
    '/admin/feed/videos', '/admin/feed/videos/7/parts/1', '/admin/feed/videos/7/parts/2',
    '/admin/feed/videos/7/parts/3', '/admin/feed/videos/7',
  ])
  assert.deepEqual(calls.slice(1, 4).map(([, opts]) => opts.body.get('part').size), [4, 4, 1])
  assert.deepEqual(progress, [44, 89, 100])
  assert.equal(result.state, 'ready')
})

test('cancel during initialization retains ID for cleanup and sends no parts', async () => {
  const abort = new AbortController()
  let startedId
  let requests = 0
  await assert.rejects(uploadFeedVideo(new File(['video'], 'clip.mp4'), {
    signal: abort.signal,
    onStarted: (id) => { startedId = id },
    onProgress: () => assert.fail('no progress after cancel'),
    request: async () => {
      requests += 1
      abort.abort()
      return { video: { id: 8 }, part_size: 4 }
    },
  }), { name: 'AbortError' })
  assert.equal(startedId, 8)
  assert.equal(requests, 1)
})

test('failed part never triggers completion', async () => {
  const paths = []
  await assert.rejects(uploadFeedVideo(new File(['video'], 'clip.mp4'), {
    signal: new AbortController().signal, onStarted: () => {}, onProgress: () => {},
    request: async (path) => {
      paths.push(path)
      if (path === '/admin/feed/videos') return { video: { id: 7 }, part_size: 4 }
      throw new Error('network_error')
    },
  }), /network_error/)
  assert.deepEqual(paths, ['/admin/feed/videos', '/admin/feed/videos/7/parts/1'])
})

test('cleanup tolerates already-deleted videos but reports R2 failure', async () => {
  await discardFeedVideo(1, async () => { throw Object.assign(new Error('video_not_found'), { status: 404 }) })
  await assert.rejects(discardFeedVideo(1, async () => { throw Object.assign(new Error('video_delete_failed'), { status: 503 }) }), /video_delete_failed/)
})
