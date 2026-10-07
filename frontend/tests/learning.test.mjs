import assert from 'node:assert/strict'
import { test, after, afterEach } from 'node:test'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import { advanceBelt, canCatch } from '../src/conveyorState.js'
import { toyScores } from '../src/toyScores.js'

// Component tests run in a virtual DOM, without controlling the user's browser.
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:5173' })
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let frameId = 0
let frameTime = 0
const frames = new Map()
globalThis.requestAnimationFrame = (callback) => { frames.set(++frameId, callback); return frameId }
globalThis.cancelAnimationFrame = (id) => frames.delete(id)
const React = await import('react')
const { createRoot } = await import('react-dom/client')
const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { middlewareMode: true }, appType: 'custom' })
const { default: App } = await server.ssrLoadModule('/src/App.jsx')
const { default: ConveyorReplay } = await server.ssrLoadModule('/src/ConveyorReplay.jsx')
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII='
const prediction = { name: 'Aluminum can', image, your_label: 'Recycling', predicted_class: 'Recycling', confidence: 0.8,
  probabilities: { Recycling: 0.8, Compost: 0.1, Landfill: 0.1 }, before: { predicted_class: 'Landfill', confidence: 0.4,
    probabilities: { Recycling: 0.3, Compost: 0.3, Landfill: 0.4 } }, inspection: { input_image: image, rgb: [100, 120, 140], normalized: [-0.216, -0.059, 0.098],
      layers: [16, 32, 64, 64].map((channels, index) => ({ name: `Block ${index + 1}`, shape: [channels, 32 / (2 ** index), 32 / (2 ** index)],
        maps: [{ channel: 1, image }, { channel: 2, image }] })) } }
const game = { game_id: 'test-game', item: null, demo: false, index: 30, total: 30, score: 30,
  categories: ['Recycling', 'Compost', 'Landfill'], training: { status: 'done', epoch: 3, epochs: 3, history: [],
    predictions: [prediction], before_accuracy: 0, test_accuracy: 1, best_epoch: 3, split: { train: 20, validation: 5, test: 5 } } }
let root
let container

async function mount(component, props = {}) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await React.act(async () => { root.render(React.createElement(component, props)) })
}
function button(text, scope = container) {
  const found = [...scope.querySelectorAll('button')].find((element) => element.textContent.trim() === text)
  assert.ok(found, `Button not found: ${text}`)
  return found
}
async function click(element) {
  await React.act(async () => { element.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
}
async function driveFrames(count) {
  for (let tick = 0; tick < count && frames.size > 0; tick++) {
    await React.act(async () => {
      const callbacks = [...frames.values()]
      frames.clear()
      callbacks.forEach((callback) => callback(frameTime))
      frameTime += 100
    })
  }
}
afterEach(async () => {
  if (root) await React.act(async () => root.unmount())
  container?.remove()
  root = null
  frames.clear()
  frameTime = 0
})
after(async () => { await server.close(); dom.window.close() })

test('changing a weight affects normalized toy scores; zero response removes its influence', () => {
  const low = toyScores(0.8, -3)
  const high = toyScores(0.8, 3)
  assert.ok(high[1] > low[1])
  assert.ok(Math.abs(high.reduce((a, b) => a + b, 0) - 1) < 1e-10)
  assert.deepEqual(toyScores(0, -3), toyScores(0, 3))
})

test('belt never auto-stops at the camera and catches have a limited window', () => {
  assert.deepEqual(advanceBelt({ index: 0, progress: 34 }, 20, 2), { index: 0, progress: 54 })
  assert.equal(canCatch(26), false)
  assert.equal(canCatch(27), true)
  assert.equal(canCatch(43), true)
  assert.equal(canCatch(44), false)
  assert.deepEqual(advanceBelt({ index: 0, progress: 99 }, 2, 2), { index: 1, progress: 0 })
  assert.deepEqual(advanceBelt({ index: 2, progress: 0 }, 20, 2), { index: 2, progress: 0 })
})

test('filters stay visible and completed slides preserve lesson and claw progress', async () => {
  const calls = []
  globalThis.fetch = async (url) => {
    calls.push(String(url))
    return { ok: true, json: async () => String(url).endsWith('/labels') ?
      { items: [{ index: 0, name: prediction.name, image, label: 'Recycling' }] } : game }
  }
  await mount(App)
  const nav = () => container.querySelectorAll('.stage-nav button')
  await click(nav()[1])
  assert.equal(container.querySelectorAll('.filters-box .feature-layer img').length, 8)
  assert.equal(container.querySelector('.filters-box').closest('[hidden]'), null)
  assert.equal(container.querySelector('.mission-quiz'), null)
  await click(container.querySelectorAll('.lesson-steps button')[2])
  await click(button('Play with a weight'))
  assert.equal(container.querySelector('.filters-box').closest('[hidden]'), null)
  await click(button('Look inside the CNN'))
  await click(nav()[2])
  await click(button('Play'))
  await driveFrames(30)
  await click(button('Grab with claw'))
  await click(button('Recycling', container.querySelector('.prediction-bins')))
  await click(nav()[0])
  assert.match(container.querySelector('.dataset-review').textContent, /Your labeled dataset/)
  assert.match(container.querySelector('.dataset-grid').textContent, /Aluminum can/)
  await click(nav()[1])
  assert.equal(container.querySelectorAll('.lesson-steps button')[2].getAttribute('aria-pressed'), 'true')
  await click(nav()[2])
  assert.match(container.querySelector('.challenge-feedback').textContent, /Your prediction: Recycling/)
  assert.ok(calls.every((url) => !url.endsWith('/sort') && !url.endsWith('/train')))
})

test('unfinished stages remain locked', async () => {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ ...game, index: 0, item: { name: prediction.name, image }, training: { status: 'ready', epochs: 50, history: [] } }) })
  await mount(App)
  const nav = container.querySelectorAll('.stage-nav button')
  assert.equal(nav[1].disabled, true)
  assert.equal(nav[2].disabled, true)
  assert.equal(button('Next →').disabled, true)
})

