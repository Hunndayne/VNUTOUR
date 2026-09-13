const FACEBOOK_HOSTS = new Set([
  'facebook.com',
  'www.facebook.com',
  'm.facebook.com',
  'web.facebook.com',
])

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtu.be',
  'www.youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
])

const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

function parseHttpsUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

function isFacebookVideoPath(pathname) {
  return (
    /^\/reel\/[^/]+\/?$/i.test(pathname)
    || /^\/watch\/?$/i.test(pathname)
    || /^\/share\/(?:r|v)\/[^/]+\/?$/i.test(pathname)
    || /^\/[^/]+\/videos\/[^/]+\/?$/i.test(pathname)
  )
}

function facebookEmbed(url) {
  if (!FACEBOOK_HOSTS.has(url.hostname.toLowerCase())) return null

  let videoUrl = url
  if (url.pathname === '/plugins/video.php') {
    videoUrl = parseHttpsUrl(url.searchParams.get('href') || '')
    if (!videoUrl || !FACEBOOK_HOSTS.has(videoUrl.hostname.toLowerCase())) return null
  }

  if (!isFacebookVideoPath(videoUrl.pathname)) return null

  const embedUrl = new URL('https://www.facebook.com/plugins/video.php')
  embedUrl.searchParams.set('href', videoUrl.href)
  embedUrl.searchParams.set('show_text', 'false')
  embedUrl.searchParams.set('width', '560')
  return { provider: 'facebook', src: embedUrl.href }
}

function youtubeVideoId(url) {
  const hostname = url.hostname.toLowerCase()
  if (!YOUTUBE_HOSTS.has(hostname)) return null

  let id = ''
  if (hostname === 'youtu.be' || hostname === 'www.youtu.be') {
    id = url.pathname.split('/').filter(Boolean)[0] || ''
  } else if (url.pathname === '/watch') {
    id = url.searchParams.get('v') || ''
  } else {
    const match = url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/i)
    id = match?.[1] || ''
  }

  return YOUTUBE_VIDEO_ID.test(id) ? id : null
}

function youtubeEmbed(url) {
  const id = youtubeVideoId(url)
  if (!id) return null
  return {
    provider: 'youtube',
    src: `https://www.youtube-nocookie.com/embed/${id}`,
  }
}

function embedFromUrl(value) {
  const url = parseHttpsUrl(value)
  if (!url) return null
  return facebookEmbed(url) || youtubeEmbed(url)
}

function iframeSource(value) {
  const match = value.match(
    /^<iframe\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1[^>]*>\s*<\/iframe>$/i,
  )
  return match?.[2]
    ?.replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"') || null
}

/** Parse one Markdown line into an allowlisted external video embed. */
export function parseVideoEmbedLine(line = '') {
  const value = String(line).trim()
  if (!value) return null

  const directive = value.match(/^@\[(?:video|facebook|youtube)\]\((.+)\)$/i)
  if (directive) return embedFromUrl(directive[1].trim())

  const copiedIframeSource = iframeSource(value)
  if (copiedIframeSource) return embedFromUrl(copiedIframeSource)

  return embedFromUrl(value)
}
