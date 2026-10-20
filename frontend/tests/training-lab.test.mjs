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
const { default: LearningLab } = await server.ssrLoadModule('/src/LearningLab.jsx')
const image = 'data:image/png;base64,AA=='
const rows = [
  { epoch: 1, train_loss: 1.1, val_loss: 1.2, train_acc: .4, val_acc: .35 },
  { epoch: 2, train_loss: .7, val_loss: .9, train_acc: .7, val_acc: .55 },
  { epoch: 3, train_loss: .5, val_loss: 1, train_acc: .8, val_acc: .5 },
]
function fixture(status = 'ready', count = 0) {
  return { id: '11111111-1111-4111-8111-111111111111', items: Array.from({ length: 30 }, (_, index) => ({ index, name: `Item ${index}`, image })),
    actions: Array.from({ length: 30 }, (_, index) => ({ index, outcome: index < 27 ? 'sorted' : 'missed', chosen_class: index < 27 ? index % 3 : null })),
    summary: { resolved: 30, missed: 3 }, training: { status, epochs: 3, learning_rate: .001, history: rows.slice(0, count),
      results: status === 'done' ? { before_accuracy: .3, test_accuracy: .6, best_epoch: 2, predictions: [], split: { train: 19, validation: 4, test: 4 } } : null } }
}
let container, root, props
async function render(game, extras = {}) {
  props = { ...props, game, ...extras }
  if (!root) { container = document.createElement('div'); document.body.append(container); root = createRoot(container) }
  await React.act(async () => root.render(React.createElement(LearningLab, props)))
}
function button(text) {
  const found = [...container.querySelectorAll('button')].find(element => element.textContent.trim() === text)
  assert.ok(found, `Missing button: ${text}`)
  return found
}
async function click(element) { await React.act(async () => element.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))) }
async function change(element, value) {
  await React.act(async () => {
    const prototype = element.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value)
    element.dispatchEvent(new window.Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
  })
}
afterEach(async () => {
  if (root) await React.act(async () => root.unmount())
  root = null; container?.remove(); props = { view: 'train', setGame: () => {}, saving: false }
})
after(async () => { await server.close(); dom.window.close() })
props = { view: 'train', setGame: () => {}, saving: false }

test('review follows completed epochs, syncs both graphs and animation, and does not invent progress', async () => {
  const activities = []
  await render(fixture('running'), { onActivity: activity => activities.push(activity) })
  const selectedRound = () => container.querySelector('.training-round-card').getAttribute('data-epoch')
  assert.equal(selectedRound(), '0')
  assert.equal(container.querySelectorAll('.epoch-cursor').length, 0)
  assert.equal(container.querySelector('.training-round-replay'), null)
  assert.equal(container.querySelector('animate, animateTransform'), null, 'No independent infinite progress animation')
  assert.match(container.querySelector('.training-round-card').textContent, /19 training examples/)
  assert.match(container.querySelector('.training-round-card').textContent, /Missed items have no label/)
  await render(fixture('running', 1))
  assert.equal(selectedRound(), '1')
  await render(fixture('running', 2))
  assert.equal(selectedRound(), '2')
  assert.equal(activities.length, 0, 'Polling does not generate student activity events')
  await click(container.querySelector('[aria-label="Review epoch 1 on accuracy graph"]'))
  await render(fixture('running', 3))
  assert.equal(selectedRound(), '1', 'Review stays on the selected past round as training continues')
  assert.deepEqual([...container.querySelectorAll('.epoch-cursor')].map(node => node.getAttribute('data-epoch')), ['1', '1'])
  assert.match(container.querySelector('.training-round-values').textContent, /40.0% matches.*loss 1.100.*35.0% matches.*loss 1.200/)
  assert.equal(container.querySelector('tbody tr[aria-current] td button').textContent, '1')
  await click(container.querySelector('[aria-label="Next completed round"]'))
  assert.equal(selectedRound(), '2')
  await change(container.querySelector('[aria-label="Completed round to inspect"]'), '2')
  assert.equal(selectedRound(), '3')
  await click(button('Follow live'))
  assert.equal(container.querySelector('.training-round-card').getAttribute('data-live'), 'true')
  assert.deepEqual(activities, [1, 2, 3].map(epoch => ({ kind: 'epoch_review', epoch })))
})

test('one completed run unlocks testing without a second run or required quiz; help stays by graphs', async () => {
  let next = 0
  const topics = []
  await render(fixture(), { onNext: () => next++, track: topic => topics.push(topic) })
  assert.equal(button('Next: test your robot →').disabled, true)
  await render(fixture('done', 3))
  assert.equal(button('Next: test your robot →').disabled, false)
  assert.equal(container.querySelectorAll('.graph-grid .curve').length, 2)
  assert.equal(container.querySelectorAll('.training-reading-guide .training-help').length, 4)
  const help = container.querySelector('.training-reading-guide details')
  await React.act(async () => { help.open = true; await new Promise(resolve => setTimeout(resolve, 0)) })
  assert.deepEqual(topics, ['testing'])
  await click(button('Next: test your robot →'))
  assert.equal(next, 1)
  assert.match(container.querySelector('[aria-label="Training result"]').textContent, /30.0% → 60.0%/)
  assert.match(container.querySelector('.lab-stage-navigation').textContent, /second training run is optional/)
})

test('optional one-setting rerun sends real settings and compares actual completed results', async () => {
  const requests = [], activities = []
  let optimistic
  globalThis.fetch = async (url, init) => { requests.push([url, JSON.parse(init.body)]); return { ok: true, json: async () => ({ status: 'running' }) } }
  const first = fixture('done', 3)
  await render(first, { setGame: update => { optimistic = update(first) }, onActivity: activity => activities.push(activity) })
  await click(button('Do more rounds help?'))
  assert.equal(container.querySelector('.training-controls input').disabled, true, 'Keep step size fixed')
  await change(container.querySelector('.training-controls select'), '10')
  await click(button('Train again'))
  assert.deepEqual(requests, [[`/api/sessions/${first.id}/train`, { epochs: 10, learning_rate: .001 }]])
  assert.equal(optimistic.training.results, null, 'Do not present the old result as the new result while training')
  await render(optimistic)
  assert.equal(container.querySelector('[aria-label="Compare completed runs"]'), null)
  const second = { ...fixture('done', 3), training: { ...fixture('done', 3).training, epochs: 10, results: { ...first.training.results, test_accuracy: .5 } } }
  await render(second)
  const comparison = container.querySelector('[aria-label="Compare completed runs"]')
  assert.match(comparison.textContent, /Run A60.0%3 rounds.*Run B50.0%10 rounds/)
  assert.match(comparison.textContent, /each run starts a fresh model/)
  assert.deepEqual(activities, [{ kind: 'training_plan', goal: 'more_practice' }])
  assert.equal(button('Next: test your robot →').disabled, false, 'A lower score still allows learning to continue')
})
