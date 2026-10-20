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
const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { middlewareMode: true, hmr: false }, appType: 'custom' })
const { default: useRecorder } = await server.ssrLoadModule('/src/useRecorder.js')
let root, container, controls
const initialGame = id => ({ id, summary: { resolved: 0 }, actions: [] })
function Harness() {
  const [game, setGame] = React.useState(() => initialGame('A'))
  const [feedback, setFeedback] = React.useState(null)
  const recorder = useRecorder(game?.id, setGame, setFeedback)
  React.useLayoutEffect(() => { controls = { game, setGame, feedback, recorder } }, [game, feedback, recorder])
  return React.createElement('div', null, game?.id)
}
async function mount() {
  container = document.createElement('div'); document.body.append(container)
  root = createRoot(container)
  await React.act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(Harness))))
}
function requestsWithDeferredResponses() {
  const requests = []
  globalThis.fetch = (url, init) => new Promise((resolve, reject) => {
    requests.push({ url, body: JSON.parse(init.body), resolve: body => resolve({ ok: true, json: async () => body }), reject })
  })
  return requests
}
const action = index => ({ type: 'action', index, path: `/items/${index}`, body: { outcome: 'sorted', chosen_class: 0, response_ms: 200, speed: 2 } })
const saved = resolved => ({ summary: { resolved }, correct: true, expected_class: 0 })
afterEach(async () => {
  if (root) await React.act(async () => root.unmount())
  root = null; container?.remove(); window.sessionStorage.clear()
})
after(async () => { await server.close(); dom.window.close() })

test('in-flight events and delayed unmount flushes stay with the originating student session', async () => {
  const requests = requestsWithDeferredResponses()
  await mount()
  const enqueueA = controls.recorder.enqueue
  await React.act(async () => enqueueA(action(0)))
  assert.equal(requests[0].url, '/api/sessions/A/items/0')
  await React.act(async () => controls.setGame(initialGame('B')))
  assert.equal(controls.recorder.pending, 0)
  // A lesson's cleanup can flush its final slider choice after the next student starts.
  const event = { type: 'activity', path: '/activity', body: { event_id: 'original-event-id', kind: 'weight_experiment', response: .8, weight: 2 } }
  await React.act(async () => { enqueueA(event); controls.recorder.enqueue(action(3)) })
  assert.deepEqual(requests.map(request => request.url), ['/api/sessions/A/items/0', '/api/sessions/B/items/3'])
  await React.act(async () => requests[1].resolve(saved(1)))
  assert.equal(controls.game.id, 'B')
  assert.deepEqual(controls.game.summary, { resolved: 1 })
  assert.deepEqual(controls.game.actions.map(action => action.index), [3])
  const feedbackB = controls.feedback
  await React.act(async () => requests[0].resolve(saved(20)))
  assert.equal(requests[2].url, '/api/sessions/A/activity')
  assert.deepEqual(requests[2].body, event.body)
  assert.deepEqual(controls.game.summary, { resolved: 1 }, 'The late A response must not replace B progress')
  assert.deepEqual(controls.game.actions.map(action => action.index), [3])
  assert.deepEqual(controls.feedback, feedbackB, 'The late response must not replace B feedback')
  await React.act(async () => requests[2].resolve({ saved: true }))
  assert.equal(controls.recorder.pending, 0)
  assert.deepEqual(JSON.parse(window.sessionStorage.getItem('waiste-events-A')), [])
  assert.deepEqual(JSON.parse(window.sessionStorage.getItem('waiste-events-B')), [])
})

test('save errors and retry queues are isolated by session and retain the original event ID', async () => {
  const requests = requestsWithDeferredResponses()
  await mount()
  const retryA = controls.recorder.retry
  const event = { type: 'help', path: '/help', body: { event_id: 'same-id-on-retry', topic: 'filters' } }
  await React.act(async () => controls.recorder.enqueue(event))
  await React.act(async () => requests[0].reject(new Error('Offline')))
  assert.match(controls.recorder.error, /waiting to save: Offline/)
  assert.equal(controls.recorder.pending, 1)
  assert.deepEqual(JSON.parse(window.sessionStorage.getItem('waiste-events-A')), [event])
  await React.act(async () => controls.setGame(initialGame('B')))
  assert.equal(controls.recorder.error, '')
  assert.equal(controls.recorder.pending, 0)
  await React.act(async () => { void retryA() })
  assert.equal(requests[1].url, '/api/sessions/A/help')
  assert.deepEqual(requests[1].body, event.body)
  await React.act(async () => requests[1].resolve({ saved: true }))
  assert.deepEqual(JSON.parse(window.sessionStorage.getItem('waiste-events-A')), [])
  assert.equal(controls.game.id, 'B')
  assert.equal(controls.recorder.error, '')
})

test('an old lesson cleanup still saves its own session after the recorder unmounts', async () => {
  const requests = requestsWithDeferredResponses()
  await mount()
  const enqueueA = controls.recorder.enqueue
  await React.act(async () => root.unmount())
  root = null
  const event = { type: 'activity', path: '/activity', body: { event_id: 'cleanup-id', kind: 'weight_experiment', response: 0, weight: -1 } }
  await React.act(async () => enqueueA(event))
  assert.equal(requests[0].url, '/api/sessions/A/activity')
  assert.deepEqual(requests[0].body, event.body)
  await React.act(async () => requests[0].resolve({ saved: true }))
  assert.deepEqual(JSON.parse(window.sessionStorage.getItem('waiste-events-A')), [])
})
