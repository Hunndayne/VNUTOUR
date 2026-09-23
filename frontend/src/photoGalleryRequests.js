// Abort alone is insufficient if a response has already resolved. Each request
// must still own its slot before changing data, errors, or loading indicators.
export function createPhotoRequestSlot() {
  let current = null
  return {
    get pending() { return current !== null },
    cancel() {
      current?.controller.abort()
      current = null
    },
    start() {
      this.cancel()
      const request = { controller: new AbortController() }
      current = request
      return {
        signal: request.controller.signal,
        isCurrent: () => current === request && !request.controller.signal.aborted,
        finish() {
          if (current === request) current = null
        },
      }
    },
  }
}

export function hasPhotoFailure(photo) {
  return photo.status === 'failed' || (photo.status === 'ready' && Boolean(photo.indexing_error))
}

export function hasCompletedPhotoIndex(photo) {
  return photo.status === 'ready' && !photo.indexing_error
}
