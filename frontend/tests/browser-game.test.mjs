import assert from 'node:assert/strict'
import { after, afterEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import { advanceActors, binAt, createWorld, initialActors } from '../src/gameEngine.js'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:5173' })
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const frames = new Map()
let frameId = 0, clock = 0
globalThis.requestAnimationFrame = callback => { frames.set(++frameId, callback); return frameId }
globalThis.cancelAnimationFrame = id => frames.delete(id)
const React = await import('react')
const { createRoot } = await import('react-dom/client')
const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { middlewareMode: true }, appType: 'custom' })
const { default: App } = await server.ssrLoadModule('/src/App.jsx')
const { default: Conveyor } = await server.ssrLoadModule('/src/Conveyor.jsx')
const { default: HomePictures } = await server.ssrLoadModule('/src/HomePictures.jsx')
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII='
const game = { id: '11111111-1111-4111-8111-111111111111', items: Array.from({ length: 30 }, (_, index) => ({ index, name: 'Item ' + index, image })),
  actions: [], summary: { resolved: 0, correct: 0, wrong: 0, missed: 0, score: 0, streak: 0, best_streak: 0 }, training: { status: 'ready', history: [] } }
let container, root
async function mount(Component, props = {}) {
  container = document.createElement('div'); document.body.append(container)
  root = createRoot(container)
  await React.act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(Component, props))))
}
function button(text) {
  const found = [...container.querySelectorAll('button')].find(element => element.textContent.trim() === text)
  assert.ok(found, `Button not found: ${text}`)
  return found
}
async function click(element) { await React.act(async () => element.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))) }
async function drive(count) {
  for (let i = 0; i < count && frames.size; i++) await React.act(async () => {
    const callbacks = [...frames.values()]; frames.clear(); clock += 100
    callbacks.forEach(callback => callback(clock))
  })
}
afterEach(async () => {
  if (root) await React.act(async () => root.unmount())
  root = null; container?.remove(); frames.clear(); clock = 0
  window.sessionStorage.clear()
})
after(async () => { await server.close(); dom.window.close() })

test('start pictures shuffle in place every 750ms and cover every sorting item without duplicates', async context => {
  context.mock.timers.enable({ apis: ['setInterval'] })
  Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  try {
    await mount(HomePictures)
    const names = () => [...container.querySelectorAll('img')].map(img => img.alt)
    const captions = () => [...container.querySelectorAll('figcaption')].map(caption => caption.textContent)
    const lastBackground = new Map()
    function checkBackgrounds() {
      for (const img of container.querySelectorAll('img')) {
        const color = img.style.backgroundColor
        assert.ok(['rgb(16, 87, 16)', 'rgb(29, 94, 145)', 'rgb(60, 65, 66)'].includes(color))
        assert.notEqual(color, lastBackground.get(img.alt))
        lastBackground.set(img.alt, color)
      }
    }
    const first = names()
    checkBackgrounds()
    assert.equal(first.length, 6)
    assert.deepEqual(captions(), first)
    assert.equal(container.querySelector('button'), null)
    await React.act(async () => context.mock.timers.tick(749))
    assert.deepEqual(names(), first)
    await React.act(async () => context.mock.timers.tick(1))
    assert.notDeepEqual(names(), first)
    checkBackgrounds()
    assert.equal(new Set([...first, ...names()]).size, 12)
    let previous = names()
    for (let i = 0; i < 10; i++) {
      await React.act(async () => context.mock.timers.tick(750))
      assert.equal(new Set(names()).size, 6)
      assert.deepEqual(captions(), names())
      checkBackgrounds()
      assert.ok(names().every(name => !previous.includes(name)))
      previous = names()
    }
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    const hidden = names()
    await React.act(async () => context.mock.timers.tick(1000))
    assert.deepEqual(names(), hidden)
  } finally {
    delete document.hidden
  }
})

test('belt never stops for missed items; restoring excludes resolved items', () => {
  const actors = initialActors(game.items, [{ index: 0 }])
  assert.equal(actors.length, 29)
  assert.equal(actors[0].index, 1)
  const next = advanceActors([{ ...actors[0], y: 485 }], .1, 'NORMAL')
  assert.equal(next.actors.length, 0)
  assert.equal(next.missed.length, 1)
  assert.equal(binAt(280, 620), 0)
  assert.equal(binAt(640, 620), 1)
  assert.equal(binAt(640, 400), null)
  const store = createWorld(actors)
  const before = store.getSnapshot()
  store.read().actors = []
  store.publish()
  assert.equal(before.actors.length, 29)
  assert.equal(store.getSnapshot().actors.length, 0)
})

