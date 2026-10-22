import assert from 'node:assert/strict'
import { after, afterEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'

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
const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { middlewareMode: true, hmr: false }, appType: 'custom' })
const { default: Conveyor } = await server.ssrLoadModule('/src/Conveyor.jsx')
const { default: useRecorder } = await server.ssrLoadModule('/src/useRecorder.js')
const { api } = await server.ssrLoadModule('/src/api.js')
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII='
const game = { id: 'recovery-session', items: Array.from({ length: 30 }, (_, index) => ({ index, name: `Item ${index}`, image })), actions: [],
  summary: { resolved: 0, correct: 0, wrong: 0, missed: 0, score: 0, streak: 0, best_streak: 0 }, training: { status: 'ready', history: [] } }
const action = index => ({ type: 'action', index, path: `/items/${index}`, body: { outcome: 'sorted', chosen_class: 0, response_ms: 300, speed: 'NORMAL' } })
const response = body => ({ ok: true, json: async () => body })
const saved = resolved => ({ summary: { ...game.summary, resolved, correct: resolved, score: resolved * 10 }, correct: true, expected_class: 0 })
let root, container, controls

function Harness() {
  const [current, setGame] = React.useState(() => structuredClone(game))
  const [, setFeedback] = React.useState(null)
  const recorder = useRecorder(current.id, setGame, setFeedback)
  React.useLayoutEffect(() => { controls = { game: current, setGame, recorder } }, [current, recorder])
  return React.createElement(Conveyor, {
    game: current, pendingActions: recorder.pendingActions, saving: recorder.pending, saveError: recorder.error,
    onResolve: (actor, outcome, chosen, speed) => recorder.enqueue({ type: 'action', index: actor.index, path: `/items/${actor.index}`,
      body: { outcome, chosen_class: chosen, response_ms: 300, speed } }),
  })
}
async function render(Component, props) {
  if (!root) { container = document.createElement('div'); document.body.append(container); root = createRoot(container) }
  await React.act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(Component, props))))
}
async function click(text) {
  const button = [...container.querySelectorAll('button')].find(element => element.textContent === text)
  assert.ok(button, `Missing button: ${text}`)
  await React.act(async () => button.dispatchEvent(new window.MouseEvent('click', { bubbles: true })))
}
async function drive(count) {
  for (let i = 0; i < count && frames.size; i++) await React.act(async () => {
    const callbacks = [...frames.values()]; frames.clear(); clock += 100
    callbacks.forEach(callback => callback(clock))
  })
}
async function key(value) {
  await React.act(async () => document.body.dispatchEvent(new window.KeyboardEvent('keydown', { key: value, bubbles: true })))
}
const counts = () => [...container.querySelectorAll('.bin-item-count')].map(element => element.textContent)

afterEach(async () => {
  if (root) await React.act(async () => root.unmount())
  root = null; container?.remove(); frames.clear(); clock = 0; controls = null
  window.sessionStorage.clear()
})
after(async () => { await server.close(); dom.window.close() })

test('reload excludes pending sorted items before their replay is acknowledged and never counts them twice', async () => {
  const queued = action(0)
  window.sessionStorage.setItem(`waiste-events-${game.id}`, JSON.stringify([queued]))
  const requests = []
  globalThis.fetch = (url, init) => new Promise(resolve => requests.push({ url, body: JSON.parse(init.body), resolve }))
  await render(Harness)
  assert.equal(requests.length, 1)
  assert.deepEqual(requests[0].body, queued.body)
  await click('Start sorting at speed 2')
  await drive(30)
  assert.equal(!!container.querySelector('[aria-label="Select Item 0"]'), false, 'An unsaved action restored from this tab must not be offered again')
  assert.deepEqual(counts(), ['ITEMS: 1', 'ITEMS: 0', 'ITEMS: 0'])
  assert.equal(container.querySelectorAll('.memory-row').length, 1)
  await React.act(async () => requests[0].resolve(response(saved(1))))
  assert.equal(controls.recorder.pending, 0)
  assert.deepEqual(counts(), ['ITEMS: 1', 'ITEMS: 0', 'ITEMS: 0'])
  assert.equal(container.querySelectorAll('.memory-row').length, 1, 'Acknowledging a replay must not duplicate its history row')
  await key('1')
  assert.equal(requests.length, 2)
  assert.equal(requests[1].url, `/api/sessions/${game.id}/items/1`)
  await React.act(async () => requests[1].resolve(response(saved(2))))
  assert.deepEqual(counts(), ['ITEMS: 2', 'ITEMS: 0', 'ITEMS: 0'])
  assert.equal(container.querySelectorAll('.memory-row').length, 2)
  assert.deepEqual(JSON.parse(window.sessionStorage.getItem(`waiste-events-${game.id}`)), [])
})

