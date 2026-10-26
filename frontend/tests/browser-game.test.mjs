import assert from 'node:assert/strict'
import { after, afterEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import { advanceActors, binAt, createWorld, datasetSplitCounts, initialActors } from '../src/gameEngine.js'

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
const { default: HomePictures } = await server.ssrLoadModule('/src/HomePictures.jsx')
const { default: RobotDetective } = await server.ssrLoadModule('/src/RobotDetective.jsx')
const { default: LearningLab } = await server.ssrLoadModule('/src/LearningLab.jsx')
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII='
const game = { id: '11111111-1111-4111-8111-111111111111', items: Array.from({ length: 30 }, (_, index) => ({ index, name: 'Item ' + index, image })),
  actions: [], summary: { resolved: 0, correct: 0, wrong: 0, missed: 0, score: 0, streak: 0, best_streak: 0 }, training: { status: 'ready', history: [] } }
let container, root
async function dismissActivityInstructions() {
  const start = document.querySelector('.detective-instructions-dialog button')
  if (start) await React.act(async () => start.dispatchEvent(new window.MouseEvent('click', { bubbles: true })))
}
async function mount(Component, props = {}, dismissInstructions = true) {
  if (Component === App) window.sessionStorage.setItem('waiste-player', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  container = document.createElement('div'); document.body.append(container)
  root = createRoot(container)
  await React.act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(Component, props))))
  if (dismissInstructions) await dismissActivityInstructions()
}
function button(text) {
  const found = [...container.querySelectorAll('button')].find(element => element.textContent.trim() === text)
  assert.ok(found, `Button not found: ${text}`)
  return found
}
async function click(element, dismissInstructions = true) {
  const startsIntro = element.textContent === 'Start sorting at speed 2'
  await React.act(async () => element.dispatchEvent(new window.MouseEvent('click', { bubbles: true })))
  if (startsIntro) await drive(30)
  if (dismissInstructions) await dismissActivityInstructions()
}
// Keep existing slow-speed regression scenarios at their original timing.
async function startOrIncrease() {
  const start = [...container.querySelectorAll('button')].find(element => element.textContent === 'Start sorting at speed 2')
  if (start) {
    await click(start)
    const down = container.querySelector('[aria-label="Decrease belt speed"]')
    await click(down)
  } else {
    const up = container.querySelector('[aria-label="Increase belt speed"]')
    await click(up)
  }
}
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

test('start pictures shuffle in place every 3500ms and cover every sorting item without duplicates', async context => {
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
        assert.ok(['rgb(48, 48, 89)', 'rgb(41, 70, 83)', 'rgb(77, 53, 85)'].includes(color))
        assert.notEqual(color, lastBackground.get(img.alt))
        lastBackground.set(img.alt, color)
      }
    }
    const first = names()
    checkBackgrounds()
    assert.equal(first.length, 6)
    assert.deepEqual(captions(), first)
    assert.equal(container.querySelector('button'), null)
    await React.act(async () => context.mock.timers.tick(3499))
    assert.deepEqual(names(), first)
    await React.act(async () => context.mock.timers.tick(1))
    assert.notDeepEqual(names(), first)
    checkBackgrounds()
    assert.equal(new Set([...first, ...names()]).size, 12)
    let previous = names()
    for (let i = 0; i < 10; i++) {
      await React.act(async () => context.mock.timers.tick(3500))
      assert.equal(new Set(names()).size, 6)
      assert.deepEqual(captions(), names())
      checkBackgrounds()
      assert.ok(names().every(name => !previous.includes(name)))
      previous = names()
    }
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    const hidden = names()
    await React.act(async () => context.mock.timers.tick(4000))
    assert.deepEqual(names(), hidden)
  } finally {
    delete document.hidden
  }
})

test('bin introduction highlights 1, 2 and 3 in order before the belt starts', async () => {
  await mount(Conveyor, { game, onResolve() {}, help() {} })
  await React.act(async () => button('Start sorting at speed 2').dispatchEvent(new window.MouseEvent('click', { bubbles: true })))
  const actors = () => [...container.querySelectorAll('[aria-label^="Select Item"]')].map(item => item.getAttribute('transform'))
  const initial = actors()
  for (let bin = 0; bin < 3; bin++) {
    assert.equal(container.querySelector('.bin-intro-number').textContent, String(bin + 1))
    assert.equal(container.querySelectorAll('.bin-intro-flash .bin-symbol').length, 1)
    assert.equal(container.querySelector('.game-board').classList.contains('moving'), false)
    await drive(10)
    assert.deepEqual(actors(), initial)
  }
  assert.equal(container.querySelector('.bin-intro-number'), null)
  assert.equal(container.querySelector('.game-board').classList.contains('moving'), true)
  await drive(3)
  assert.notDeepEqual(actors(), initial)
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
  assert.equal(binAt(280, 700, 80), 0)
  assert.equal(binAt(640, 700, 80), 1)
  assert.equal(binAt(1000, 700, 80), 2)
  assert.equal(binAt(640, 600, 80), null)
  const store = createWorld(actors)
  const before = store.getSnapshot()
  store.read().actors = []
  store.publish()
  assert.equal(before.actors.length, 29)
  assert.equal(store.getSnapshot().actors.length, 0)
})

test('splash starts the belt at 2; speed controls still adjust and pause it at 0', async () => {
  const actions = []
  const props = { game, paused: false, onResolve: (...args) => actions.push(args), help: () => {}, saving: 0 }
  await mount(Conveyor, props)
  const up = () => container.querySelector('[aria-label="Increase belt speed"]')
  const down = () => container.querySelector('[aria-label="Decrease belt speed"]')
  const display = () => container.querySelector('.belt-speed-control [role="img"]').getAttribute('aria-label')
  assert.equal(container.querySelector('select'), null)
  assert.equal([...container.querySelectorAll('button')].some(button => /Start belt|Pause belt/.test(button.textContent)), false)
  assert.equal(display(), 'Belt speed 2 of 3')
  assert.equal(down().getAttribute('aria-disabled'), 'true')
  assert.equal(frames.size, 0)
  assert.equal(container.querySelector('.lava-tile').style.animationPlayState, 'running')
  assert.equal(container.querySelector('.feedback-tv-screen').firstElementChild.className, 'tv-score')
  assert.equal(container.querySelector('.memory-tv').getAttribute('transform'), 'translate(0 21)')
  assert.equal(container.querySelector('.feedback-tv').getAttribute('transform'), 'translate(0 386)')
  const rightTV = container.querySelector('.right-tv rect:last-child')
  assert.equal(rightTV.getAttribute('width'), '252')
  assert.equal(rightTV.getAttribute('height'), '275')
  await click(down())
  assert.equal(display(), 'Belt speed 2 of 3')
  await click(up())
  assert.equal(frames.size, 0, 'Arrows cannot bypass the instruction screen')
  await click(button('Start sorting at speed 2'))
  assert.equal(display(), 'Belt speed 2 of 3')
  assert.equal(frames.size, 1)
  assert.ok(container.querySelector('.robot-awake'))
  assert.ok(container.querySelector('.robot-floating'))
  assert.equal(container.querySelectorAll('.robot-hover-line').length, 3)
  await click(up())
  await click(up())
  await click(up())
  assert.equal(display(), 'Belt speed 3 of 3')
  assert.equal(up().getAttribute('aria-disabled'), 'true')
  for (const key of ['Enter', ' ', 'Enter']) await React.act(async () => down().dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true })))
  assert.equal(display(), 'Belt speed 0 of 3')
  assert.equal(frames.size, 0)
  assert.ok(container.querySelector('.robot-awake'))
  const pausedActors = [...container.querySelectorAll('.conveyor-svg > g[aria-label^="Select"]')].map(actor => actor.getAttribute('transform'))
  await drive(10)
  assert.deepEqual([...container.querySelectorAll('.conveyor-svg > g[aria-label^="Select"]')].map(actor => actor.getAttribute('transform')), pausedActors)
  await click(up())
  for (const [index, expected] of ['SLOW', 'NORMAL', 'FAST'].entries()) {
    if (index) { await click(up()); await drive(30) }
    await React.act(async () => container.querySelector(`[aria-label="Select Item ${index}"]`).dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    await click(button('Recycling'))
    assert.equal(actions[index][3], expected)
  }
  await React.act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(Conveyor, { ...props, active: false, paused: true }))))
  assert.equal(container.querySelector('.robot-awake'), null)
  assert.equal(frames.size, 0)
  assert.equal(container.querySelector('.lava-tile').style.animationPlayState, 'paused')
})

