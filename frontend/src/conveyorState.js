// Timed challenge: passing the camera never stops the belt automatically.
export function advanceBelt(position, amount, count) {
  if (position.index >= count) return position
  const progress = position.progress + amount
  return progress >= 100 ? { index: position.index + 1, progress: 0 } : { ...position, progress }
}

export function canCatch(progress) {
  return progress >= 27 && progress <= 43
}
