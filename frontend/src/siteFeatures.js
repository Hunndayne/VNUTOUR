import { useEffect, useState } from 'react'
import { apiRequest } from './api.js'

// One frontend build serves staging and prod, so optional features are
// switched by the backend's /public/site-config rather than at build time.
// Fetched once per page load and shared by every caller.
let siteConfigPromise = null

function loadSiteConfig() {
  if (!siteConfigPromise) {
    siteConfigPromise = apiRequest('/public/site-config', { auth: false }).catch(() => {
      // Retry on the next mount instead of caching the failure.
      siteConfigPromise = null
      return {}
    })
  }
  return siteConfigPromise
}

// Off until the backend says otherwise: a hidden link is better than one that
// leads to an endpoint this environment does not serve.
export function usePhotoGalleryEnabled() {
  const [enabled, setEnabled] = useState(false)
  useEffect(() => {
    let active = true
    loadSiteConfig().then((config) => {
      if (active) setEnabled(config?.photo_gallery === true)
    })
    return () => { active = false }
  }, [])
  return enabled
}
