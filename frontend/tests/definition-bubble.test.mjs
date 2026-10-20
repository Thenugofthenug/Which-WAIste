import assert from 'node:assert/strict'
import { after, afterEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:5173' })
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
const { createRoot } = await import('react-dom/client')
const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom' })
const { default: DefinitionBubble } = await server.ssrLoadModule('/src/DefinitionBubble.jsx')
let root, container
async function mount(topics, two = false) {
  container = document.createElement('div'); document.body.append(container)
  root = createRoot(container)
  const bubble = (title, topic) => React.createElement(DefinitionBubble, { key: topic, title, topic, track: value => topics.push(value) }, React.createElement('p', null, `Full explanation of ${topic}.`))
  await React.act(async () => root.render(React.createElement(React.StrictMode, null, bubble('What is a weight?', 'weights'), two && bubble('What is a filter?', 'filters'))))
}
async function click(element) { await React.act(async () => element.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))) }
async function key(element, value) { await React.act(async () => element.dispatchEvent(new window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }))) }
const popup = () => document.querySelector('.definition-popup')
afterEach(async () => {
  if (root) await React.act(async () => root.unmount())
  root = null; container?.remove()
  assert.equal(popup(), null, 'Unmounting removes the portal as well as its trigger')
})
after(async () => { await server.close(); dom.window.close() })

test('click, keyboard, Escape and outside dismissal keep help compact and log only openings', async () => {
  const topics = []
  await mount(topics)
  const trigger = container.querySelector('button')
  assert.equal(trigger.getAttribute('aria-expanded'), 'false')
  assert.equal(trigger.getAttribute('aria-haspopup'), 'dialog')
  assert.equal(trigger.type, 'button')
  assert.equal(popup(), null)
  await click(trigger)
  assert.equal(popup().getAttribute('role'), 'dialog')
  assert.equal(popup().getAttribute('aria-modal'), 'false')
  assert.equal(container.contains(popup()), false, 'The small popup escapes clipped game panels')
  assert.equal(trigger.getAttribute('aria-controls'), popup().id)
  assert.match(popup().textContent, /Full explanation of weights/)
  assert.equal(document.activeElement, popup().querySelector('button'))
  await click(popup().querySelector('p'))
  assert.ok(popup(), 'Reading inside does not close the popup')
  assert.deepEqual(topics, ['weights'], 'StrictMode and content clicks cannot duplicate openings')
  await key(document.activeElement, 'Escape')
  assert.equal(popup(), null)
  assert.equal(document.activeElement, trigger)
  await key(trigger, 'Enter')
  assert.ok(popup())
  await click(popup().querySelector('button'))
  assert.equal(document.activeElement, trigger)
  await key(trigger, ' ')
  assert.ok(popup())
  await React.act(async () => document.body.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true })))
  assert.equal(popup(), null)
  assert.equal(document.activeElement, trigger)
  assert.equal(trigger.getAttribute('aria-expanded'), 'false')
  assert.deepEqual(topics, ['weights', 'weights', 'weights'], 'Reopening counts; dismissals do not')
})

test('opening another definition replaces the first even when using only the keyboard', async () => {
  const topics = []
  await mount(topics, true)
  const [weights, filters] = container.querySelectorAll('.definition-trigger')
  await key(weights, 'Enter')
  await key(filters, ' ')
  assert.equal(document.querySelectorAll('.definition-popup').length, 1)
  assert.match(popup().textContent, /Full explanation of filters/)
  assert.equal(weights.getAttribute('aria-expanded'), 'false')
  assert.equal(filters.getAttribute('aria-expanded'), 'true')
  assert.deepEqual(topics, ['weights', 'filters'])
})

for (const size of [
  { width: 1388, height: 768, anchor: { left: 1300, top: 700, bottom: 736 }, popup: { width: 400, height: 420 }, expected: { left: '976px', top: '272px' } },
  { width: 1024, height: 768, anchor: { left: 950, top: 684, bottom: 718 }, popup: { width: 400, height: 260 }, expected: { left: '612px', top: '416px' } },
  { width: 390, height: 844, anchor: { left: 320, top: 780, bottom: 820 }, popup: { width: 366, height: 520 }, expected: { left: '12px', top: '252px' } },
]) test(`popup positioning stays inside ${size.width} × ${size.height} near the lower right corner`, async () => {
  const original = window.HTMLElement.prototype.getBoundingClientRect
  const originalWidth = window.innerWidth, originalHeight = window.innerHeight
  window.innerWidth = size.width
  window.innerHeight = size.height
  // JSDOM does not render CSS: these dimensions test placement, not visual fit.
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.classList.contains('definition-trigger')) return size.anchor
    if (this.classList.contains('definition-popup')) return size.popup
    return original.call(this)
  }
  try {
    await mount([])
    await click(container.querySelector('button'))
    assert.equal(popup().style.left, size.expected.left)
    assert.equal(popup().style.top, size.expected.top)
  } finally {
    window.HTMLElement.prototype.getBoundingClientRect = original
    window.innerWidth = originalWidth
    window.innerHeight = originalHeight
  }
})
