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
async function key(key, target = document.body) {
  await React.act(async () => target.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })))
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
  await key('1', container.querySelector('[aria-label="Increase belt speed"]'))
  assert.equal(actions.length, 0, 'A focused speed arrow must not also sort an item')
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
