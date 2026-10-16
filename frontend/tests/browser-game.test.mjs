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

test('digital speed control starts at 0, starts the belt at 1 and pauses it at 0', async () => {
  const actions = []
  const props = { game, paused: false, onResolve: (...args) => actions.push(args), help: () => {}, saving: 0 }
  await mount(Conveyor, props)
  const up = () => container.querySelector('[aria-label="Increase belt speed"]')
  const down = () => container.querySelector('[aria-label="Decrease belt speed"]')
  const display = () => container.querySelector('.belt-speed-control [role="img"]').getAttribute('aria-label')
  assert.equal(container.querySelector('select'), null)
  assert.equal([...container.querySelectorAll('button')].some(button => /Start belt|Pause belt/.test(button.textContent)), false)
  assert.equal(display(), 'Belt speed 0 of 3')
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
  assert.equal(display(), 'Belt speed 0 of 3')
  await click(up())
  assert.equal(display(), 'Belt speed 1 of 3')
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

test('SVG guidance disappears five seconds after starting while item and bin labels remain', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const props = { game, paused: false, onResolve: () => {}, help: () => {}, saving: 0 }
  await mount(Conveyor, props)
  const svg = () => container.querySelector('.conveyor-svg')
  await React.act(async () => context.mock.timers.tick(6000))
  assert.ok(svg().querySelector('.lava-arrow'))
  assert.equal(svg().querySelector('.robot-hover-lines'), null)
  await click(container.querySelector('[aria-label="Increase belt speed"]'))
  assert.ok(svg().querySelector('.robot-floating'))
  assert.ok(svg().querySelector('.robot-hover-lines'))
  await React.act(async () => context.mock.timers.tick(4999))
  assert.match(svg().textContent, /RE-CYCLER, NEW HIRE/)
  assert.ok(svg().querySelector('.lava-arrow'))
  await React.act(async () => context.mock.timers.tick(1))
  assert.equal(svg().querySelector('.lava-arrow'), null)
  assert.deepEqual([...svg().querySelectorAll('text')].map(text => text.textContent), ['BELT SPEED', 'ITEMS: 0', 'RECYCLING', 'ITEMS: 0', 'COMPOST', 'ITEMS: 0', 'LANDFILL', 'Item 0'])
  assert.ok(svg().querySelector('.pixel-robot'))
  assert.ok(svg().querySelector('.robot-floating'))
  assert.ok(svg().querySelector('.robot-pacing'))
  assert.equal(svg().querySelectorAll('.robot-eye').length, 2)
  assert.equal(svg().querySelectorAll('.robot-foot').length, 0)
  const hoverLines = [...svg().querySelectorAll('.robot-hover-line')]
  assert.equal(hoverLines.length, 3)
  assert.equal(svg().querySelector('.robot-hover-lines').getAttribute('stroke'), 'rgb(0, 228, 54)')
  assert.deepEqual(hoverLines.map(line => Number(line.getAttribute('x2')) - Number(line.getAttribute('x1'))), [80, 56, 32])
  await click(container.querySelector('[aria-label="Decrease belt speed"]'))
  assert.ok(container.querySelector('.robot-awake'))
  await click(container.querySelector('[aria-label="Increase belt speed"]'))
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
  await click(container.querySelector('[aria-label="Increase belt speed"]'))
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
  for (const text of ['MISSION COMPLETE!', 'Score: 300', 'Right: 30', 'Missed: 0', 'Best streak: 30', 'Progress saved']) assert.ok(bubble.textContent.includes(text), text)
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
  await click(container.querySelector('[aria-label="Increase belt speed"]'))
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
  await click(container.querySelector('[aria-label="Increase belt speed"]'))
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
  await click(container.querySelector('[aria-label="Increase belt speed"]'))
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
  await click(container.querySelector('[aria-label="Increase belt speed"]'))
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
  await click(container.querySelector('[aria-label="Increase belt speed"]'))
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
  await click(container.querySelector('[aria-label="Increase belt speed"]'))
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
    assert.equal(container.querySelectorAll('[role="status"]').length, 1)
    assert.equal(container.querySelector('.feedback'), null)
  }
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
  assert.equal(navigation.querySelector('.stage-ready'), button('2 · Train'))
  await click(button('2 · Train'))
  assert.equal(navigation.closest('[hidden]'), null)
  assert.equal(button('2 · Train').getAttribute('aria-current'), 'step')
  assert.equal(navigation.querySelector('.stage-ready'), button('3 · Explore'))
  await click(button('3 · Explore'))
  assert.equal(navigation.closest('[hidden]'), null)
  assert.equal(button('3 · Explore').getAttribute('aria-current'), 'step')
  assert.equal(navigation.querySelector('.stage-ready'), null)
  await click(button('1 · Sort'))
  assert.equal(container.querySelector('.belt-speed-control').closest('[hidden]'), null)
  assert.equal(button('1 · Sort').getAttribute('aria-current'), 'step')
  assert.equal(navigation.querySelector('.stage-ready'), button('2 · Train'))
})

test('START opens the conveyor directly and leaves the belt ready to start', async () => {
  globalThis.fetch = async () => ({ ok: true, json: async () => structuredClone(game) })
  await mount(App)
  await click(button('START'))
  assert.ok(container.querySelector('.tv-static'))
  assert.equal(container.querySelector('.tv-score strong').textContent, '0')
  assert.equal(container.querySelector('.tv-score').hidden, true)
  assert.equal(container.querySelector('.mission-strip'), null)
  assert.equal(container.querySelector('.stage-ready'), null)
  assert.equal(container.querySelector('.belt-start-hint').textContent, 'Set BELT SPEED to 1 to start')
  assert.equal(container.querySelector('.belt-start-hint').getAttribute('x'), '848')
  assert.equal(container.querySelector('.belt-start-hint').getAttribute('y'), '185')
  assert.equal(container.textContent.includes('READY WHEN YOU ARE'), false)
  assert.equal(container.textContent.includes('items left to help the robot'), false)
  assert.equal(container.querySelector('.tv-feedback p'), null)
  assert.equal(container.querySelector('.feedback'), null)
  assert.ok(container.querySelector('[aria-label="Conveyor sorting game"]'))
  assert.equal(container.querySelector('[role="dialog"]'), null)
  assert.equal(container.querySelector('[aria-label="Increase belt speed"]').getAttribute('aria-disabled'), 'false')
  assert.equal(frames.size, 0)
  await click(container.querySelector('[aria-label="Increase belt speed"]'))
  assert.equal(frames.size, 1)
  assert.equal(container.querySelector('.tv-score').hidden, true)
  await click(button('Return to start'))
  await click(button('START'))
  assert.equal(container.querySelector('[role="dialog"]'), null)
  assert.equal(container.querySelector('[aria-label="Increase belt speed"]').getAttribute('aria-disabled'), 'false')
  assert.equal(frames.size, 0)
})
