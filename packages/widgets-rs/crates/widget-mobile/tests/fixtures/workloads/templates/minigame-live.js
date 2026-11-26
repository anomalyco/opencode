// "Tap the dots", a live game used as a test fixture for the live runtime (not a built-in): dots pop up on a timer and shrink until they vanish; tapping one scores more the
// smaller it is. Taps arrive through the canvas's handler between frames; the loop draws once per display frame.

const HEIGHT = 320
const HUD = 44
const COLORS = ["#f43f5e", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#06b6d4"]
const POP_MS = 420

async function __template_main(data) {
  const seconds = data.seconds ?? 20
  const best = { score: 0 }
  // One round, then its result with Submit and Play again; the buttons' handlers keep the widget open after main.
  const round = async () => {
    const score = await play(data, seconds)
    const record = score > best.score && best.score > 0
    best.score = Math.max(best.score, score)
    widget.render(
      ui.column({ gap: 2 }, [
        ui.text(data.title, { style: "title" }),
        ui.text(score + (score === 1 ? " point" : " points"), { style: "title", tone: "accent" }),
        ui.text(
          "in " + seconds + " seconds" + (record ? " · new best!" : best.score > score ? " · best " + best.score : ""),
          { style: "caption", tone: record ? "success" : "muted" },
        ),
        ui.row({ gap: 1 }, [
          ui.button("Submit score", { variant: "primary", onPress: () => widget.submit({ score, seconds }) }),
          ui.button("Play again", { variant: "secondary", onPress: round }),
        ]),
      ]),
    )
  }
  await round()
}

async function play(data, seconds) {
  const game = { dots: [], pops: [], score: 0, start: 0, spawn: 0, width: 0, height: HEIGHT, begin: null }
  const begun = new Promise((resolve) => (game.begin = resolve))
  // The first tap starts the round; later taps hit dots.
  const onPointer = (pointer) => {
    if (pointer.kind !== "down") return
    if (game.begin) {
      resize(game, pointer)
      game.begin()
      game.begin = null
    } else tap(game, pointer, widget.now())
  }
  widget.render(
    ui.column({ gap: 1, align: "stretch" }, [
      ui.text(data.title, { style: "title" }),
      ui.canvas({ key: "board", height: HEIGHT, alt: "Tap the dots: a game for touch or mouse", onPointer }),
      ui.text("Tap the dots before they vanish. Smaller dots score more.", { style: "caption", tone: "muted" }),
    ]),
  )
  resize(game, await widget.frame())
  widget.draw("board", ready(game, seconds))
  await begun
  game.start = widget.now()
  game.spawn = game.start
  const length = seconds * 1000
  const end = game.start + length
  // The round ends on time even if frames stop coming.
  const over = widget.sleep(length)
  while (true) {
    const frame = await Promise.race([widget.frame(), over])
    const now = widget.now()
    if (now >= end || !frame) break
    resize(game, frame)
    advance(game, now, (now - game.start) / length)
    widget.draw("board", paint(game, now, end - now, length))
  }
  return game.score
}

function resize(game, size) {
  game.width = size.width
  game.height = size.height
}

function ready(game, seconds) {
  const g = ui.draw()
  const cx = game.width / 2
  const cy = game.height / 2
  g.circle(cx - 70, cy - 54, 18, COLORS[0])
    .circle(cx + 64, cy - 40, 11, COLORS[3])
    .circle(cx + 20, cy + 70, 26, COLORS[2])
  g.text(cx, cy + 6, "Tap to start", { size: 24, weight: 700, align: "center" })
  g.text(cx, cy + 30, seconds + " seconds · smaller dots score more", { size: 13, align: "center", color: "muted" })
  return g
}

// Spawns on a timer that speeds up as the round goes on, and drops dots and pops that are over.
function advance(game, now, progress) {
  if (now - game.spawn > 1500) game.spawn = now
  while (game.spawn <= now) {
    if (game.dots.length < 7) game.dots.push(dot(game, game.spawn, progress))
    game.spawn += 620 - 280 * progress
  }
  game.dots = game.dots.filter((dot) => now < dot.born + dot.life)
  game.pops = game.pops.filter((pop) => now < pop.at + POP_MS)
}

// A new dot where it overlaps the others least (best of a few random tries).
function dot(game, born, progress) {
  const r = 22 + Math.random() * 18
  const place = () => ({
    x: r + 8 + Math.random() * Math.max(1, game.width - 2 * r - 16),
    y: HUD + r + 4 + Math.random() * Math.max(1, game.height - HUD - 2 * r - 12),
  })
  const clearance = (spot) =>
    game.dots.reduce((least, other) => Math.min(least, Math.hypot(other.x - spot.x, other.y - spot.y) - other.r), 1e9)
  const spot = [place(), place(), place(), place(), place()].reduce((best, spot) =>
    clearance(spot) > clearance(best) ? spot : best,
  )
  return {
    x: spot.x,
    y: spot.y,
    r,
    born,
    life: 1900 - 700 * progress,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
  }
}

// Pops in over 140 ms, then shrinks linearly to nothing.
function radius(dot, now) {
  const age = now - dot.born
  const grow = Math.min(1, age / 140)
  return dot.r * (1 - Math.pow(1 - grow, 3)) * Math.max(0, 1 - age / dot.life)
}

function tap(game, pointer, now) {
  const x = pointer.x
  const y = pointer.y
  const hit = game.dots
    .map((dot) => ({ dot, r: radius(dot, now), d: Math.hypot(dot.x - x, dot.y - y) }))
    .filter((candidate) => candidate.d <= candidate.r + 6)
    .sort((a, b) => a.d - b.d)[0]
  if (!hit) {
    game.pops.push({ x, y, r: 6, at: now, color: "#888888", points: 0 })
    return
  }
  const points = hit.r < 14 ? 3 : hit.r < 24 ? 2 : 1
  game.score += points
  game.dots = game.dots.filter((dot) => dot !== hit.dot)
  game.pops.push({ x: hit.dot.x, y: hit.dot.y, r: hit.r, at: now, color: hit.dot.color, points })
}

function paint(game, now, left, length) {
  const g = ui.draw()
  const bar = game.width - 24
  g.text(12, 26, String(game.score), { size: 22, weight: 700 })
  g.text(game.width - 12, 26, Math.ceil(left / 1000) + "s", {
    size: 15,
    weight: 600,
    align: "right",
    color: left < 5000 ? "warning" : "muted",
  })
  g.rrect(12, 34, bar, 4, 2, "border")
  g.rrect(12, 34, Math.max(0, (bar * left) / length), 4, 2, left < 5000 ? "warning" : "accent")
  for (const dot of game.dots) {
    g.circle(dot.x, dot.y, dot.r, { stroke: dot.color + "40", width: 1.5 })
    g.circle(dot.x, dot.y, Math.max(0.5, radius(dot, now)), dot.color)
  }
  for (const pop of game.pops) {
    const p = (now - pop.at) / POP_MS
    const fade = hex(1 - p)
    g.circle(pop.x, pop.y, pop.r + 22 * p, { stroke: pop.color + fade, width: 3 * (1 - p) + 0.5 })
    if (pop.points > 0)
      g.text(pop.x, pop.y - 6 - 26 * p, "+" + pop.points, {
        size: 16 + 2 * pop.points,
        weight: 700,
        color: pop.color + fade,
      })
  }
  return g
}

function hex(alpha) {
  const value = Math.max(0, Math.min(255, Math.round(alpha * 255)))
  return "0123456789abcdef"[value >> 4] + "0123456789abcdef"[value & 15]
}

// Bench workload (appended to the tap-dots live fixture, the former minigame built-in, packages/widget/test/fixtures):
// its per-frame `paint` with a fixed game state of 7 dots and 3 pops, drawn every frame (`widget.draw`).

async function main(data) {
  widget.render(ui.column({ gap: 1, align: "stretch" }, [ui.text(data.title, { style: "title" }), ui.canvas({ key: "board", height: HEIGHT })]))
  const game = { dots: [], pops: [], score: 12, start: 0, spawn: 0, width: 600, height: HEIGHT }
  for (let i = 0; i < 7; i++)
    game.dots.push({ x: 60 + 70 * i, y: 90 + 25 * (i % 4), r: 24 + i, born: 0, life: 1e12, color: COLORS[i % COLORS.length] })
  for (let i = 0; i < 3; i++) game.pops.push({ x: 100 + 150 * i, y: 200, r: 20, at: 0, color: COLORS[i], points: i + 1 })
  const start = widget.now()
  while (true) {
    const frame = await widget.frame()
    resize(game, frame)
    const now = 1000 + ((widget.now() - start) % 400)
    for (const pop of game.pops) pop.at = 1000
    widget.draw("board", paint(game, now, 12000, 20000))
  }
}