test('a late saved action removes its actor and selected target without creating another sorting event', async () => {
  const emitted = []
  const props = { game: structuredClone(game), onResolve: (...args) => emitted.push(args), saving: 0 }
  await render(Conveyor, props)
  await click('Start sorting at speed 2')
  await drive(20)
  const actor = container.querySelector('[aria-label="Select Item 0"]')
  await React.act(async () => actor.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  const restored = { ...props.game, actions: [{ index: 0, ...action(0).body }], summary: saved(1).summary }
  await render(Conveyor, { ...props, game: restored })
  assert.equal(!!container.querySelector('[aria-label="Select Item 0"]'), false)
  assert.deepEqual(counts(), ['ITEMS: 1', 'ITEMS: 0', 'ITEMS: 0'])
  assert.equal(emitted.length, 0)
  await key('2')
  assert.equal(emitted.length, 1)
  assert.equal(emitted[0][0].index, 1)
  assert.equal(emitted[0][2], 1)
})

test('a hanging save times out with its original event retained and manual retry clears it exactly once', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const requests = []
  globalThis.fetch = (url, init) => new Promise(resolve => requests.push({ url, init, resolve }))
  await render(Harness)
  const event = { type: 'help', path: '/help', body: { event_id: 'stable-retry-id', topic: 'filters' } }
  await React.act(async () => controls.recorder.enqueue(event))
  await React.act(async () => context.mock.timers.tick(30_000))
  assert.match(controls.recorder.error, /took too long/i)
  assert.equal(requests[0].init.signal.aborted, true)
  assert.equal(requests.length, 1, 'A timed out request must not be blindly repeated')
  assert.deepEqual(JSON.parse(window.sessionStorage.getItem(`waiste-events-${game.id}`)), [event])
  await React.act(async () => { void controls.recorder.retry() })
  assert.equal(requests.length, 2)
  assert.deepEqual(JSON.parse(requests[1].init.body), event.body)
  await React.act(async () => requests[1].resolve(response({ saved: true })))
  assert.equal(controls.recorder.error, '')
  assert.equal(controls.recorder.pending, 0)
  assert.deepEqual(JSON.parse(window.sessionStorage.getItem(`waiste-events-${game.id}`)), [])
})

test('the timeout also bounds a stalled response body and never retries a non-idempotent prediction', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  let requests = 0, signal, failure
  globalThis.fetch = async (_url, init) => {
    requests++; signal = init.signal
    return { ok: true, json: () => new Promise(() => {}) }
  }
  const pending = api(`/sessions/${game.id}/try-item`, {}).catch(error => { failure = error })
  await React.act(async () => context.mock.timers.tick(30_000))
  assert.equal(failure?.name, 'TimeoutError')
  assert.equal(signal.aborted, true)
  assert.equal(requests, 1)
  await pending
})

test('an unreadable success response keeps the event queued for an explicit retry', async () => {
  let requests = 0
  const event = { type: 'help', path: '/help', body: { event_id: 'incomplete-response-id', topic: 'labels' } }
  globalThis.fetch = async (_url, init) => {
    requests++
    assert.deepEqual(JSON.parse(init.body), event.body)
    if (requests === 1) return { ok: true, json: async () => { throw new SyntaxError('Truncated JSON') } }
    return response({ saved: true })
  }
  await render(Harness)
  await React.act(async () => controls.recorder.enqueue(event))
  assert.equal(requests, 1)
  assert.match(controls.recorder.error, /incomplete response/i)
  assert.deepEqual(JSON.parse(window.sessionStorage.getItem(`waiste-events-${game.id}`)), [event])
  await React.act(async () => { await controls.recorder.retry() })
  assert.equal(requests, 2)
  assert.equal(controls.recorder.pending, 0)
})