test('two seconds at speed zero stops the robot and offers an in-place phase restart', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  let rounds = 0
  globalThis.fetch = async url => {
    assert.equal(url, '/api/sessions')
    rounds++
    return { ok: true, json: async () => ({ ...structuredClone(game), id: `round-${rounds}` }) }
  }
  await mount(App)
  await click(button('START'))
  const up = () => container.querySelector('[aria-label="Increase belt speed"]')
  const down = () => container.querySelector('[aria-label="Decrease belt speed"]')
  await React.act(async () => context.mock.timers.tick(3000))
  assert.equal(container.querySelector('.robot-resort'), null)
  await startOrIncrease()
  await React.act(async () => context.mock.timers.tick(5000))
  await click(down())
  await React.act(async () => context.mock.timers.tick(1999))
  assert.equal(container.querySelector('.robot-idle'), null)
  assert.equal(container.querySelector('.robot-resort'), null)
  await click(up())
  await React.act(async () => context.mock.timers.tick(3000))
  assert.equal(container.querySelector('.robot-resort'), null)
  await click(down())
  await React.act(async () => context.mock.timers.tick(2000))
  assert.ok(container.querySelector('.robot-idle'))
  assert.ok(container.querySelector('.robot-resort'))
  assert.equal(container.querySelector('.robot-restart-prompt [role="img"]').getAttribute('aria-label'), 'would you like to restart your sorting?')
  assert.equal(button('RESET BELT').disabled, false)
  await click(up())
  assert.equal(container.querySelector('.robot-idle'), null)
  assert.equal(container.querySelector('.robot-resort'), null)
  assert.equal(container.querySelector('.robot-restart-prompt'), null)
  await click(down())
  await React.act(async () => context.mock.timers.tick(2000))
  await click(button('RESET BELT'))
  assert.equal(rounds, 2)
  assert.ok(container.querySelector('.conveyor-svg'))
  assert.equal(container.querySelector('.title-screen'), null)
  assert.equal(container.querySelector('.robot-resort'), null)
  assert.equal(container.querySelector('.robot-idle'), null)
  assert.equal(container.querySelector('.belt-speed-control [role="img"]').getAttribute('aria-label'), 'Belt speed 2 of 3')
  assert.deepEqual([...container.querySelectorAll('.bin-item-count')].map(text => text.textContent), ['ITEMS: 0', 'ITEMS: 0', 'ITEMS: 0'])
})

test('SVG guidance disappears five seconds after starting while item and bin labels remain', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const props = { game, paused: false, onResolve: () => {}, help: () => {}, saving: 0 }
  await mount(Conveyor, props)
  const svg = () => container.querySelector('.conveyor-svg')
  await React.act(async () => context.mock.timers.tick(6000))
  assert.ok(svg().querySelector('.lava-arrow'))
  assert.equal(svg().querySelector('.robot-hover-lines'), null)
  await startOrIncrease()
  assert.ok(svg().querySelector('.robot-floating'))
  assert.ok(svg().querySelector('.robot-hover-lines'))
  await React.act(async () => context.mock.timers.tick(4999))
  assert.match(svg().textContent, /RE-CYCLER, NEW HIRE/)
  assert.ok(svg().querySelector('.lava-arrow'))
  await React.act(async () => context.mock.timers.tick(1))
  assert.equal(svg().querySelector('.lava-arrow'), null)
  assert.deepEqual([...svg().querySelectorAll('text')].map(text => text.textContent), ['BELT SPEED', 'SLOW', 'LAVA · LOST PRACTICE EXAMPLES', 'ITEMS: 0', '1 · RECYCLING', 'ITEMS: 0', '2 · COMPOST', 'ITEMS: 0', '3 · LANDFILL', 'Item 0'])
  assert.ok(svg().querySelector('.pixel-robot'))
  assert.ok(svg().querySelector('.robot-floating'))
  assert.ok(svg().querySelector('.robot-pacing'))
  assert.equal(svg().querySelectorAll('.robot-eye').length, 2)
  assert.equal(svg().querySelectorAll('.robot-foot').length, 0)
  const hoverLines = [...svg().querySelectorAll('.robot-hover-line')]
  assert.equal(hoverLines.length, 3)
  assert.equal(svg().querySelector('.robot-hover-lines').getAttribute('stroke'), '#75e5f5')
  assert.deepEqual(hoverLines.map(line => Number(line.getAttribute('x2')) - Number(line.getAttribute('x1'))), [80, 56, 32])
  await click(container.querySelector('[aria-label="Decrease belt speed"]'))
  assert.ok(container.querySelector('.robot-awake'))
  await startOrIncrease()
  assert.equal(svg().querySelector('.lava-arrow'), null)
  await React.act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(Conveyor, { ...props, key: 'new-round' }))))
  assert.ok(svg().querySelector('.lava-arrow'))
  assert.match(svg().textContent, /RE-CYCLER, NEW HIRE/)
  assert.equal(svg().querySelector('.robot-floating'), null)
})

