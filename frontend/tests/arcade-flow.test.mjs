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
const { default: App } = await server.ssrLoadModule('/src/App.jsx')
const { default: Conveyor } = await server.ssrLoadModule('/src/Conveyor.jsx')
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII='
const game = { id: '33333333-3333-4333-8333-333333333333', items: Array.from({ length: 30 }, (_, index) => ({ index, name: `Item ${index}`, image })),
  actions: [], summary: { resolved: 0, correct: 0, wrong: 0, missed: 0, score: 0, streak: 0, best_streak: 0 }, training: { status: 'ready', history: [] } }
function completedGame(status = 'done') {
  const prediction = { name: 'Test can', image, label: 'Recycling', guideline: 'Recycling', before: [.3, .3, .4], probabilities: [.8, .1, .1],
    inspection: { input_image: image, rgb: [80, 120, 200], normalized: [-.37, -.05, .56],
      layers: [{ name: 'Block 1', shape: [16, 32, 32], maps: [{ channel: 0, image }] }] } }
  return { ...structuredClone(game), actions: game.items.map(item => ({ index: item.index, outcome: 'sorted', chosen_class: item.index % 3 })),
    summary: { ...game.summary, resolved: 30, correct: 30, score: 300 }, training: { status, epochs: 3, learning_rate: .001,
      run_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', training_mode: 'classroom', augmentations_per_item: 4,
      history: status === 'done' ? [{ epoch: 1, train_loss: .8, val_loss: .9, train_acc: .7, val_acc: .6 }] : [],
      results: status === 'done' ? { predictions: [prediction], before_accuracy: .3, test_accuracy: .7, best_epoch: 1,
        split: { train: 20, validation: 5, test: 5 } } : null } }
}
let container, root

async function render(Component, props = {}) {
  await React.act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(Component, props))))
}
async function mount(Component, props = {}) {
  if (Component === App) window.sessionStorage.setItem('waiste-player', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await render(Component, props)
}
function button(label) {
  const found = [...container.querySelectorAll('button')].find(element => element.textContent.trim() === label && !element.closest('[hidden]'))
  assert.ok(found, `Visible button not found: ${label}`)
  return found
}
async function click(element) {
  assert.ok(element, 'Click target must exist')
  await React.act(async () => element.dispatchEvent(new window.MouseEvent('click', { bubbles: true })))
}
async function change(element, value) {
  await React.act(async () => {
    const prototype = element.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value)
    element.dispatchEvent(new window.Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
  })
}
async function key(key, target = document.body, options = {}) {
  const event = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options })
  await React.act(async () => target.dispatchEvent(event))
  return event
}
async function drive(count) {
  for (let index = 0; index < count && frames.size; index++) await React.act(async () => {
    const callbacks = [...frames.values()]
    frames.clear()
    clock += 100
    callbacks.forEach(callback => callback(clock))
  })
}
function speed() {
  return container.querySelector('.belt-speed-control [role="img"]').getAttribute('aria-label')
}
function actor(index) {
  return container.querySelector(`[aria-label="Select Item ${index}"]`)
}
afterEach(async () => {
  if (root) await React.act(async () => root.unmount())
  root = null
  container?.remove()
  frames.clear()
  clock = 0
  window.sessionStorage.clear()
})
after(async () => { await server.close(); dom.window.close() })

test('main menu pauses a mission; resume retains the same round, item position, and belt speed', async () => {
  let creates = 0
  globalThis.fetch = async (url, init) => {
    assert.equal(url, '/api/sessions')
    assert.equal(init.method, 'POST')
    return { ok: true, json: async () => ({ ...structuredClone(game), id: `round-${++creates}` }) }
  }
  await mount(App)
  await click(button('START'))
  await click(button('Start sorting at speed 2'))
  await click(container.querySelector('[aria-label="Increase belt speed"]'))
  await drive(10)
  const firstActor = actor(0)
  const position = firstActor.getAttribute('transform')
  assert.equal(speed(), 'Belt speed 3 of 3')
  assert.equal(creates, 1)

  await click(button('Main menu'))
  assert.equal(window.sessionStorage.getItem('waiste-session'), 'round-1')
  assert.equal(frames.size, 0, 'The hidden game must not keep losing items')
  assert.ok(firstActor.closest('[hidden]'))
  assert.ok(button('Resume mission'))
  assert.ok(button('New mission'))
  await drive(20)
  assert.equal(firstActor.getAttribute('transform'), position)

  await click(button('Resume mission'))
  assert.equal(actor(0), firstActor, 'Resuming must preserve the existing conveyor world')
  assert.equal(actor(0).getAttribute('transform'), position)
  assert.equal(speed(), 'Belt speed 3 of 3')
  assert.equal(container.querySelector('[role="dialog"]'), null, 'Resuming must not repeat the first-start instructions')
  assert.equal(creates, 1, 'Resuming must not create another database session')
  assert.equal(frames.size, 1)
  assert.equal(button('1 · Sort').getAttribute('aria-current'), 'step')

  await click(button('Main menu'))
  await click(button('New mission'))
  assert.equal(creates, 2)
  assert.equal(window.sessionStorage.getItem('waiste-session'), 'round-2')
  assert.notEqual(actor(0), firstActor)
  assert.equal(speed(), 'Belt speed 2 of 3')
  assert.ok(container.querySelector('[role="dialog"]'), 'An explicitly new mission should show its instructions')
})

