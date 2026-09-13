import test from 'node:test'
import assert from 'node:assert/strict'

import { parseVideoEmbedLine } from '../src/videoEmbeds.js'


test('builds a Facebook plugin embed from a reel URL', () => {
  const embed = parseVideoEmbedLine(
    '@[video](https://www.facebook.com/reel/27925319133834401/)',
  )

  assert.equal(embed.provider, 'facebook')
  const src = new URL(embed.src)
  assert.equal(src.origin, 'https://www.facebook.com')
  assert.equal(src.pathname, '/plugins/video.php')
  assert.equal(
    src.searchParams.get('href'),
    'https://www.facebook.com/reel/27925319133834401/',
  )
})

test('accepts a copied Facebook video iframe but ignores its attributes', () => {
  const embed = parseVideoEmbedLine(
    '<iframe src="https://www.facebook.com/plugins/video.php?href=https%3A%2F%2Fwww.facebook.com%2Freel%2F27925319133834401%2F&show_text=false" onload="alert(1)"></iframe>',
  )

  assert.equal(embed.provider, 'facebook')
  assert.match(embed.src, /^https:\/\/www\.facebook\.com\/plugins\/video\.php\?/)
  assert.doesNotMatch(embed.src, /onload|alert/)
})

test('builds privacy-enhanced YouTube embeds from common links', () => {
  for (const url of [
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ',
    'https://www.youtube.com/shorts/dQw4w9WgXcQ',
  ]) {
    assert.deepEqual(parseVideoEmbedLine(`@[video](${url})`), {
      provider: 'youtube',
      src: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    })
  }
})

test('recognizes a supported video URL on its own line', () => {
  assert.deepEqual(
    parseVideoEmbedLine('https://youtu.be/dQw4w9WgXcQ'),
    {
      provider: 'youtube',
      src: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    },
  )
})

test('rejects arbitrary iframes and deceptive domains', () => {
  assert.equal(
    parseVideoEmbedLine('<iframe src="https://evil.example/video"></iframe>'),
    null,
  )
  assert.equal(
    parseVideoEmbedLine('@[video](https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ)'),
    null,
  )
  assert.equal(parseVideoEmbedLine('@[video](javascript:alert(1))'), null)
})
