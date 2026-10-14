export const BINS = ['Recycling', 'Compost', 'Landfill']
export const COLORS = ['#29adff', '#00e436', '#c2c3c7']
export const SPEEDS = { SLOW: 2.2 / .03, NORMAL: 3.6 / .03, FAST: 5 / .03 }
export const EXIT_Y = 486

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

export function binAt(x, y) {
  if (y < 523 || y > 758) return null
  return [280, 640, 1000].findIndex(center => Math.abs(x - center) <= 160) === -1 ? null :
    [280, 640, 1000].findIndex(center => Math.abs(x - center) <= 160)
}
