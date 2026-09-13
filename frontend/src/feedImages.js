export function getFeedImageUrls(post) {
  const urls = Array.isArray(post?.image_urls)
    ? post.image_urls.filter((url) => typeof url === 'string' && url.trim())
    : []
  if (urls.length > 0) return urls
  return post?.cover_image_url ? [post.cover_image_url] : []
}