test('completed sorting settles the robot before showing saved mission totals', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const almostDone = { ...game, actions: game.items.slice(0, 29).map(item => ({ index: item.index, outcome: 'sorted', chosen_class: 0 })),
    summary: { ...game.summary, resolved: 29, correct: 29, score: 290, streak: 29, best_streak: 29 } }
  const props = { game: almostDone, paused: false, onResolve: () => {}, help: () => {}, saving: 0 }
  await mount(Conveyor, props)
  await startOrIncrease()
  await React.act(async () => container.querySelector('[aria-label="Select Item 29"]').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  await click(button('Recycling'))
  assert.equal(container.querySelector('.robot-summary'), null)
  const done = { ...almostDone, summary: { ...almostDone.summary, resolved: 30, correct: 30, score: 300, streak: 30, best_streak: 30 } }
  await React.act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(Conveyor, { ...props, game: done }))))
  assert.equal(container.querySelector('.tv-feedback p').textContent, 'SCORE: 300Perfect sorting!')
  assert.equal(container.querySelector('.tv-score').getAttribute('aria-hidden'), 'true')
  assert.equal(container.querySelector('.lava-tile').style.animationPlayState, 'running')
  assert.equal(container.querySelector('.tv-feedback').dataset.outcome, 'complete')
  assert.ok(container.querySelector('.tv-feedback.mission-heading'))
  assert.equal(container.querySelector('.feedback-flash'), null)
  assert.equal(container.querySelector('.tv-static'), null)
  assert.equal(container.querySelector('.tv-score strong').textContent, '300')
  assert.ok(container.querySelector('.robot-settling'))
  assert.equal(container.querySelector('.robot-pacing'), null)
  assert.equal(container.querySelector('.robot-summary'), null)
  await React.act(async () => context.mock.timers.tick(1399))
  assert.equal(container.querySelector('.robot-summary'), null)
  await React.act(async () => context.mock.timers.tick(1))
  assert.ok(container.querySelector('.robot-settled'))
  assert.ok(container.querySelector('.robot-awake'))
  assert.ok(container.querySelector('.robot-floating'))
  const bubble = container.querySelector('.robot-summary')
  assert.ok(bubble)
  for (const text of ['MISSION COMPLETE!', 'Score: 300', 'Sorted Correctly: 30', 'Lost to Lava: 0', 'Best streak: 30', 'Progress saved']) assert.ok(bubble.textContent.includes(text), text)
  const summaryTexts = [...bubble.querySelectorAll('text')]
  assert.equal(summaryTexts.some(text => /\/30 complete|^Streak:|^Best:/.test(text.textContent)), false)
  for (const label of ['Score: 300', 'Best streak: 30']) {
    const text = summaryTexts.find(text => text.textContent === label)
    assert.equal(text.getAttribute('x'), '260')
    assert.equal(text.getAttribute('text-anchor'), 'middle')
  }
  assert.equal(container.querySelector('.belt-mission-actions foreignObject').getAttribute('y'), '-190')
  await drive(60)
  assert.ok(container.querySelector('.belt-mission-actions.delivered'))
  assert.equal(container.querySelector('.belt-mission-actions foreignObject').getAttribute('y'), '145')
  assert.equal(frames.size, 0)
  const imperfect = { ...done, summary: { ...done.summary, correct: 29, missed: 1, score: 290 } }
  await React.act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(Conveyor, { ...props, game: imperfect, key: 'restored-complete' }))))
  assert.equal(container.querySelector('.tv-feedback p').textContent, 'SCORE: 290Ready to teach your robot?')
  assert.equal(container.querySelector('.tv-static'), null)
  assert.ok(container.querySelector('.feedback-tv-screen.sorting-complete'))
  await React.act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(Conveyor, { ...props, game, key: 'fresh-round' }))))
  assert.equal(container.querySelector('.robot-summary'), null)
  assert.equal(container.querySelector('.robot-settled'), null)
  assert.equal(container.querySelector('.mission-heading'), null)
  assert.equal(container.querySelector('.belt-mission-actions'), null)
  assert.ok(container.querySelector('.tv-static'))
  assert.equal(container.querySelector('.tv-score').getAttribute('aria-hidden'), 'true')
  assert.equal(container.querySelector('.tv-score').hidden, true)
})

test('completion buttons ride the belt to its middle, pause off screen, then train or re-sort', async () => {
  const completed = { ...game, actions: game.items.map(item => ({ index: item.index, outcome: 'sorted', chosen_class: 0 })),
    summary: { ...game.summary, resolved: 30, correct: 30, score: 300 } }
  let trainClicks = 0, resortClicks = 0
  const props = { game: completed, paused: false, onResolve: () => assert.fail('Completion must not sort another item'), help: () => {}, saving: 0,
    onTrain: () => trainClicks++, onResort: () => resortClicks++ }
  await mount(Conveyor, props)
  const cargo = () => container.querySelector('.belt-mission-actions foreignObject')
  const position = () => Number(cargo().getAttribute('y'))
  assert.equal(position(), -190)
  assert.equal(button('Phase 2 * TRAIN').disabled, true)
  assert.equal(button('RE-SORT').disabled, true)
  assert.equal(frames.size, 1)
  await drive(15)
  assert.ok(position() > -190 && position() < 145)
  const halfway = position()
  await React.act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(Conveyor, { ...props, active: false, paused: true }))))
  await drive(20)
  assert.equal(position(), halfway)
  assert.equal(frames.size, 0)
  await React.act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(Conveyor, props))))
  await drive(60)
  assert.equal(position(), 145)
  assert.equal(frames.size, 0)
  assert.ok(container.querySelector('.belt-mission-actions.delivered'))
  assert.equal(container.querySelector('.belt-speed-control [role="img"]').getAttribute('aria-label'), 'Belt speed 0 of 3')
  assert.equal(button('Phase 2 * TRAIN').disabled, false)
  assert.equal(button('RE-SORT').disabled, false)
  await click(button('Phase 2 * TRAIN'))
  await click(button('RE-SORT'))
  assert.equal(trainClicks, 1)
  assert.equal(resortClicks, 1)
  await React.act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(Conveyor, { ...props, saving: 1 }))))
  assert.equal(button('Phase 2 * TRAIN').disabled, true)
  assert.equal(button('RE-SORT').disabled, true)
})

test('bin counters count each drop immediately, replay its symbol, and restore saved choices', async () => {
  const props = { game, paused: false, onResolve: () => {}, help: () => {}, saving: 0 }
  await mount(Conveyor, props)
  const counts = () => [...container.querySelectorAll('.bin-item-count')].map(text => text.textContent)
  const select = async index => React.act(async () => container.querySelector(`[aria-label="Select Item ${index}"]`).dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  assert.deepEqual(counts(), ['ITEMS: 0', 'ITEMS: 0', 'ITEMS: 0'])
  assert.equal(container.querySelector('.bin-sort-logo'), null)
  await startOrIncrease()
  await select(0)
  await click(button('Recycling'))
  assert.deepEqual(counts(), ['ITEMS: 1', 'ITEMS: 0', 'ITEMS: 0'])
  const firstLogo = container.querySelector('.bin-sort-logo')
  assert.ok(firstLogo)
  await drive(30)
  await select(1)
  await click(button('Recycling'))
  assert.deepEqual(counts(), ['ITEMS: 2', 'ITEMS: 0', 'ITEMS: 0'])
  assert.notEqual(container.querySelector('.bin-sort-logo'), firstLogo)
  await drive(30)
  await select(2)
  await click(button('Compost'))
  assert.deepEqual(counts(), ['ITEMS: 2', 'ITEMS: 1', 'ITEMS: 0'])
  await drive(60)
  assert.deepEqual(counts(), ['ITEMS: 2', 'ITEMS: 1', 'ITEMS: 0'])
  const restored = { ...game, actions: [
    { index: 0, outcome: 'sorted', chosen_class: 0 },
    { index: 1, outcome: 'sorted', chosen_class: 2 },
    { index: 2, outcome: 'missed', chosen_class: null },
  ] }
  await React.act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(Conveyor, { ...props, game: restored, key: 'restored' }))))
  assert.deepEqual(counts(), ['ITEMS: 1', 'ITEMS: 0', 'ITEMS: 1'])
  assert.equal(container.querySelector('.bin-sort-logo'), null)
})