test('only a timely moving catch pauses; prediction releases and navigation pauses animation', async () => {
  await mount(ConveyorReplay, { predictions: [prediction], active: true })
  assert.match(container.querySelector('.decision-summary').textContent, /Image approaches/)
  assert.equal(button('Grab with claw').disabled, true)
  await click(button('Play'))
  await click(button('Grab with claw'))
  assert.equal(container.querySelector('.claw-grabbed'), null)
  assert.match(container.querySelector('.challenge-feedback').textContent, /Too early/)
  assert.equal(frames.size, 1)
  await driveFrames(30)
  await click(button('Pause'))
  assert.equal(button('Grab with claw').disabled, true)
  await click(button('Play'))
  await click(button('Grab with claw'))
  assert.ok(container.querySelector('.claw-grabbed'))
  assert.equal(button('Step').disabled, true)
  assert.match(container.querySelector('.decision-summary').textContent, /Image approaches/)
  await click(button('Compost', container.querySelector('.prediction-bins')))
  assert.match(container.querySelector('.challenge-feedback').textContent, /disagree/)
  assert.match(container.querySelector('.decision-summary').textContent, /80.0% model score/)
  assert.equal(frames.size, 1)
  await React.act(async () => root.render(React.createElement(ConveyorReplay, { predictions: [prediction], active: false })))
  assert.equal(frames.size, 0)
  assert.match(container.querySelector('.challenge-feedback').textContent, /Your prediction: Compost/)
})

test('late catches fail and ungrabbed items pass automatically and count as missed', async () => {
  await mount(ConveyorReplay, { predictions: [prediction], active: true })
  await click(button('Play'))
  await driveFrames(40)
  await click(button('Grab with claw'))
  assert.equal(container.querySelector('.claw-grabbed'), null)
  assert.match(container.querySelector('.challenge-feedback').textContent, /Too late/)
  assert.equal(frames.size, 1)
  await driveFrames(60)
  assert.match(container.querySelector('.challenge-feedback').textContent, /0 caught, 1 missed/)
  assert.match(container.querySelector('.decision-summary').textContent, /80.0% model score/)
  assert.equal(frames.size, 0)
})
