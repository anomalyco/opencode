const pct = (n: number) => `${+n.toFixed(2)}%`

const wave = (base: number, i: number, amp: number) => base + Math.sin(i * 2.399963) * amp

const sideZig = (height: number) => (height <= 100 ? 2 : Math.max(2, Math.ceil(height / 50)))

const topZig = (width: number) => (width <= 100 ? 2 : Math.max(2, Math.ceil(width / 70)))

export function edge(width: number, height: number) {
  const side = sideZig(height)
  const top = topZig(width)
  const pts: [number, number][] = []

  // Insets and wave amplitudes are derived from FIXED PIXELS (converted to the % that clip-path needs),
  // not constant percentages. Otherwise a tall message scales the top/bottom inset up with its height
  // (e.g. 3% of 1500px ≈ 45px) and the torn edge clips real content. Pixel-fixed margins always stay
  // inside the bubble padding, so the deckle look is preserved but nothing is ever cut off.
  const vy = (px: number) => (px / height) * 100
  const hx = (px: number) => (px / width) * 100
  const yTop = vy(4)
  const yBot = 100 - vy(4)
  const xLeft = hx(7)
  const xRight = 100 - hx(7)
  const ay = vy(1.5) // vertical wave amplitude ≈ 1.5px
  const ax = hx(1.5) // horizontal wave amplitude ≈ 1.5px
  const span = yBot - yTop

  pts.push([wave(xLeft, 0, ax), wave(yTop, 1, ay)])

  for (let i = 1; i <= top; i++) {
    const x = xLeft + (i / (top + 1)) * (xRight - xLeft)
    pts.push([wave(x, i + 2, ax), wave(yTop, i + 12, ay)])
  }

  pts.push([wave(xRight, 40, ax), wave(yTop, 41, ay)])

  for (let i = 1; i <= side; i++) {
    const y = yTop + (i / (side + 1)) * span
    const x = i % 2 === 0 ? xRight - hx(3) : xRight + hx(3)
    pts.push([x, wave(y, i + 50, ay)])
  }

  pts.push([wave(xRight, 90, ax), wave(yBot, 91, ay)])

  const bottom = Math.max(2, top - 1)
  for (let i = 1; i <= bottom; i++) {
    const x = xRight - (i / bottom) * (xRight - xLeft)
    pts.push([wave(x, i + 60, ax), wave(yBot, i + 70, ay)])
  }

  for (let i = 1; i <= side; i++) {
    const y = yBot - (i / (side + 1)) * span
    const x = i % 2 === 0 ? xLeft + hx(3) : xLeft - hx(3)
    pts.push([x, wave(y, i + 80, ay)])
  }

  pts.push([wave(xLeft, 120, ax), wave(yTop, 121, ay)])

  return `polygon(${pts.map(([x, y]) => `${pct(x)} ${pct(y)}`).join(", ")})`
}