test('memory records pictures and outcomes, then scrolls after four entries and restores all 30', async () => {
  const saved = [
    { index: 2, outcome: 'sorted', chosen_class: 0 },
    { index: 0, outcome: 'missed', chosen_class: null },
    { index: 1, outcome: 'sorted', chosen_class: 1 },
    { index: 3, outcome: 'sorted', chosen_class: 2 },
  ]
  const props = { game: { ...game, actions: saved }, paused: false, onResolve: () => {}, help: () => {}, saving: 0 }
  await mount(Conveyor, props)
  const table = () => container.querySelector('.memory-table')
  const viewport = () => container.querySelector('.memory-scroll')
  assert.equal(container.querySelector('.memory-panel h2').textContent, 'MEMORY')
  assert.deepEqual([...table().querySelectorAll('thead th')].map(th => th.textContent), ['#', 'ITEM', 'BIN'])
  assert.deepEqual([...table().querySelectorAll('tbody img')].map(img => img.alt), ['Item 2', 'Item 0', 'Item 1', 'Item 3'])
  assert.ok(table().querySelector('.memory-flame'))
  assert.equal(table().querySelectorAll('.bin-symbol').length, 3)
  assert.equal(viewport().scrollTop, 0)
  await startOrIncrease()
  await React.act(async () => container.querySelector('[aria-label="Select Item 4"]').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  await click(button('Recycling'))
  assert.equal(table().querySelectorAll('.memory-row').length, 5)
  assert.equal(viewport().scrollTop, 48)
  assert.equal(table().querySelector('.memory-row:last-child th').textContent, '5')
  const full = { ...game, actions: game.items.map(item => ({ index: item.index, outcome: 'sorted', chosen_class: item.index % 3 })) }
  await React.act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(Conveyor, { ...props, game: full, key: 'full' }))))
  assert.equal(table().querySelectorAll('.memory-row').length, 30)
  assert.equal(table().querySelector('.memory-row:last-child th').textContent, '30')
  assert.equal(viewport().scrollTop, 26 * 48)
})

