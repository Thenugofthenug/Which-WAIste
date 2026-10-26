import assert from 'node:assert/strict'
import { after, afterEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:5173' })
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.requestAnimationFrame = () => 1
globalThis.cancelAnimationFrame = () => {}
const React = await import('react')
const { createRoot } = await import('react-dom/client')
const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { middlewareMode: true, hmr: false }, appType: 'custom' })
const { default: App } = await server.ssrLoadModule('/src/App.jsx')
const playerA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const playerB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII='
const game = { id: '11111111-1111-4111-8111-111111111111', player_id: playerA,
  items: Array.from({ length: 30 }, (_, index) => ({ index, name: `Item ${index}`, image })), actions: [],
  summary: { resolved: 0, correct: 0, wrong: 0, missed: 0, score: 0, streak: 0, best_streak: 0 },
  training: { status: 'ready', history: [], run_id: null, learning_rate: .001 } }
let container, root
async function mount() {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  await React.act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(App))))
}
function button(text) {
  const found = [...container.querySelectorAll('button')].find(node => node.textContent.trim() === text && !node.closest('[hidden]'))
  assert.ok(found, `Visible button not found: ${text}`)
  return found
}
async function click(node) { await React.act(async () => node.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))) }
async function fill(name, value) {
  const node = container.querySelector(`input[name="${name}"]`)
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(node, value)
    node.dispatchEvent(new window.Event('input', { bubbles: true }))
  })
}
async function submit() {
  await React.act(async () => container.querySelector('.student-entry').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })))
}
function storedValues() {
  return Array.from({ length: window.sessionStorage.length }, (_, index) => window.sessionStorage.getItem(window.sessionStorage.key(index))).join(' ')
}
afterEach(async () => {
  if (root) await React.act(async () => root.unmount())
  root = null; container?.remove(); window.sessionStorage.clear()
})
after(async () => { await server.close(); dom.window.close() })

test('first and last names register once; gameplay and browser storage use only the student ID', async () => {
  const calls = []
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body); calls.push({ url, body })
    return { ok: true, json: async () => url === '/api/players' ? { id: playerA } : structuredClone(game) }
  }
  await mount()
  assert.equal(button('START').disabled, true)
  await fill('first_name', '   '); await fill('last_name', 'Santos')
  assert.equal(button('START').disabled, true)
  await fill('first_name', ' Avery '); await fill('last_name', ' Santos ')
  assert.equal(button('START').disabled, false)
  await submit()
  assert.deepEqual(calls, [
    { url: '/api/players', body: { first_name: 'Avery', last_name: 'Santos' } },
    { url: '/api/sessions', body: { player_id: playerA } },
  ])
  assert.equal(window.sessionStorage.getItem('waiste-player'), playerA)
  assert.doesNotMatch(storedValues(), /Avery|Santos/)
  assert.equal(container.querySelector('.student-entry'), null)
  await click(button('Start sorting at speed 2'))
  await click(button('Main menu'))
  await click(button('New mission'))
  assert.equal(calls.filter(call => call.url === '/api/players').length, 1)
  assert.deepEqual(calls.at(-1), { url: '/api/sessions', body: { player_id: playerA } })
})

test('failed registration retains the entry for retry and does not start an anonymous round', async () => {
  const calls = []; let offline = true
  globalThis.fetch = async url => {
    calls.push(url)
    if (offline) throw new Error('Connection interrupted')
    return { ok: true, json: async () => url === '/api/players' ? { id: playerA } : structuredClone(game) }
  }
  await mount(); await fill('first_name', 'Avery'); await fill('last_name', 'Santos'); await submit()
  assert.deepEqual(calls, ['/api/players'])
  assert.equal(window.sessionStorage.getItem('waiste-player'), null)
  assert.equal(container.querySelector('[name="first_name"]').value, 'Avery')
  assert.match(container.querySelector('[role="alert"]').textContent, /Connection interrupted/)
  offline = false; await submit()
  assert.equal(calls.at(-1), '/api/sessions')
  assert.equal(window.sessionStorage.getItem('waiste-player'), playerA)
})

