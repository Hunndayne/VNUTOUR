import { useEffect, useRef, useState } from 'react'
import { apiRequest } from './api.js'
import { discardFeedVideo as discardVideo, uploadFeedVideo, validateFeedVideo, videoErrorMessage } from './feedVideoUpload.js'

const discardFeedVideo = (id) => discardVideo(id, apiRequest)

export default function useFeedVideoUploads(onError) {
  const [videos, setVideos] = useState([])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const pending = useRef(new Set())
  const controller = useRef(null)
  const active = useRef(true)

  useEffect(() => {
    active.current = true
    const drafts = pending.current
    return () => {
      active.current = false
      controller.current?.abort()
      // The server's scheduled cleanup also covers a closed tab or lost network.
      for (const id of drafts) discardFeedVideo(id).catch(() => {})
    }
  }, [])

  const reset = (items = []) => {
    setVideos(items)
    setProgress(0)
    pending.current.clear()
  }

  const upload = async (file) => {
    if (!file || busy) return
    try { validateFeedVideo(file) } catch (error) { onError(videoErrorMessage(error)); return }
    setBusy(true)
    setProgress(0)
    onError('')
    const abort = new AbortController()
    controller.current = abort
    let id
    try {
      const video = await uploadFeedVideo(file, {
        request: apiRequest,
        signal: abort.signal,
        onStarted: (value) => { id = value; pending.current.add(value) },
        onProgress: (value) => { if (active.current) setProgress(value) },
      })
      if (active.current && !abort.signal.aborted) setVideos((items) => [...items, video])
      else await discardFeedVideo(video.id)
    } catch (error) {
      if (active.current && error.name !== 'AbortError') onError(videoErrorMessage(error))
      if (id) {
        try {
          await discardFeedVideo(id)
          pending.current.delete(id)
        } catch (cleanupError) {
          if (active.current) onError(videoErrorMessage(cleanupError))
        }
      }
    } finally {
      controller.current = null
      if (active.current) setBusy(false)
    }
  }

  const remove = async (video) => {
    setBusy(true)
    try {
      if (pending.current.has(video.id)) {
        await discardFeedVideo(video.id)
        pending.current.delete(video.id)
      }
      // Existing videos are removed from R2 when the edited post is saved.
      setVideos((items) => items.filter((item) => item.id !== video.id))
    } catch (error) { onError(videoErrorMessage(error)) }
    finally { setBusy(false) }
  }

  const discard = async () => {
    if (busy) return false
    setBusy(true)
    try {
      for (const id of pending.current) {
        await discardFeedVideo(id)
        pending.current.delete(id)
      }
      return true
    } catch (error) { onError(videoErrorMessage(error)); return false }
    finally { setBusy(false) }
  }

  return {
    videos, busy, progress, reset, upload, remove, discard,
    cancel: () => controller.current?.abort(),
    saved: () => pending.current.clear(),
  }
}