test('moving items fall into lava exactly once and successful drag selects the correct bin', async () => {
  const actions = []
  await mount(Conveyor, { game, paused: false, onResolve: (...args) => actions.push(args), help: () => {}, saving: 0 })
  await startOrIncrease()
  await drive(30)
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
  await drive(90)
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
  await startOrIncrease()
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

test('main menu preserves the active session and displays the landing screen', async () => {
  globalThis.fetch = async url => ({ ok: true, json: async () => url === '/api/sessions' ? structuredClone(game) : {} })
  await mount(App)
  assert.equal(container.querySelector('.home-robot-layer').getAttribute('aria-hidden'), 'true')
  await click(button('START'))
  assert.equal(container.querySelector('.home-robot-layer'), null)
  assert.equal(window.sessionStorage.getItem('waiste-session'), game.id)
  await click(button('Main menu'))
  assert.equal(window.sessionStorage.getItem('waiste-session'), game.id)
  assert.ok(container.querySelector('#home-title'))
  assert.ok(container.querySelector('.home-robot-layer'))
  assert.ok(container.querySelector('.mission-screen').hidden)
  assert.ok(button('Resume mission'))
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
  await startOrIncrease()
  await drive(80)
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
  assert.equal(container.querySelector('.tv-feedback p').textContent, 'NOT THE LAVA! RE-CYCLER wont be able to see that item in training.')
  assert.equal(container.querySelector('.tv-feedback').dataset.outcome, 'missed')
  assert.equal(container.querySelector('.feedback'), null)
  assert.equal(frames.size, 1)
})


test('TV feedback names incorrect bins and uses each of the three correct responses', async context => {
  let randomValue = 0, resolved = 0
  context.mock.method(Math, 'random', () => randomValue)
  globalThis.fetch = async (url, init) => {
    if (url === '/api/sessions') return { ok: true, json: async () => structuredClone(game) }
    const body = JSON.parse(init.body)
    resolved += 1
    return { ok: true, json: async () => ({ correct: body.chosen_class === 0, expected_class: 0,
      summary: { ...game.summary, resolved, score: Math.max(0, resolved - 1) * 10 } }) }
  }
  await mount(App)
  await click(button('START'))
  await startOrIncrease()
  const outcomes = [
    ['Compost', 0, 'Compost, really? I thought that was Recycling'],
    ['Recycling', 0, 'Nice +10'],
    ['Recycling', .4, 'GREAT +10'],
    ['Recycling', .9, 'SMART +10'],
    ['Recycling', .9, 'SMART +10'],
  ]
  for (let index = 0; index < outcomes.length; index++) {
    if (index) await drive(30)
    const [bin, value, message] = outcomes[index]
    randomValue = value
    const previousOutput = container.querySelector('.tv-feedback')
    await React.act(async () => container.querySelector(`[aria-label="Select Item ${index}"]`).dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    await click(button(bin))
    assert.equal(container.querySelector('.tv-feedback p').textContent, message)
    assert.ok(container.querySelector('.tv-feedback').classList.contains('feedback-flash'))
    assert.notEqual(container.querySelector('.tv-feedback'), previousOutput)
    assert.equal(container.querySelector('.tv-static'), null)
    assert.equal(container.querySelector('.tv-feedback').dataset.outcome, index === 0 ? 'incorrect' : 'correct')
    assert.equal(container.querySelector('.tv-score strong').textContent, String(index * 10))
    assert.equal(container.querySelector('.tv-score').hidden, false)
    assert.equal(container.querySelector('.tv-score').getAttribute('aria-hidden'), null)
    assert.equal(container.querySelectorAll('.tv-feedback-region[role="status"]').length, 1)
    assert.equal(container.querySelector('.mission-counter[role="status"]').textContent, `${index + 1} / 30 ITEMS`)
    assert.equal(container.querySelector('.feedback'), null)
  }
})

test('dataset counts mirror the backend split and exclude lava items', () => {
  const actions = count => Array.from({ length: count }, (_, index) => ({ outcome: 'sorted', chosen_class: index % 3 }))
  assert.deepEqual(datasetSplitCounts(actions(30)), { train: 20, validation: 5, test: 5 })
  assert.deepEqual(datasetSplitCounts([...actions(27), { outcome: 'missed', chosen_class: null }]), { train: 19, validation: 4, test: 4 })
  assert.deepEqual(datasetSplitCounts(actions(3)), { train: 3, validation: 0, test: 0 })
  assert.deepEqual(datasetSplitCounts([]), { train: 0, validation: 0, test: 0 })
})

test('stage navigation stays in board controls across sorting, training and exploration', async () => {
  const completed = structuredClone(game)
  completed.summary.resolved = 30
  completed.summary.missed = 1
  completed.training.status = 'done'
  completed.training.results = { split: { train: 3, validation: 0, test: 0 }, predictions: [], before_accuracy: .3, test_accuracy: .7, best_epoch: 1 }
  completed.actions = [
    { index: 0, outcome: 'sorted', chosen_class: 2, expected_class: 0 },
    { index: 1, outcome: 'missed', chosen_class: null },
    { index: 2, outcome: 'sorted', chosen_class: 1 },
    { index: 3, outcome: 'sorted', chosen_class: 0 },
  ]
  globalThis.fetch = async () => ({ ok: true, json: async () => structuredClone(completed) })
  await mount(App)
  await click(button('START'))
  assert.equal(container.querySelector('.app-header'), null)
  const navigation = container.querySelector('.board-controls .stage-nav')
  assert.ok(navigation)
  assert.equal(navigation.querySelector('.stage-ready'), button('2 · Train'))
  await click(button('2 · Train'))
  const controls = container.querySelector('.training-controls')
  assert.equal(controls.querySelector('button').textContent, 'Train again')
  assert.match(controls.querySelector('.status').textContent, /Practice complete/)
  assert.equal(/misses excluded|Split before augmentation|Train \d+ · Val \d+ · Test \d+|DONE/.test(controls.textContent), false)
  assert.equal(container.querySelector('.lab-panel .section-heading h2'), null)
  const round = container.querySelector('.training-round-card')
  assert.ok(round)
  assert.equal(round.getAttribute('data-epoch'), '0', 'Do not invent completed epochs when history is absent')
  assert.match(round.textContent, /3 training examples/)
  assert.match(round.textContent, /Missed items have no label/)
  assert.equal(container.querySelector('animate, animateTransform'), null, 'The lesson does not run an unrelated progress clock')
  const dataset = container.querySelector('.dataset-summary')
  assert.ok(dataset.textContent.includes('1 misses lost to lava'))
  assert.deepEqual([...dataset.querySelectorAll('dt')].map(text => text.textContent), ['TRAIN: 3', 'VALIDATE: 0', 'TEST: 0'])
  for (const phrase of ['homework', 'practice quiz', 'final exam']) assert.ok(dataset.textContent.includes(phrase))
  assert.equal(container.querySelectorAll('.training-reading-guide .training-help').length, 4)
  assert.equal(navigation.closest('[hidden]'), null)
  assert.equal(button('2 · Train').getAttribute('aria-current'), 'step')
  assert.equal(navigation.querySelector('.stage-ready'), button('3 · Test'))
  await click(button('3 · Test'))
  assert.equal(container.querySelector('.lab-panel .section-heading h2').textContent, 'Test your robot')
  assert.ok(container.querySelector('.lab-panel .section-heading .heading-robot-layer'))
  assert.equal(navigation.closest('[hidden]'), null)
  assert.equal(button('3 · Test').getAttribute('aria-current'), 'step')
  assert.equal(navigation.querySelector('.stage-ready'), null)
  await click(button('1 · Sort'))
  assert.equal(container.querySelector('.belt-speed-control').closest('[hidden]'), null)
  assert.equal(button('1 · Sort').getAttribute('aria-current'), 'step')
  assert.equal(navigation.querySelector('.stage-ready'), button('2 · Train'))
})

test('START opens the conveyor instructions and only its start button moves the belt', async () => {
  globalThis.fetch = async () => ({ ok: true, json: async () => structuredClone(game) })
  await mount(App)
  await click(button('START'))
  assert.ok(container.querySelector('.tv-static'))
  assert.equal(container.querySelector('.tv-score strong').textContent, '0')
  assert.equal(container.querySelector('.tv-score').hidden, true)
  assert.equal(container.querySelector('.mission-strip'), null)
  assert.equal(container.querySelector('.stage-ready'), null)
  assert.equal(container.querySelector('.belt-start-hint').textContent, 'LEARNING BREAK')
  assert.equal(container.querySelector('.belt-start-hint').getAttribute('x'), '848')
  assert.equal(container.querySelector('.belt-start-hint').getAttribute('y'), '185')
  assert.equal(container.textContent.includes('READY WHEN YOU ARE'), false)
  assert.equal(container.textContent.includes('items left to help the robot'), false)
  assert.equal(container.querySelector('.tv-feedback p'), null)
  assert.equal(container.querySelector('.feedback'), null)
  assert.ok(container.querySelector('[aria-label="Conveyor sorting game"]'))
  assert.match(container.querySelector('[role="dialog"]').textContent, /Your bin choice becomes its label/)
  assert.equal(container.querySelector('[aria-label="Increase belt speed"]').getAttribute('aria-disabled'), 'true')
  assert.equal(frames.size, 0)
  await startOrIncrease()
  assert.equal(frames.size, 1)
  assert.equal(container.querySelector('.tv-score').hidden, true)
  await click(button('Main menu'))
  assert.equal(frames.size, 0)
  await click(button('Resume mission'))
  assert.equal(container.querySelector('[role="dialog"]'), null)
  assert.equal(container.querySelector('[aria-label="Increase belt speed"]').getAttribute('aria-disabled'), 'false')
  assert.equal(frames.size, 1, 'Resuming does not repeat the instructions or reset the belt')
})

test('three consecutive misses pause for learning help and resume at speed 1 without extra misses', async () => {
  const actions = []
  await mount(Conveyor, { game, paused: false, onResolve: (...args) => actions.push(args), saving: 0 })
  assert.ok(container.querySelector('[role="dialog"]'))
  assert.equal(frames.size, 0)
  await click(button('Start sorting at speed 2'))
  await drive(64)
  assert.equal(actions.length, 2)
  assert.equal(container.querySelector('[role="dialog"]'), null)
  await drive(14)
  assert.equal(actions.length, 3)
  assert.ok(actions.every(action => action[1] === 'missed' && action[2] === null && action[3] === 'NORMAL'))
  const prompt = container.querySelector('[role="dialog"]')
  assert.match(prompt.textContent, /Three items/)
  assert.match(prompt.textContent, /no labels/)
  assert.match(prompt.textContent, /fewer examples/)
  assert.equal(container.querySelector('.belt-speed-control [role="img"]').getAttribute('aria-label'), 'Belt speed 1 of 3')
  assert.equal(container.querySelectorAll('.lava-spark').length, 14)
  const actorPositions = () => [...container.querySelectorAll('.conveyor-svg > g[aria-label^="Select"]')].map(item => item.getAttribute('transform'))
  const frozen = actorPositions()
  await drive(30)
  assert.equal(actions.length, 3, 'Reading the prompt must not lose more items')
  assert.deepEqual(actorPositions(), frozen)
  assert.equal(container.querySelectorAll('.lava-spark').length, 0, 'The splash finishes while the belt is paused')
  assert.equal(frames.size, 0)
  await click(button('Continue at speed 1'))
  assert.equal(container.querySelector('[role="dialog"]'), null)
  await drive(30)
  assert.equal(actions.length, 4)
  assert.equal(actions.at(-1)[3], 'SLOW', 'Saved actions reflect the reduced speed')
  assert.equal(new Set(actions.map(action => action[0].index)).size, actions.length)
})

test('the slowdown appears once per round even after increasing speed, and resets for a new round', async () => {
  const actions = []
  const props = { game, paused: false, onResolve: (...args) => actions.push(args), saving: 0 }
  await mount(Conveyor, props)
  await click(button('Start sorting at speed 2'))
  await drive(78)
  assert.equal(actions.length, 3)
  await click(button('Continue at speed 1'))
  await click(container.querySelector('[aria-label="Increase belt speed"]'))
  await click(container.querySelector('[aria-label="Increase belt speed"]'))
  await drive(80)
  assert.equal(container.querySelector('[role="dialog"]'), null, 'Later consecutive misses must not repeat the warning')
  assert.equal(container.querySelector('.belt-speed-control [role="img"]').getAttribute('aria-label'), 'Belt speed 3 of 3')
  assert.ok(actions.length >= 6, 'Items continue falling after the first warning')
  assert.ok(actions.slice(3).every(action => action[1] === 'missed' && action[2] === null && action[3] === 'FAST'), 'Later misses still record the selected speed')
  const nextGame = { ...game, id: '22222222-2222-4222-8222-222222222222' }
  await React.act(async () => root.render(React.createElement(React.StrictMode, null,
    React.createElement(Conveyor, { ...props, key: nextGame.id, game: nextGame }))))
  await click(button('Start sorting at speed 2'))
  await drive(78)
  assert.ok(button('Continue at speed 1'), 'A new round gets its own slowdown warning')
})

test('a bin drop resets the consecutive miss counter and lava stays visible after guidance hides', async () => {
  const actions = []
  await mount(Conveyor, { game, paused: false, onResolve: (...args) => actions.push(args), saving: 0 })
  const pool = container.querySelector('.lava-pool rect[stroke]')
  assert.ok(Number(pool.getAttribute('width')) > 260)
  assert.ok(Number(pool.getAttribute('height')) > 52)
  assert.ok(container.querySelector('.lava-ember'))
  await click(button('Start sorting at speed 2'))
  await drive(64)
  assert.equal(actions.length, 2)
  await React.act(async () => container.querySelector('[aria-label="Select Item 2"]').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  await click(button('Recycling'))
  assert.equal(actions[2][1], 'sorted')
  await drive(30)
  assert.equal(actions.filter(action => action[1] === 'missed').length, 3)
  assert.equal(container.querySelector('[role="dialog"]'), null, 'One miss after a successful drop does not slow the game')
  await drive(15)
  assert.equal(container.querySelector('[role="dialog"]'), null)
  await drive(15)
  assert.ok(button('Continue at speed 1'))
  assert.ok(container.querySelector('.lava-pool'))
})

test('the final missed item does not block mission completion behind a slowdown prompt', async () => {
  const actions = []
  const almostDone = { ...game, actions: game.items.slice(0, 27).map(item => ({ index: item.index, outcome: 'sorted', chosen_class: 0 })),
    summary: { ...game.summary, resolved: 27, correct: 27, score: 270 } }
  const props = { game: almostDone, paused: false, onResolve: (...args) => actions.push(args), saving: 0 }
  await mount(Conveyor, props)
  await click(button('Start sorting at speed 2'))
  await drive(90)
  assert.equal(actions.length, 3)
  assert.equal(container.querySelector('[role="dialog"]'), null)
  const done = { ...almostDone, summary: { ...almostDone.summary, resolved: 30, missed: 3 } }
  await React.act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(Conveyor, { ...props, game: done }))))
  await drive(60)
  assert.ok(container.querySelector('.belt-mission-actions.delivered'))
  assert.equal(button('Phase 2 * TRAIN').disabled, false)
  assert.equal(actions.length, 3)
})

function detectiveGame() {
  const prediction = name => ({
    name, image, label: 'Compost', guideline: 'Recycling', before: [.2, .5, .3], probabilities: [.8, .15, .05],
    inspection: { input_image: image, rgb: [80, 120, 200], normalized: [-.373, -.059, .569],
      layers: Array.from({ length: 4 }, (_, index) => ({ name: `Block ${index + 1}`, shape: [16, 32, 32],
        maps: [{ channel: index * 2, image }, { channel: index * 2 + 1, image }] })) },
    viz: { edges: [], layers: Array.from({ length: 6 }, (_, i) => ({ labels: i === 5 ? ['Recycling', 'Compost', 'Landfill'] : ['F1'], level: i === 5 ? [.8, .15, .05] : [.5], raw: i === 5 ? [.8, .15, .05] : [.5] })) },
  })
  return { ...game, summary: { ...game.summary, resolved: 30 }, training: { ...game.training, status: 'done', run_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    results: { predictions: [prediction('Test can'), prediction('Test carton')] } } }
}

test('activity instructions appear once per mission step, reopen on demand, and preserve answers on return', async () => {
  const completed = detectiveGame(), topics = [], events = []
  await mount(RobotDetective, { game: completed, track: topic => topics.push(topic), onActivity: event => events.push(event) }, false)
  const popup = () => document.querySelector('.detective-instructions-dialog')
  assert.match(popup().textContent, /Look through robot eyes/)
  assert.equal(popup().querySelectorAll('li').length, 3)
  assert.equal(document.activeElement, popup().querySelector('button'))
  assert.equal(popup().getAttribute('aria-modal'), 'true')
  await React.act(async () => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  assert.equal(popup(), null)
  await click(button('Numbers for pixel colors'), false)
  await click(button('Next: follow the decision →'), false)
  assert.match(popup().textContent, /Follow the decision/)
  await dismissActivityInstructions()
  await click(button('Compost'), false)
  await click(button('← Back'), false)
  assert.equal(popup(), null, 'Going back should not repeat instructions')
  assert.equal(button('Numbers for pixel colors').getAttribute('aria-pressed'), 'true')
  const reopen = button('How to play')
  reopen.focus()
  await click(reopen, false)
  assert.ok(popup())
  assert.deepEqual(topics, ['pixels'], 'Only a manual help opening adds a topic event')
  await dismissActivityInstructions()
  assert.equal(document.activeElement, reopen)
  await click(button('Next: follow the decision →'), false)
  assert.equal(popup(), null)
  assert.equal(button('Compost').getAttribute('aria-pressed'), 'true')
  await click(button('Next: test the robot →'), false)
  assert.match(popup().textContent, /Test the robot/)
  await dismissActivityInstructions()
  assert.equal(events.length, 2, 'Instruction dialogs must not submit answers or award points')
  assert.deepEqual(JSON.parse(window.sessionStorage.getItem(`waiste-detective-instructions-${completed.id}`)), [0, 1, 2])
  await React.act(async () => root.unmount())
  root = null; container.remove()
  await mount(RobotDetective, { game: completed }, false)
  assert.equal(popup(), null, 'The same mission should remember instructions across remounts')
  await click(container.querySelectorAll('.detective-steps button')[2], false)
  assert.equal(popup(), null)
  await React.act(async () => root.unmount())
  root = null; container.remove()
  await mount(RobotDetective, { game: { ...completed, id: 'new-mission' } }, false)
  assert.ok(popup(), 'A new mission receives its own introduction')
})

test('Robot Detective presents one task at a time and preserves the image and views when going back', async () => {
  const completed = detectiveGame()
  await mount(RobotDetective, { game: completed })
  assert.equal(container.querySelector('.detective-heading h2').textContent, 'Test your robot')
  assert.equal(container.querySelector('.detective-task [role="status"]').textContent, 'Step 1 of 3')
  assert.equal(button('← Back').disabled, true)
  assert.equal(button('Original').getAttribute('aria-pressed'), 'true')
  assert.equal(button('Recycling').closest('[hidden]') !== null, true)
  assert.ok(button('← Back').closest('.detective-main'), 'Activity navigation belongs to the middle panel')
  await click(button('Filters'))
  await click(button('Block 3'))
  assert.ok(container.querySelector('[alt="Block 3 channel 4 response for Test can"]'))
  await click(button('Pixels'))
  assert.match(container.querySelector('.detective-pixels').textContent, /80, 120, 200/)
  assert.match(container.querySelector('.detective-pixels').textContent, /-0.373, -0.059, 0.569/)
  await click(button('Original'))
  assert.ok(container.querySelector('[alt="Original test image: Test can"]'))
  const select = container.querySelector('.detective-evidence select')
  await React.act(async () => { select.value = '1'; select.dispatchEvent(new window.Event('change', { bubbles: true })) })
  assert.equal(container.querySelector('.detective-item-image').alt, 'Test carton')
  await click(button('Pixels'))
  await click(button('Next: follow the decision →'))
  assert.equal(container.querySelector('.detective-task [role="status"]').textContent, 'Step 2 of 3')
  assert.equal(button('Recycling').closest('[hidden]'), null)
  await click(button('Recycling'))
  const after = container.querySelector('[aria-label="After training scores"]')
  assert.deepEqual([...after.querySelectorAll('meter')].map(meter => meter.value), [.8, .15, .05])
  assert.match(container.querySelector('.detective-pick').textContent, /Recycling.*80.0%/)
  await click(button('Compare before & after'))
  assert.deepEqual([...container.querySelectorAll('[aria-label="Before training scores"] meter')].map(meter => meter.value), [.2, .5, .3])
  assert.match(container.querySelector('.detective-notes').textContent, /Your labelCompost/)
  assert.match(container.querySelector('.detective-notes').textContent, /Common guidelineRecycling/)
  await click(button('← Back'))
  assert.equal(button('Pixels').getAttribute('aria-pressed'), 'true')
  assert.equal(container.querySelector('.detective-item-image').alt, 'Test carton')
  await click(button('Next: follow the decision →'))
  assert.ok(button('Show after only'), 'Returning preserves the revealed comparison')
})

test('Robot Detective tests new images through the API, recovers from errors, and explains missing categories', async () => {
  const completed = detectiveGame(), calls = []
  let fail = true
  globalThis.fetch = async (url, init) => {
    calls.push([url, init.method])
    if (fail) throw new Error('Connection interrupted')
    const novel = url.endsWith('novel=true')
    return { ok: true, json: async () => ({ ...completed.training.results.predictions[0], name: novel ? 'Battery' : 'New can',
      prediction_id: novel ? 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' : 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      training_run_id: completed.training.run_id,
      has_valid_bin: !novel, destination: novel ? 'Special collection' : 'Recycling' }) }
  }
  await mount(RobotDetective, { game: completed })
  await click(container.querySelectorAll('.detective-steps button')[2])
  await click(container.querySelectorAll('.detective-test-buttons button')[1])
  assert.match(container.querySelector('[role="alert"]').textContent, /Connection interrupted/)
  assert.ok([...container.querySelectorAll('.detective-test-buttons button')].every(button => !button.disabled))
  fail = false
  await click(container.querySelectorAll('.detective-test-buttons button')[1])
  assert.equal(container.querySelector('[role="alert"]'), null)
  assert.equal(container.querySelector('.detective-item-image').alt, 'Battery')
  assert.equal(container.querySelector('.detective-test-result'), null, 'Answer before the robot and destination are revealed')
  await click(button('Somewhere else / special disposal'))
  assert.match(container.querySelector('.detective-test-result').textContent, /Special collection/)
  assert.match(container.querySelector('.detective-caution').textContent, /None of the robot’s three bins is suitable/)
  assert.deepEqual([...container.querySelectorAll('.detective-test-result meter')].map(meter => meter.value), [.8, .15, .05])
  await click(container.querySelectorAll('.detective-test-buttons button')[0])
  assert.equal(container.querySelector('.detective-item-image').alt, 'New can')
  assert.equal(container.querySelector('.detective-caution'), null)
  assert.ok(calls.every(([url, method]) => url.startsWith(`/api/sessions/${game.id}/try-item?novel=`) && method === 'POST'))
  assert.ok(calls.at(-1)[0].endsWith('novel=false'))
  await click(button('Close the case'))
  assert.match(document.querySelector('.detective-case-dialog').textContent, /Training adjusted weights/)
  await click([...document.querySelectorAll('.detective-case-dialog button')].find(button => button.textContent === 'Keep exploring'))
  assert.equal(document.querySelector('.detective-case-dialog'), null)
  assert.equal(container.querySelector('.detective-task [role="status"]').textContent, 'Step 3 of 3')
})

test('definition bubbles save each opening through the session help API and closing adds no event', async () => {
  const events = [], completed = detectiveGame()
  globalThis.fetch = async (url, init) => {
    if (url === '/api/sessions') return { ok: true, json: async () => structuredClone(completed) }
    assert.equal(url, `/api/sessions/${game.id}/help`)
    events.push(JSON.parse(init.body))
    return { ok: true, json: async () => ({ saved: true }) }
  }
  await mount(App)
  await click(button('START'))
  await click(button('2 · Train'))
  const trigger = container.querySelector('[aria-label="What do accuracy and loss mean?"]')
  await click(trigger)
  assert.equal(document.querySelectorAll('.definition-popup').length, 1)
  assert.deepEqual(events.map(event => event.topic), ['accuracy'])
  await click(document.querySelector('.definition-close'))
  assert.equal(document.querySelector('.definition-popup'), null)
  assert.equal(events.length, 1)
  await click(trigger)
  assert.deepEqual(events.map(event => event.topic), ['accuracy', 'accuracy'])
  assert.equal(new Set(events.map(event => event.event_id)).size, 2, 'Reopening is a new interaction; retry IDs stay separate')
  await React.act(async () => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  assert.equal(document.querySelector('.definition-popup'), null)
  assert.equal(events.length, 2)
})

test('detective answers record first choices, compare without grading robot agreement, and cap participation points', async () => {
  const completed = detectiveGame(), events = []
  globalThis.fetch = async () => ({ ok: true, json: async () => ({
    ...completed.training.results.predictions[0], name: 'Battery', has_valid_bin: false, destination: 'Special collection',
    prediction_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', training_run_id: completed.training.run_id,
  }) })
  await mount(RobotDetective, { game: completed, onActivity: event => events.push(event) })
  await click(button('The item’s name'))
  assert.match(container.querySelector('.detective-answer-feedback').textContent, /not the item’s name/)
  assert.match(container.querySelector('.detective-progress').textContent, /10 \/ 30/)
  assert.ok(button('Numbers for pixel colors').disabled, 'First answer remains recorded')
  const select = container.querySelector('.detective-evidence select')
  await React.act(async () => { select.value = '1'; select.dispatchEvent(new window.Event('change', { bubbles: true })) })
  await click(button('Numbers for pixel colors'))
  assert.match(container.querySelector('.detective-progress').textContent, /10 \/ 30/, 'Changing items cannot farm points')
  await click(button('Next: follow the decision →'))
  await click(button('Compost'))
  assert.match(container.querySelector('[aria-label="Which bin will the robot choose?"]').textContent, /You predicted Compost; the robot chose Recycling/)
  assert.match(container.querySelector('.detective-progress').textContent, /20 \/ 30/, 'Different predictions still earn participation credit')
  await click(button('Next: test the robot →'))
  await click(container.querySelectorAll('.detective-test-buttons button')[1])
  await click(button('Somewhere else / special disposal'))
  assert.match(container.querySelector('.detective-progress').textContent, /30 \/ 30/)
  assert.deepEqual(events.map(event => [event.question, event.answer]), [
    ['robot_input', 'item_name'], ['robot_input', 'pixel_values'], ['predict_bin', 'Compost'], ['test_destination', 'outside_bins'],
  ])
  assert.equal(events.at(-1).prediction_id, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd')
  assert.ok(events.every(event => event.training_run_id === completed.training.run_id))
  await click(button('← Back'))
  assert.equal(button('Compost').getAttribute('aria-pressed'), 'true')
  await click(button('← Back'))
  assert.equal(button('Numbers for pixel colors').getAttribute('aria-pressed'), 'true')
})

test('App queues detective answers and closing the case returns to the menu without resetting the mission', async () => {
  const completed = detectiveGame(), events = []
  completed.detective_answers = [{ question: 'robot_input', answer: 'pixel_values', item_index: 0,
    training_run_id: completed.training.run_id, event_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }]
  globalThis.fetch = async (url, init) => {
    if (url === '/api/sessions') return { ok: true, json: async () => structuredClone(completed) }
    assert.equal(url, `/api/sessions/${game.id}/activity`)
    events.push(JSON.parse(init.body))
    return { ok: true, json: async () => ({ saved: true }) }
  }
  await mount(App)
  await click(button('START'))
  await click(button('3 · Test'))
  assert.equal(button('Numbers for pixel colors').getAttribute('aria-pressed'), 'true')
  assert.match(container.querySelector('.detective-progress').textContent, /10 \/ 30/)
  await click(button('Next: follow the decision →'))
  await click(container.querySelector('[aria-label="Which bin will the robot choose?"] button'))
  assert.equal(events.length, 1)
  assert.equal(events[0].kind, 'detective_answer')
  assert.equal(events[0].training_run_id, completed.training.run_id)
  assert.match(events[0].event_id, /^[0-9a-f-]{36}$/)
  await click(button('Next: test the robot →'))
  const close = button('Close the case')
  close.focus()
  await click(close)
  const modalButtons = () => [...document.querySelectorAll('.detective-case-dialog button')]
  assert.equal(document.activeElement, modalButtons()[0])
  await React.act(async () => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })))
  assert.equal(document.activeElement, modalButtons()[1])
  await React.act(async () => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  assert.equal(document.querySelector('.detective-case-dialog'), null)
  assert.equal(document.activeElement, close)
  await click(close)
  await click(modalButtons()[1])
  assert.ok(container.querySelector('.title-screen'))
  assert.equal(document.querySelector('.detective-case-dialog'), null)
  await click(button('Resume mission'))
  assert.equal(container.querySelector('.detective-task [role="status"]').textContent, 'Step 3 of 3')
  await click(button('2 · Train'))
  await click(button('3 · Test'))
  assert.match(container.querySelector('.detective-progress').textContent, /20 \/ 30/, 'Answers survive leaving and returning to the stage')
  await click(button('Next: follow the decision →'))
  assert.equal(container.querySelector('[aria-label="Which bin will the robot choose?"] button').getAttribute('aria-pressed'), 'true')
  assert.equal(events.length, 1, 'Navigation must not record another answer')
})

test('optional help records topic openings and the demonstration sliders do not change real CNN scores', async () => {
  const topics = [], completed = detectiveGame()
  await mount(RobotDetective, { game: completed, track: topic => topics.push(topic) })
  const openHelp = async title => {
    const definition = [...container.querySelectorAll('.definition-trigger')].find(trigger => trigger.getAttribute('aria-label') === title)
    if (definition) {
      await click(definition)
      const popup = document.querySelector('.definition-popup')
      assert.equal(popup.getAttribute('role'), 'dialog')
      return popup
    }
    const details = [...container.querySelectorAll('details')].find(details => details.querySelector('summary').textContent === title)
    await React.act(async () => { details.open = true; await new Promise(resolve => setTimeout(resolve, 0)) })
    return details
  }
  await click(button('Filters'))
  await openHelp('What do these pictures mean?')
  await openHelp('Tell me more about pixels')
  await openHelp('Optional lab: experiment with weights')
  assert.deepEqual(topics, ['filters', 'pixels', 'weights'])
  await openHelp('Try this + extra help')
  assert.deepEqual(topics, ['filters', 'pixels', 'weights', 'weights'], 'Nested help records its own opening once')
  const experiment = container.querySelector('.detective-weight')
  const before = [...experiment.querySelectorAll('meter')].map(meter => meter.value)
  const slider = experiment.querySelectorAll('input')[1]
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(slider, '3')
    slider.dispatchEvent(new window.Event('input', { bubbles: true }))
  })
  assert.notDeepEqual([...experiment.querySelectorAll('meter')].map(meter => meter.value), before)
  assert.deepEqual(completed.training.results.predictions[0].probabilities, [.8, .15, .05])
  await click(button('Next: follow the decision →'))
  await openHelp('Open the real CNN diagram')
  assert.equal(topics.at(-1), 'weights')
  assert.ok(container.querySelector('.network-figure svg'))
  await click(button('Recycling'))
  assert.deepEqual([...container.querySelectorAll('[aria-label="After training scores"] meter')].map(meter => meter.value), [.8, .15, .05])
})