test('different student clears the old active identity and starts a separately linked mission', async () => {
  const calls = []; let registered = 0, rounds = 0
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body); calls.push({ url, body })
    const value = url === '/api/players' ? { id: ++registered === 1 ? playerA : playerB } : {
      ...structuredClone(game), id: `round-${++rounds}`, player_id: body.player_id,
    }
    return { ok: true, json: async () => value }
  }
  await mount(); await fill('first_name', 'Avery'); await fill('last_name', 'Santos'); await submit()
  await click(button('Start sorting at speed 2')); await click(button('Main menu'))
  await click(button('Different student'))
  assert.equal(window.sessionStorage.getItem('waiste-player'), null)
  assert.equal(window.sessionStorage.getItem('waiste-session'), null)
  assert.equal(container.querySelector('[name="first_name"]').value, '')
  assert.equal(container.querySelector('.mission-screen'), null)
  await fill('first_name', 'Casey'); await fill('last_name', 'Lane'); await submit()
  assert.deepEqual(calls.filter(call => call.url === '/api/sessions').map(call => call.body), [
    { player_id: playerA }, { player_id: playerB },
  ])
  assert.equal(window.sessionStorage.getItem('waiste-player'), playerB)
  assert.doesNotMatch(storedValues(), /Avery|Santos|Casey|Lane/)
})

test('lesson interactions are queued with the session and actual training run, without student names', async context => {
  // A remote LAN HTTP origin has getRandomValues but not randomUUID.
  const cryptoSource = globalThis.crypto
  context.mock.getter(globalThis, 'crypto', () => ({ getRandomValues: bytes => cryptoSource.getRandomValues(bytes) }))
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const runId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', calls = []
  const completed = { ...structuredClone(game),
    actions: game.items.map(item => ({ index: item.index, outcome: 'sorted', chosen_class: item.index % 3 })),
    summary: { ...game.summary, resolved: 30 },
    training: { status: 'done', epochs: 3, learning_rate: .001, run_id: runId,
      history: [1, 2, 3].map(epoch => ({ epoch, train_loss: 1 / epoch, val_loss: 1.1 / epoch, train_acc: .5, val_acc: .4 })),
      results: { before_accuracy: .3, test_accuracy: .6, best_epoch: 3, split: { train: 20, validation: 5, test: 5 }, predictions: [{
        name: 'Test can', image, label: 'Recycling', guideline: 'Recycling', before: [.3, .4, .3], probabilities: [.8, .1, .1],
        inspection: { input_image: image, rgb: [80, 120, 200], normalized: [-.37, -.06, .57],
          layers: [{ name: 'Block 1', shape: [16, 32, 32], maps: [{ channel: 0, image }, { channel: 1, image }] }] },
      }] } },
  }
  window.sessionStorage.setItem('waiste-player', playerA)
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) })
    return { ok: true, json: async () => url === '/api/sessions' ? completed : { saved: true } }
  }
  await mount(); await click(button('START')); await click(button('2 · Train'))
  await click(container.querySelector('[aria-label="Review epoch 1 on accuracy graph"]'))
  await click(button('Do more rounds help?'))
  await click(button('3 · Test'))
  const lab = container.querySelector('.detective-weight').closest('details')
  await React.act(async () => { lab.open = true; context.mock.timers.tick(1) })
  const weight = container.querySelectorAll('.detective-weight input')[1]
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(weight, '2')
    weight.dispatchEvent(new window.Event('input', { bubbles: true }))
  })
  await React.act(async () => context.mock.timers.tick(700))
  const activities = calls.filter(call => call.url.endsWith('/activity'))
  assert.equal(activities.length, 3)
  assert.ok(activities.every(call => call.url === `/api/sessions/${game.id}/activity`))
  const [review, plan, experiment] = activities.map(call => call.body)
  assert.equal(review.kind, 'epoch_review'); assert.equal(review.epoch, 1); assert.equal(review.training_run_id, runId)
  assert.equal(plan.kind, 'training_plan'); assert.equal(plan.goal, 'more_practice'); assert.equal(plan.training_run_id, undefined)
  assert.equal(experiment.kind, 'weight_experiment'); assert.equal(experiment.weight, 2); assert.equal(experiment.response, .8); assert.equal(experiment.training_run_id, runId)
  assert.equal(new Set(activities.map(call => call.body.event_id)).size, 3)
  assert.ok(activities.every(call => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(call.body.event_id)))
  assert.ok(calls.every(call => !('first_name' in call.body) && !('last_name' in call.body)))
})