test('moving items fall into lava exactly once and successful drag selects the correct bin', async () => {
  const actions = []
  await mount(Conveyor, { game, paused: false, onResolve: (...args) => actions.push(args), help: () => {}, saving: 0 })
  await click(button('Start belt'))
  await drive(20)
  const svg = container.querySelector('.conveyor-svg')
  svg.createSVGPoint = () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y } } })
  svg.getScreenCTM = () => ({ inverse: () => ({}) })
  const item = container.querySelector('[aria-label="Select Item 0"]')
  item.setPointerCapture = () => {}
  await React.act(async () => {
    item.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, clientX: 640, clientY: 160 }))
    svg.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, clientX: 280, clientY: 620 }))
    svg.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true, clientX: 280, clientY: 620 }))
  })
  assert.equal(actions[0][1], 'sorted')
  assert.equal(actions[0][2], 0)
  await drive(60)
  const missed = actions.filter(action => action[1] === 'missed')
  assert.ok(missed.length > 0)
  assert.equal(new Set(actions.map(action => action[0].index)).size, actions.length)
})

test('help topics are saved and closing the guide resumes a moving game', async () => {
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push([String(url), init?.body && JSON.parse(init.body)])
    return { ok: true, json: async () => url === '/api/sessions' ? structuredClone(game) : { saved: true } }
  }
  await mount(App)
  await click(button('START'))
  await click(button('Start belt'))
  assert.equal(frames.size, 1)
  await click(button('? Learning tips'))
  assert.equal(frames.size, 0)
  assert.ok(container.querySelector('[role="dialog"]'))
  await click(button('Filters and patterns'))
  await click(button('Close ×'))
  assert.equal(frames.size, 1)
  const topics = calls.filter(([url]) => url.endsWith('/help')).map(([, body]) => body.topic)
  assert.deepEqual(topics, ['labels', 'filters'])
  assert.equal(new Set(calls.filter(([url]) => url.endsWith('/help')).map(([, body]) => body.event_id)).size, 2)
})

test('returning to start clears the active session and displays the landing screen', async () => {
  globalThis.fetch = async url => ({ ok: true, json: async () => url === '/api/sessions' ? structuredClone(game) : {} })
  await mount(App)
  await click(button('START'))
  assert.equal(window.sessionStorage.getItem('waiste-session'), game.id)
  await click(button('Return to start'))
  assert.equal(window.sessionStorage.getItem('waiste-session'), null)
  assert.ok(container.querySelector('#home-title'))
})

test('failed action saves pause the belt and retry sends the same pending event', async () => {
  let fail = true
  const saved = []
  globalThis.fetch = async (url, init) => {
    if (url === '/api/sessions') return { ok: true, json: async () => structuredClone(game) }
    if (fail) throw new Error('Offline')
    saved.push([url, JSON.parse(init.body)])
    return { ok: true, json: async () => ({ correct: false, expected_class: 0,
      summary: { ...game.summary, resolved: 1, missed: 1 } }) }
  }
  await mount(App)
  await click(button('START'))
  await click(button('Start belt'))
  await drive(49)
  assert.match(container.querySelector('[role="alert"]').textContent, /Offline/)
  assert.equal(frames.size, 0)
  const queued = JSON.parse(window.sessionStorage.getItem(`waiste-events-${game.id}`))
  assert.equal(queued.length, 1)
  assert.equal(queued[0].body.outcome, 'missed')
  fail = false
  await click(button('Retry saving'))
  assert.equal(saved.length, 1)
  assert.deepEqual(saved[0][1], queued[0].body)
  assert.equal(JSON.parse(window.sessionStorage.getItem(`waiste-events-${game.id}`)).length, 0)
  assert.equal(frames.size, 1)
})


test('stage navigation stays in board controls across sorting, training and exploration', async () => {
  const completed = structuredClone(game)
  completed.summary.resolved = 30
  completed.training.status = 'done'
  globalThis.fetch = async () => ({ ok: true, json: async () => structuredClone(completed) })
  await mount(App)
  await click(button('START'))
  assert.equal(container.querySelector('.app-header'), null)
  const navigation = container.querySelector('.board-controls .stage-nav')
  assert.ok(navigation)
  await click(button('2 · Train'))
  assert.equal(navigation.closest('[hidden]'), null)
  assert.equal(button('2 · Train').getAttribute('aria-current'), 'step')
  await click(button('3 · Explore'))
  assert.equal(navigation.closest('[hidden]'), null)
  assert.equal(button('3 · Explore').getAttribute('aria-current'), 'step')
  await click(button('1 · Sort'))
  assert.equal(button('Start belt').closest('[hidden]'), null)
  assert.equal(button('1 · Sort').getAttribute('aria-current'), 'step')
})

test('START opens the conveyor directly and leaves the belt ready to start', async () => {
  globalThis.fetch = async () => ({ ok: true, json: async () => structuredClone(game) })
  await mount(App)
  await click(button('START'))
  assert.ok(container.querySelector('[aria-label="Conveyor sorting game"]'))
  assert.equal(container.querySelector('[role="dialog"]'), null)
  assert.equal(button('Start belt').disabled, false)
  assert.equal(frames.size, 0)
  await click(button('Start belt'))
  assert.equal(frames.size, 1)
  await click(button('Return to start'))
  await click(button('START'))
  assert.equal(container.querySelector('[role="dialog"]'), null)
  assert.equal(button('Start belt').disabled, false)
  assert.equal(frames.size, 0)
})
