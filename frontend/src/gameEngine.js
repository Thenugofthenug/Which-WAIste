export const BINS = ['Recycling', 'Compost', 'Landfill']
export const COLORS = ['#29adff', '#00e436', '#c2c3c7']
export const SPEEDS = { SLOW: 2.2 / .03, NORMAL: 3.6 / .03, FAST: 5 / .03 }
export const EXIT_Y = 486

export function datasetSplitCounts(actions) {
  const labels = actions.filter(action => action.outcome === 'sorted').map(action => action.chosen_class)
  const classes = new Set(labels).size
  // Match the backend: reserve one training item per class, then allocate
  // validation/test slots from the remaining items, using Python's tie-to-even rounding.
  const fraction = labels.length / 6
  const rounded = fraction % 1 === .5 ? Math.round(fraction / 2) * 2 : Math.round(fraction)
  const target = Math.max(1, rounded)
  const counts = { train: classes, validation: 0, test: 0 }
  for (let index = 0; index < labels.length - classes; index++) {
    if (index % 4 === 1 && counts.validation < target) counts.validation++
    else if (index % 4 === 3 && counts.test < target) counts.test++
    else counts.train++
  }
  return counts
}

export function missionReportHeading(summary) {
  return summary.correct === 30 ? 'Perfect sorting!' : 'Ready to teach your robot?'
}

// A small external store keeps the animation clock separate from React rendering.
export function createWorld(actors) {
  const state = { actors, burnt: [], drag: null, treads: 0 }
  let snapshot = { ...state }
  const listeners = new Set()
  return {
    read: () => state,
    getSnapshot: () => snapshot,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) },
    publish: () => { snapshot = { ...state }; listeners.forEach(listener => listener()) },
  }
}

export function initialActors(items, actions) {
  const resolved = new Set(actions.map(action => action.index))
  return items.filter(item => !resolved.has(item.index)).map((item, i) => ({
    ...item, y: -64 - i * 180, responseMs: 0,
  }))
}

export function advanceActors(actors, seconds, speed) {
  const moving = actors.map(actor => ({ ...actor, y: actor.y + SPEEDS[speed] * seconds,
    responseMs: actor.responseMs + (actor.y >= -64 ? seconds * 1000 : 0) }))
  return { actors: moving.filter(actor => actor.y < EXIT_Y), missed: moving.filter(actor => actor.y >= EXIT_Y) }
}

export function binAt(x, y, offset = 0) {
  y -= offset
  if (y < 523 || y > 758) return null
  return [280, 640, 1000].findIndex(center => Math.abs(x - center) <= 160) === -1 ? null :
    [280, 640, 1000].findIndex(center => Math.abs(x - center) <= 160)
}
