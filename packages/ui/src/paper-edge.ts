const pct = (n: number) => `${+n.toFixed(2)}%`

const wave = (base: number, i: number, amp = 0.75) => base + Math.sin(i * 2.399963) * amp

const sideZig = (height: number) => (height <= 100 ? 2 : Math.max(2, Math.ceil(height / 50)))

const topZig = (width: number) => (width <= 100 ? 2 : Math.max(2, Math.ceil(width / 70)))

export function edge(width: number, height: number) {
  const side = sideZig(height)
  const top = topZig(width)
  const pts: [number, number][] = []

  const yTop = 3
  const yBot = 97.5
  const xLeft = 1.2
  const xRight = 98.8
  const span = yBot - yTop

  pts.push([wave(xLeft, 0), wave(yTop, 1)])

  for (let i = 1; i <= top; i++) {
    const x = xLeft + (i / (top + 1)) * (xRight - xLeft)
    pts.push([wave(x, i + 2), wave(yTop, i + 12)])
  }

  pts.push([wave(xRight, 40), wave(yTop, 41)])

  for (let i = 1; i <= side; i++) {
    const y = yTop + (i / (side + 1)) * span
    const x = i % 2 === 0 ? xRight - 0.4 : xRight + 0.4
    pts.push([x, wave(y, i + 50)])
  }

  pts.push([wave(xRight, 90), wave(yBot, 91)])

  const bottom = Math.max(2, top - 1)
  for (let i = 1; i <= bottom; i++) {
    const x = xRight - (i / bottom) * (xRight - xLeft)
    pts.push([wave(x, i + 60), wave(yBot, i + 70)])
  }

  for (let i = 1; i <= side; i++) {
    const y = yBot - (i / (side + 1)) * span
    const x = i % 2 === 0 ? 1.6 : 0.7
    pts.push([x, wave(y, i + 80)])
  }

  pts.push([wave(xLeft, 120), wave(yTop, 121)])

  return `polygon(${pts.map(([x, y]) => `${pct(x)} ${pct(y)}`).join(", ")})`
}
