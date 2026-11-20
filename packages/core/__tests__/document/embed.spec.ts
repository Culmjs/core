import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EMBED_ORIGINS, embedUrl } from '../../src/document/embed.ts'

test('embedUrl builds each address from the table after the id passes', () => {
  assert.equal(
    embedUrl('youtube', 'dQw4w9WgXcQ'),
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  )
  assert.equal(
    embedUrl('youtube', 'dQw4w9WgXcQ', 'src'),
    'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1',
  )
  assert.equal(
    embedUrl('youtube', 'dQw4w9WgXcQ', 'poster'),
    'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
  )
  assert.equal(embedUrl('vimeo', '123456789', 'poster'), null)
  assert.equal(
    embedUrl('google-maps', 'Kyoto, Japan', 'page'),
    'https://www.google.com/maps?q=Kyoto%2C%20Japan',
  )
})

test('embedUrl refuses an id outside the pattern and a provider outside the table', () => {
  assert.equal(embedUrl('youtube', '"><script>'), null)
  assert.equal(embedUrl('toString', 'x'), null)
  assert.equal(embedUrl('youtube', 5), null)
})

test('the frame origins are the table origins, once each', () => {
  assert.ok(EMBED_ORIGINS.includes('https://www.youtube-nocookie.com'))
  assert.equal(new Set(EMBED_ORIGINS).size, EMBED_ORIGINS.length)
})