test('bottom stage tabs preserve the mission, training choices, results, and pending analytics', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const completed = completedGame(), requests = []
  let creates = 0
  globalThis.fetch = async (url, init) => {
    requests.push({ url, body: init?.body ? JSON.parse(init.body) : null })
    if (url === '/api/sessions') { creates++; return { ok: true, json: async () => structuredClone(completed) } }
    return { ok: true, json: async () => ({ saved: true }) }
  }
  await mount(App)
  await click(button('START'))
  await click(button('2 · Train'))
  const bottom = () => container.querySelector('[aria-label="Game stages at bottom"]')
  const top = () => container.querySelector('[aria-label="Game stages"]')
  assert.ok(bottom() && !bottom().closest('[hidden]'))
  assert.equal(bottom().querySelector('[aria-current]').dataset.stage, 'train')
  assert.equal(top().querySelector('[aria-current]').dataset.stage, 'train')
  await click(button('Do more rounds help?'))
  await click(container.querySelector('[aria-label="Review epoch 1 on accuracy graph"]'))
  await change(container.querySelector('.training-controls select'), '10')
  await change(container.querySelector('[aria-label="Practice style"]'), 'full')
  await change(container.querySelector('.training-controls input'), '-2')
  assert.equal(requests.filter(request => request.url.endsWith('/learning-rate')).length, 0)

  await click(bottom().querySelector('[data-stage="explore"]'))
  assert.equal(container.querySelector('main').dataset.stage, 'explore')
  assert.equal(bottom().querySelector('[aria-current]').dataset.stage, 'explore')
  assert.equal(top().querySelector('[aria-current]').dataset.stage, 'explore')
  const rates = requests.filter(request => request.url.endsWith('/learning-rate'))
  assert.deepEqual(rates.map(request => request.body.exponent), [-2], 'Bottom navigation flushes the same settled rate recorder')
  const activities = requests.filter(request => request.url.endsWith('/activity')).map(request => request.body)
  assert.deepEqual(activities.map(event => event.kind), ['training_plan', 'epoch_review'])
  assert.equal(activities[1].training_run_id, completed.training.run_id)

  await click(bottom().querySelector('[data-stage="train"]'))
  assert.equal(container.querySelector('.training-controls select').value, '10')
  assert.equal(container.querySelector('[aria-label="Practice style"]').value, 'full')
  assert.equal(container.querySelector('.training-controls input').value, '-2')
  assert.equal(container.querySelector('.training-round-card').dataset.epoch, '1')
  assert.match(container.querySelector('[aria-label="Training result"]').textContent, /30.0% → 70.0%/)
  await click(bottom().querySelector('[data-stage="sort"]'))
  assert.equal(container.querySelector('main').dataset.stage, 'sort')
  assert.ok(bottom().closest('[hidden]'))
  await click(button('2 · Train'))
  assert.equal(container.querySelector('[aria-label="Practice style"]').value, 'full')
  assert.equal(window.sessionStorage.getItem('waiste-session'), completed.id)
  assert.equal(creates, 1, 'Stage tabs never create or reset a game')
  assert.equal(requests.filter(request => request.url.endsWith('/train')).length, 0, 'Navigation does not retrain the model')
})