test('learning-rate analytics record settled choices once and flush when leaving training', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const completed = detectiveGame(), rates = []
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/learning-rate')) rates.push(JSON.parse(init.body))
    return { ok: true, json: async () => url === '/api/sessions' ? structuredClone(completed) : { saved: true } }
  }
  await mount(App)
  await click(button('START'))
  await click(button('2 · Train'))
  const slider = container.querySelector('.training-controls input[type="range"]')
  const change = async value => React.act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(slider, value)
    slider.dispatchEvent(new window.Event('input', { bubbles: true }))
  })
  await change('-2.5')
  await React.act(async () => context.mock.timers.tick(500))
  await change('-2')
  await React.act(async () => context.mock.timers.tick(699))
  assert.equal(rates.length, 0, 'Dragging the slider must not flood the database')
  await React.act(async () => context.mock.timers.tick(1))
  assert.deepEqual(rates.map(event => event.exponent), [-2])
  await change('-1.5')
  await click(button('3 · Test'))
  assert.deepEqual(rates.map(event => event.exponent), [-2, -1.5])
  await React.act(async () => context.mock.timers.tick(1000))
  assert.equal(rates.length, 2, 'Leaving training flushes the last choice without duplicating it')
  assert.equal(new Set(rates.map(event => event.event_id)).size, 2)
})

