// Illustrative one-response model, separate from the real Python CNN.
export function toyScores(signal, weight) {
  const logits = [0.7, signal * weight, 0.5]
  const exponentials = logits.map((value) => Math.exp(value - Math.max(...logits)))
  const sum = exponentials.reduce((a, b) => a + b, 0)
  return exponentials.map((value) => value / sum)
}