test('top and bottom stage tabs share training unlock rules while polling completes a run', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const running = completedGame('running')
  let status = running.training
  globalThis.fetch = async url => ({ ok: true, json: async () => url === '/api/sessions' ? structuredClone(running) : structuredClone(status) })
  await mount(App)
  await click(button('START'))
  await click(button('2 · Train'))
  const bottom = () => container.querySelector('[aria-label="Game stages at bottom"]')
  const top = () => container.querySelector('[aria-label="Game stages"]')
  assert.equal(bottom().querySelector('[data-stage="explore"]').disabled, true)
  assert.equal(top().querySelector('[data-stage="explore"]').disabled, true)
  await click(bottom().querySelector('[data-stage="explore"]'))
  assert.equal(container.querySelector('main').dataset.stage, 'train')
  assert.ok([...container.querySelectorAll('.training-controls select, .training-controls input')].every(control => control.disabled))
  status = completedGame().training
  await React.act(async () => context.mock.timers.tick(1500))
  assert.equal(bottom().querySelector('[data-stage="explore"]').disabled, false)
  assert.equal(top().querySelector('[data-stage="explore"]').disabled, false)
  await click(bottom().querySelector('[data-stage="explore"]'))
  assert.equal(container.querySelector('main').dataset.stage, 'explore')
  assert.equal(window.sessionStorage.getItem('waiste-session'), running.id)
})

test('changing stages from the bottom instantly reveals and focuses the new stage’s top tab', async () => {
  const scrolls = [], originalScroll = window.HTMLElement.prototype.scrollIntoView
  window.HTMLElement.prototype.scrollIntoView = function (options) { scrolls.push({ target: this, options }) }
  globalThis.fetch = async () => ({ ok: true, json: async () => completedGame() })
  try {
    await mount(App)
    await click(button('START'))
    await click(button('2 · Train'))
    const top = () => container.querySelector('[aria-label="Game stages"]')
    const bottom = () => container.querySelector('[aria-label="Game stages at bottom"]')
    assert.equal(scrolls.length, 0, 'Top tabs and initial mounting do not hijack scroll position')
    await click(bottom().querySelector('[data-stage="train"]'))
    assert.equal(scrolls.length, 0, 'Clicking the active stage does not jump or move focus')
    await click(bottom().querySelector('[data-stage="explore"]'))
    assert.equal(scrolls.length, 1)
    assert.equal(scrolls[0].target, top())
    assert.deepEqual(scrolls[0].options, { behavior: 'instant', block: 'start' })
    assert.equal(document.activeElement, top().querySelector('[data-stage="explore"]'))
    await click(bottom().querySelector('[data-stage="sort"]'))
    assert.equal(scrolls.length, 2)
    assert.equal(document.activeElement, top().querySelector('[data-stage="sort"]'))
    assert.equal(window.sessionStorage.getItem('waiste-session'), game.id)
  } finally {
    if (originalScroll) window.HTMLElement.prototype.scrollIntoView = originalScroll
    else delete window.HTMLElement.prototype.scrollIntoView
  }
})

test('1/2/3 shortcuts sort visible items into the matching bins and prefer a selected item', async () => {
  const actions = []
  await mount(Conveyor, { game, paused: false, saving: 0, onResolve: (...args) => actions.push(args) })
  await key('1')
  assert.equal(actions.length, 0, 'The instruction dialog blocks sorting')
  await click(button('Start sorting at speed 2'))
  await key('1')
  assert.deepEqual(actions.map(([item, outcome, bin, speed]) => [item.index, outcome, bin, speed]), [[0, 'sorted', 0, 'NORMAL']])
  await key('2')
  assert.equal(actions.length, 1, 'A shortcut must not sort an item that has not reached the belt')

  await drive(32)
  await key('Enter', actor(2))
  await key('3')
  assert.equal(actions.at(-1)[0].index, 2, 'The selected visible item takes priority over the earlier item')
  assert.equal(actions.at(-1)[2], 2)
  await key('2', container.querySelector('.conveyor-svg'))
  assert.equal(actions.at(-1)[0].index, 1)
  assert.equal(actions.at(-1)[2], 1)
  assert.equal(actor(0), null)
  assert.equal(actor(1), null)
  assert.equal(actor(2), null)
  assert.equal(new Set(actions.map(([item]) => item.index)).size, actions.length, 'Each item is recorded once')
})

test('sorting shortcuts leave focused controls alone and cannot act while the mission is inactive or unsaved', async () => {
  const actions = []
  const props = { game, paused: false, saving: 0, onResolve: (...args) => actions.push(args) }
  await mount(Conveyor, props)
  await click(button('Start sorting at speed 2'))
  const controls = ['input', 'select', 'button', 'div'].map(tag => {
    const element = document.createElement(tag)
    if (tag === 'div') element.setAttribute('contenteditable', 'true')
    container.append(element)
    return element
  })
  for (const control of controls) {
    await key('1', control)
    assert.equal(actions.length, 0, `Number keys in ${control.tagName.toLowerCase()} must keep their normal meaning`)
  }
  controls.forEach(control => control.remove())
  const unrelatedPanel = document.createElement('div')
  unrelatedPanel.tabIndex = 0
  container.append(unrelatedPanel)
  await key('1', unrelatedPanel)
  unrelatedPanel.remove()
  assert.equal(actions.length, 0, 'Unrelated panels must not trigger the scene shortcuts')

  await render(Conveyor, { ...props, active: false, paused: true })
  await key('1')
  assert.equal(actions.length, 0)
  await render(Conveyor, { ...props, saveError: 'Waiting to reconnect' })
  await key('1')
  assert.equal(actions.length, 0)
  await render(Conveyor, { ...props, paused: true })
  await key('1')
  assert.equal(actions.length, 0)
  await render(Conveyor, props)
  await key('1')
  assert.deepEqual(actions.map(([item, outcome, bin]) => [item.index, outcome, bin]), [[0, 'sorted', 0]])
})

