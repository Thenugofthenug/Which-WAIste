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
    summary: { resolved: 30, missed: 3 }, training: { status, epochs: 3, learning_rate: .001, training_mode: 'classroom', augmentations_per_item: 4, history: rows.slice(0, count),
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

test('floating examples use saved images and student labels, exclude misses, and replay only when the selected round changes', async () => {
  const game = fixture('running')
  game.actions[0] = { index: 0, outcome: 'missed', chosen_class: null }
  game.actions[1] = { index: 1, outcome: 'sorted', chosen_class: 2, expected_class: 0 }
  game.items[1] = { index: 1, name: 'Aluminum can', image: 'data:image/png;base64,AQ==' }
  await render(game)
  const stream = () => container.querySelector('.training-item-stream')
  assert.match(stream().getAttribute('aria-label'), /Aluminum can, labeled Landfill/)
  assert.equal(stream().querySelector('.training-item-preview img').getAttribute('src'), game.items[1].image)
  assert.equal(stream().querySelector('.training-item-flight'), null, 'No replay before a round completes')
  game.training.history = rows.slice(0, 1)
  await render(game)
  const firstFlight = stream().querySelector('.training-item-flight')
  assert.equal(firstFlight.dataset.itemIndex, '1', 'The missed item is never sent to the robot')
  assert.match(firstFlight.textContent, /Landfill/, 'Preserve the student label instead of correcting it')
  assert.equal(stream().querySelectorAll('.training-item-flight').length, 4)
  await render({ ...game })
  assert.equal(stream().querySelector('.training-item-flight'), firstFlight, 'Polling cannot restart the illustration')
  game.training.history = rows.slice(0, 2)
  await render(game)
  assert.notEqual(stream().querySelector('.training-item-flight'), firstFlight, 'A new selected epoch starts a fresh replay')
  assert.match(container.querySelector('.training-illustration-note').textContent, /not its exact items or live progress/)
  await render({ ...fixture(), actions: [], items: [] })
  assert.equal(stream().querySelector('img'), null, 'Never invent pictures for an empty labeled dataset')
  assert.match(stream().textContent, /No labeled items yet/)
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
  const help = container.querySelector('.training-reading-guide .definition-trigger')
  assert.match(help.textContent, /Two lines/)
  assert.equal(help.getAttribute('aria-label'), 'Why are there two lines?')
  await click(help)
  assert.match(document.querySelector('.definition-popup').textContent, /solid line checks training pictures/)
  assert.deepEqual(topics, ['testing'])
  await click(document.querySelector('.definition-close'))
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
  await change(container.querySelector('[aria-label="Practice style"]'), 'full')
  await click(button('Do more rounds help?'))
  assert.equal(container.querySelector('[aria-label="Practice style"]').value, 'classroom', 'An epoch comparison keeps the original variation count')
  assert.equal(container.querySelector('[aria-label="Practice style"]').disabled, false)
  assert.equal(container.querySelector('.training-controls input').disabled, false, 'The question guides students without locking controls')
  await change(container.querySelector('.training-controls select'), '10')
  await click(button('Train again'))
  assert.deepEqual(requests, [[`/api/sessions/${first.id}/train`, { epochs: 10, learning_rate: .001, training_mode: 'classroom' }]])
  assert.equal(optimistic.training.results, null, 'Do not present the old result as the new result while training')
  await render(optimistic)
  assert.equal(container.querySelector('[aria-label="Compare completed runs"]'), null)
  const second = { ...fixture('done', 3), training: { ...fixture('done', 3).training, epochs: 10, results: { ...first.training.results, test_accuracy: .5 } } }
  await render(second)
  const comparison = container.querySelector('[aria-label="Compare completed runs"]')
  assert.match(comparison.textContent, /Run A60.0%3 rounds.*Run B50.0%10 rounds/)
  assert.match(comparison.textContent, /each run starts a fresh model/)
  assert.equal(comparison.querySelectorAll('small').length, 2)
  assert.ok([...comparison.querySelectorAll('small')].every(label => label.textContent === 'Classroom · 4 variations/image'))
  assert.deepEqual(activities, [{ kind: 'training_plan', goal: 'more_practice' }])
  assert.equal(button('Next: test your robot →').disabled, false, 'A lower score still allows learning to continue')
})

test('both comparison questions leave every setting editable and deselect when unrelated settings change', async () => {
  const activities = [], rates = [], requests = []
  const first = fixture('done', 3)
  let finishRequest, optimistic
  globalThis.fetch = (url, init) => {
    requests.push(JSON.parse(init.body))
    return new Promise(resolve => { finishRequest = resolve })
  }
  await render(first, { onActivity: event => activities.push(event), onRateSettled: value => rates.push(value),
    setGame: update => { optimistic = update(first) } })
  const controls = () => [...container.querySelectorAll('.training-controls select, .training-controls input')]
  const rounds = () => container.querySelector('.training-controls select')
  const style = () => container.querySelector('[aria-label="Practice style"]')
  const step = () => container.querySelector('.training-controls input')
  const editable = () => assert.ok(controls().every(control => !control.disabled))

  await click(button('Do more rounds help?'))
  editable()
  await change(rounds(), '10')
  assert.equal(button('Do more rounds help?').getAttribute('aria-pressed'), 'true')
  await change(step(), '-2')
  assert.equal(button('Do more rounds help?').getAttribute('aria-pressed'), 'false', 'Changing step size leaves the rounds-only comparison')
  await click(button('Do more rounds help?'))
  await change(style(), 'full')
  assert.equal(button('Do more rounds help?').getAttribute('aria-pressed'), 'false')

  await click(button('Does step size matter?'))
  editable()
  assert.equal(rounds().value, '3', 'The question presets the completed run’s rounds')
  assert.equal(style().value, 'classroom')
  await change(step(), '-2')
  assert.equal(button('Does step size matter?').getAttribute('aria-pressed'), 'true')
  await change(rounds(), '50')
  assert.equal(button('Does step size matter?').getAttribute('aria-pressed'), 'false', 'Changing rounds leaves the step-only comparison')
  await click(button('Does step size matter?'))
  await change(style(), 'full')
  assert.equal(button('Does step size matter?').getAttribute('aria-pressed'), 'false')
  await change(rounds(), '10')
  await change(step(), '-2')
  editable()

  await click(button('Train again'))
  assert.ok(controls().every(control => control.disabled), 'Controls are disabled while the start request is pending')
  assert.ok([...container.querySelectorAll('.training-plan button')].every(control => control.disabled))
  assert.equal(button('Next: test your robot →').disabled, true)
  await React.act(async () => finishRequest({ ok: true, json: async () => ({ status: 'running' }) }))
  assert.deepEqual(requests, [{ epochs: 10, learning_rate: .01, training_mode: 'full' }])
  assert.equal(rates.at(-1), -2)
  assert.deepEqual(activities.map(event => event.goal), ['more_practice', 'more_practice', 'step_size', 'step_size'])
  await render(optimistic)
  assert.ok(controls().every(control => control.disabled), 'Controls stay disabled during actual training')
})

test('an accepted run with a lost response recovers its real progress instead of sending another train request', async () => {
  const first = fixture('done', 3), requests = []
  first.training.run_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const recovered = { ...fixture('running', 1).training, run_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }
  let optimistic
  globalThis.fetch = async (url, init) => {
    requests.push([url, init?.method || 'GET'])
    if (init?.method === 'POST') throw new TypeError('Response connection lost')
    return { ok: true, json: async () => recovered }
  }
  await render(first, { setGame: update => { optimistic = update(first) } })
  await click(button('Train again'))
  assert.deepEqual(requests, [[`/api/sessions/${first.id}/train`, 'POST'], [`/api/sessions/${first.id}/training`, 'GET']])
  assert.deepEqual(optimistic.training, recovered, 'Use actual returned history and run ID')
  assert.equal(container.querySelector('[role="alert"]'), null)
  await render(optimistic)
  assert.equal(container.querySelector('.training-round-card').dataset.epoch, '1')
  assert.equal(button('Next: test your robot →').disabled, true)
  assert.ok([...container.querySelectorAll('.training-controls select, .training-controls input')].every(control => control.disabled))
})

test('409 recovery accepts a matching completed run, while validation failures and old results remain errors', async () => {
  const first = fixture('done', 3)
  first.training.run_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  let optimistic, getCount = 0
  let status = 422, returned = first.training
  globalThis.fetch = async (url, init) => {
    if (init?.method === 'POST') return { ok: false, status, json: async () => ({ detail: status === 422 ? 'Need more labels' : 'Already training' }) }
    getCount++
    return { ok: true, json: async () => returned }
  }
  await render(first, { setGame: update => { optimistic = update(first) } })
  await click(button('Train again'))
  assert.match(container.querySelector('[role="alert"]').textContent, /Need more labels/)
  assert.equal(getCount, 0, 'A genuine validation failure must not trigger recovery')
  assert.equal(optimistic, undefined)
  status = 409
  await click(button('Train again'))
  assert.match(container.querySelector('[role="alert"]').textContent, /Already training/)
  assert.equal(optimistic, undefined, 'Never treat the previous completed run as the newly requested run')
  returned = { ...fixture('done', 3).training, run_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }
  await click(button('Train again'))
  assert.deepEqual(optimistic.training, returned)
  assert.equal(getCount, 2)
  await render(optimistic)
  assert.equal(button('Next: test your robot →').disabled, false)
  assert.ok(container.querySelector('[aria-label="Compare completed runs"]'))
})

test('classroom is the new-run default and full practice submits its disclosed variation setting', async () => {
  const requests = []
  let optimistic
  globalThis.fetch = async (url, init) => { requests.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ status: 'running' }) } }
  const ready = fixture()
  await render(ready, { setGame: update => { optimistic = update(ready) } })
  const mode = container.querySelector('[aria-label="Practice style"]')
  assert.equal(mode.value, 'classroom')
  assert.match(container.querySelector('.training-mode-note').textContent, /4 image variations.*same robot.*accuracy can be lower/)
  await change(mode, 'full')
  assert.match(container.querySelector('.training-mode-note').textContent, /8 image variations/)
  await click(button('Train your robot'))
  assert.deepEqual(requests, [{ epochs: 3, learning_rate: .001, training_mode: 'full' }])
  assert.equal(optimistic.training.training_mode, 'full')
  assert.equal(optimistic.training.augmentations_per_item, 8)
})

test('legacy completed runs restore full practice and keep their original mode in a comparison', async () => {
  const legacy = fixture('done', 3)
  delete legacy.training.training_mode
  delete legacy.training.augmentations_per_item
  let optimistic
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ status: 'running' }) })
  await render(legacy, { setGame: update => { optimistic = update(legacy) } })
  assert.equal(container.querySelector('[aria-label="Practice style"]').value, 'full')
  await change(container.querySelector('[aria-label="Practice style"]'), 'classroom')
  await click(button('Train again'))
  await render(optimistic)
  await render(fixture('done', 3))
  const comparison = container.querySelector('[aria-label="Compare completed runs"]')
  assert.deepEqual([...comparison.querySelectorAll('small')].map(label => label.textContent), ['Full · 8 variations/image', 'Classroom · 4 variations/image'])
  assert.match(comparison.textContent, /not a one-setting comparison/)
})
