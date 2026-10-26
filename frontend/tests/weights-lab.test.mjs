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
const { default: RobotDetective, WeightExperiment } = await server.ssrLoadModule('/src/RobotDetective.jsx')
let container, root
async function mount(Component = WeightExperiment, props = {}) {
  container = document.createElement('div'); document.body.append(container)
  root = createRoot(container)
  await React.act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(Component, props))))
  await dismissInstructions()
}
async function dismissInstructions() {
  const start = document.querySelector('.detective-instructions-dialog button')
  if (start) await React.act(async () => start.dispatchEvent(new window.MouseEvent('click', { bubbles: true })))
}
async function slider(index, value) {
  await React.act(async () => {
    const input = container.querySelectorAll('.detective-weight input[type="range"]')[index]
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, String(value))
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
  })
}
async function click(text) {
  const button = [...container.querySelectorAll('button')].find(button => button.textContent.trim() === text)
  assert.ok(button, `Button not found: ${text}`)
  await React.act(async () => button.dispatchEvent(new window.MouseEvent('click', { bubbles: true })))
  await dismissInstructions()
}
const softmax = raw => raw.map(value => Math.exp(value) / raw.reduce((sum, item) => sum + Math.exp(item), 0))
function scores() { return [...container.querySelectorAll('.detective-weight meter')].map(meter => meter.value) }
function complete() { return container.querySelectorAll('.weight-milestones [data-complete]').length }

afterEach(async () => {
  if (root) await React.act(async () => root.unmount())
  root = null; container?.remove(); window.sessionStorage.clear()
})
after(async () => { await server.close(); dom.window.close() })

test('weights challenge requires raising Compost before lowering it, and reset restores the model and goals', async () => {
  await mount()
  assert.deepEqual(scores(), softmax([.7, .4, .5]))
  assert.match(container.querySelector('.weight-live-pick').textContent, /Recycling/)
  assert.equal(complete(), 0)
  await slider(1, -1)
  assert.equal(complete(), 0, 'Lowering first cannot skip the first challenge')
  assert.ok(container.querySelector('.weight-discoveries [data-found]'))
  await slider(1, 2)
  assert.equal(complete(), 1)
  assert.match(container.querySelector('.weight-live-pick').textContent, /Compost/)
  assert.deepEqual(scores(), softmax([.7, 1.6, .5]))
  await slider(0, 0)
  assert.equal(complete(), 2)
  assert.equal(container.querySelectorAll('.weight-discoveries [data-found]').length, 2)
  assert.match(container.querySelector('[role="status"]').textContent, /Connection mastered/)
  assert.deepEqual(scores(), softmax([.7, 0, .5]))
  await slider(1, 3)
  assert.deepEqual(scores(), softmax([.7, 0, .5]), 'Zero response switches off the contribution even with a large weight')
  await click('Reset experiment')
  assert.deepEqual(scores(), softmax([.7, .4, .5]))
  assert.equal(complete(), 0)
  assert.equal(container.querySelectorAll('.weight-discoveries [data-found]').length, 0)
  assert.deepEqual([...container.querySelectorAll('input')].map(input => input.value), ['0.8', '0.5'])
})

test('weights activity records settled choices, flushes on navigation and unmount, and never logs initial mount', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const events = [], onActivity = event => events.push(event)
  await mount(WeightExperiment, { onActivity, navigationKey: 0 })
  await React.act(async () => context.mock.timers.tick(800))
  assert.equal(events.length, 0)
  await slider(1, 1)
  await React.act(async () => context.mock.timers.tick(500))
  await slider(1, 2)
  await React.act(async () => context.mock.timers.tick(699))
  assert.equal(events.length, 0)
  await React.act(async () => context.mock.timers.tick(1))
  assert.deepEqual(events, [{ kind: 'weight_experiment', response: .8, weight: 2 }])
  await slider(0, .5)
  await React.act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(WeightExperiment, { onActivity, navigationKey: 1 }))))
  assert.deepEqual(events.at(-1), { kind: 'weight_experiment', response: .5, weight: 2 })
  await React.act(async () => context.mock.timers.tick(1000))
  assert.equal(events.length, 2, 'Navigation flush must not send a duplicate later')
  await slider(1, -2)
  await React.act(async () => root.unmount())
  root = null
  assert.deepEqual(events.at(-1), { kind: 'weight_experiment', response: .5, weight: -2 })
  assert.equal(events.length, 3)
})

test('experiment changes remain separate from actual CNN predictions and all three investigation steps', async () => {
  const image = 'data:image/png;base64,placeholder', calls = []
  const probabilities = Object.freeze([.8, .15, .05])
  const game = { id: 'demo-session', training: { results: { predictions: [{
    image, name: 'Test can', label: 'Compost', guideline: 'Recycling', probabilities, before: [.2, .5, .3],
    inspection: { input_image: image, rgb: [80, 120, 200], normalized: [-.37, -.05, .56],
      layers: [{ name: 'Block 1', shape: [16, 32, 32], maps: [{ channel: 0, image }] }] },
  }] } } }
  globalThis.fetch = async (...args) => { calls.push(args); throw new Error('Demo controls must not call the CNN') }
  await mount(RobotDetective, { game })
  await slider(1, -3)
  await slider(0, 0)
  assert.deepEqual(game.training.results.predictions[0].probabilities, [.8, .15, .05])
  assert.equal(calls.length, 0)
  assert.equal(container.querySelectorAll('.detective-steps button').length, 3)
  await click('Filters')
  assert.ok(container.querySelector('.filters-box'), 'The original filters remain available')
  await click('Next: follow the decision →')
  await click('Recycling')
  assert.deepEqual([...container.querySelectorAll('[aria-label="After training scores"] meter')].map(meter => meter.value), [.8, .15, .05])
})