test('up/down keys change speed within 0–3, resume from pause, and preserve sorting speed records', async () => {
  const actions = []
  await mount(Conveyor, { game, paused: false, saving: 0, onResolve: (...args) => actions.push(args) })
  await key('ArrowUp')
  assert.equal(speed(), 'Belt speed 2 of 3', 'Keys cannot bypass the start instructions')
  await click(button('Start sorting at speed 2'))
  assert.equal((await key('ArrowUp')).defaultPrevented, true, 'Game arrows do not scroll the page')
  assert.equal(speed(), 'Belt speed 3 of 3')
  await key('ArrowUp')
  assert.equal(speed(), 'Belt speed 3 of 3')
  for (let level = 2; level >= 0; level--) {
    await key('ArrowDown')
    assert.equal(speed(), `Belt speed ${level} of 3`)
  }
  await key('ArrowDown')
  assert.equal(speed(), 'Belt speed 0 of 3')
  assert.equal(frames.size, 0)
  await key('1')
  assert.equal(actions.length, 0, 'Paused items are not sorted by accident')
  await key('ArrowUp')
  assert.equal(speed(), 'Belt speed 1 of 3')
  assert.equal(frames.size, 1)
  await key('3')
  assert.deepEqual(actions.map(([item, outcome, bin, recordedSpeed]) => [item.index, outcome, bin, recordedSpeed]), [[0, 'sorted', 2, 'SLOW']])
})

test('number keys work after clicking scene controls and moving items do not clutter the tab sequence', async () => {
  const actions = []
  await mount(Conveyor, { game, paused: false, saving: 0, onResolve: (...args) => actions.push(args) })
  await click(button('Start sorting at speed 2'))
  const up = container.querySelector('[aria-label="Increase belt speed"]')
  up.focus()
  await key('1', up)
  assert.deepEqual(actions.map(([item, , bin]) => [item.index, bin]), [[0, 0]])
  await drive(18)
  const compost = button('Compost')
  compost.focus()
  await key('2', compost)
  assert.deepEqual(actions.map(([item, , bin]) => [item.index, bin]), [[0, 0], [1, 1]])
  assert.ok([...container.querySelectorAll('.sorting-bin, [aria-label^="Select Item"]')].every(element => element.getAttribute('tabindex') === '-1'))
  await drive(18)
  await click(button('Landfill'))
  assert.equal(actions.at(-1)[0].index, 2, 'The visible bin buttons also sort the next item')
  assert.equal(actions.at(-1)[2], 2)
})

test('speed keys leave forms and dialogs alone and cannot change hidden, paused, or disconnected games', async () => {
  const props = { game, paused: false, saving: 0, onResolve: () => {} }
  await mount(Conveyor, props)
  await click(button('Start sorting at speed 2'))
  for (const tag of ['input', 'select', 'textarea', 'div']) {
    const element = document.createElement(tag)
    if (tag === 'div') element.setAttribute('contenteditable', 'true')
    container.querySelector('.keyboard-controls').append(element)
    assert.equal((await key('ArrowDown', element)).defaultPrevented, false)
    assert.equal(speed(), 'Belt speed 2 of 3')
    element.remove()
  }
  const dialog = document.createElement('div')
  dialog.setAttribute('role', 'dialog')
  container.querySelector('.keyboard-controls').append(dialog)
  await key('ArrowUp', dialog)
  dialog.remove()
  for (const options of [{ repeat: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }]) await key('ArrowDown', document.body, options)
  assert.equal(speed(), 'Belt speed 2 of 3')
  for (const block of [{ paused: true }, { active: false }, { saveError: 'Waiting to reconnect' }]) {
    await render(Conveyor, { ...props, ...block })
    await key('ArrowUp')
    assert.equal(speed(), 'Belt speed 2 of 3')
  }
  await render(Conveyor, props)
  await key('ArrowDown')
  assert.equal(speed(), 'Belt speed 1 of 3')
})