test('guided training starts with three rounds and unlocks the next step only after completion', async () => {
  const requests = [], topics = []
  let nextClicks = 0, backClicks = 0
  globalThis.fetch = async (url, init) => {
    requests.push({ url, body: JSON.parse(init.body) })
    return { ok: true, json: async () => ({}) }
  }
  const props = { game, view: 'train', setGame: () => {}, saving: false, track: topic => topics.push(topic),
    onNext: () => nextClicks++, onBack: () => backClicks++ }
  await mount(LearningLab, props)
  assert.equal(container.querySelector('.lab-mission-intro h2').textContent, 'Teach your robot')
  const next = () => button('Next: test your robot →')
  assert.equal(next().disabled, true)
  await click(next())
  assert.equal(nextClicks, 0)
  await click(button('Train your robot'))
  assert.deepEqual(requests, [{ url: `/api/sessions/${game.id}/train`, body: { epochs: 3, learning_rate: .001, training_mode: 'classroom' } }])

  const running = { ...game, training: { ...game.training, status: 'running', epochs: 3 } }
  await React.act(async () => root.render(React.createElement(LearningLab, { ...props, game: running })))
  assert.equal(next().disabled, true)
  assert.equal(button('Robot is learning…').disabled, true)

  const completed = detectiveGame()
  completed.training.results = { ...completed.training.results, before_accuracy: .3, test_accuracy: .7, best_epoch: 1 }
  completed.training.history = [{ epoch: 1, train_loss: .8, val_loss: .9, train_acc: .7, val_acc: .6 }]
  await React.act(async () => root.render(React.createElement(LearningLab, { ...props, game: completed })))
  assert.equal(next().disabled, false)
  await click(next())
  assert.equal(nextClicks, 1)
  await click(button('← Back: sorting'))
  assert.equal(backClicks, 1)
  assert.equal(container.querySelectorAll('.curve').length, 2)
  for (const curve of container.querySelectorAll('.curve')) {
    assert.equal(curve.querySelectorAll('polyline')[1].getAttribute('stroke-dasharray'), '8 5')
    assert.match(curve.querySelector('svg').getAttribute('aria-label'), /cyan solid line.*gold dashed line/)
  }
  const deeper = container.querySelector('.training-deeper')
  assert.equal(deeper.open, false, 'The full network is available without filling the initial training screen')
  await React.act(async () => { deeper.open = true; await new Promise(resolve => setTimeout(resolve, 0)) })
  assert.ok(deeper.querySelector('.network-figure'))
  assert.deepEqual(topics, ['weights'])
})
