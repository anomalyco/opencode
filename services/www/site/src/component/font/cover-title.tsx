import { onCleanup, onMount } from "solid-js"
import { buildOrder, cells, contours, type Letter } from "~/lib/font-content"
import { prefersReducedMotion } from "./plate"

const WORD = "opencode"
const COLS = WORD.length * 5 - 1
// Canvas margins, in modules: room for registration marks, dimension ticks and the counter.
const LEFT = 1
const TOP = 1.5
const BOTTOM = 2.6
const WIDTH = COLS + LEFT * 2
const HEIGHT = 7 + TOP + BOTTOM

// Phase budgets in milliseconds; each phase's moves share its budget in proportion to length.
const PHASES = { metrics: 420, grids: 620, outlines: 820, fill: 760, shade: 380 }
const SETTLE = 220
// The shade: the ink at the page's paper shade opacity.
const SHADE_ALPHA = 0.22

/** A move of the pen in module units: drawing (pen down) or travelling (pen up). */
type Move = {
  kind: "metric" | "grid" | "outline" | "travel" | "fill" | "shade"
  from: [number, number]
  to: [number, number]
  start: number
  duration: number
  letter: number
  // Which phase the move belongs to, in order.
  phase: number
  // For a shade move: the shade cell it fills.
  cell?: [number, number]
}

const units = (value: number) => Math.round(value * 120)
const length = (move: Pick<Move, "from" | "to">) =>
  Math.abs(move.to[0] - move.from[0]) + Math.abs(move.to[1] - move.from[1])

/**
 * The plot, as a list of moves with start times. Sequence: rule the four metric lines across the
 * word, draw each glyph's 4 × 7 grid, trace each outline along its contours, fill each letter
 * module by module, then lay in each shade module. Pen-up travel moves join the drawing moves.
 */
const program = (() => {
  const phases: { name: keyof typeof PHASES; moves: Omit<Move, "start" | "duration" | "phase">[] }[] = []
  // Metric lines: ascender (row 0), x-height (row 1), baseline (row 6), descender (row 7), alternating direction.
  phases.push({
    name: "metrics",
    moves: [0, 1, 6, 7].map((row, index) => ({
      kind: "metric" as const,
      from: [index % 2 ? COLS : 0, row] as [number, number],
      to: [index % 2 ? 0 : COLS, row] as [number, number],
      letter: -1,
    })),
  })
  // One continuous module grid across the word, built letter by letter: each letter's five
  // verticals, then eight horizontals that also run on across the one-module gap to the next
  // letter, so the gaps are squares too. Serpentine, like a plotter that never lifts.
  phases.push({
    name: "grids",
    moves: [...WORD].flatMap((_, letter) => {
      const x = letter * 5
      const right = Math.min(x + 5, COLS)
      return [
        ...[0, 1, 2, 3, 4].map((col) => ({
          kind: "grid" as const,
          from: [x + col, col % 2 ? 7 : 0] as [number, number],
          to: [x + col, col % 2 ? 0 : 7] as [number, number],
          letter,
        })),
        ...[0, 1, 2, 3, 4, 5, 6, 7].map((row) => ({
          kind: "grid" as const,
          from: [row % 2 ? right : x, row] as [number, number],
          to: [row % 2 ? x : right, row] as [number, number],
          letter,
        })),
      ]
    }),
  })
  // Outlines: every contour, vertex to vertex, in the glyph's own order.
  phases.push({
    name: "outlines",
    moves: [...WORD].flatMap((char, letter) =>
      contours(char as Letter).flatMap((points) =>
        points.map((point, index) => {
          const next = points[(index + 1) % points.length]
          return {
            kind: "outline" as const,
            from: [letter * 5 + point[0] / 6, point[1] / 6] as [number, number],
            to: [letter * 5 + next[0] / 6, next[1] / 6] as [number, number],
            letter,
          }
        }),
      ),
    ),
  })
  // Fill: one move per letter; its modules appear whole, one per step, in build order.
  phases.push({
    name: "fill",
    moves: [...WORD].map((_, letter) => ({
      kind: "fill" as const,
      from: [letter * 5, 0] as [number, number],
      to: [letter * 5 + 4, 7] as [number, number],
      letter,
    })),
  })
  // Shade: one move per shade module, in reading order.
  phases.push({
    name: "shade",
    moves: [...WORD].flatMap((char, letter) =>
      cells(char as Letter, "+").map(([col, row]) => ({
        kind: "shade" as const,
        from: [letter * 5 + col, row] as [number, number],
        to: [letter * 5 + col + 1, row + 1] as [number, number],
        letter,
        cell: [letter * 5 + col, row] as [number, number],
      })),
    ),
  })

  const moves: Move[] = []
  let clock = 0
  let pen: [number, number] = [0, 0]
  for (const [index, phase] of phases.entries()) {
    // Insert travel moves, then share the phase's time in proportion to each move's weight.
    const sequence: Omit<Move, "start" | "duration" | "phase">[] = []
    for (const move of phase.moves) {
      if (pen[0] !== move.from[0] || pen[1] !== move.from[1])
        sequence.push({ kind: "travel", from: pen, to: move.from, letter: move.letter })
      sequence.push(move)
      pen = move.to
    }
    // Travel is quick; fills and shades weigh like their area.
    const weight = (move: Omit<Move, "start" | "duration" | "phase">) =>
      move.kind === "travel"
        ? length(move) * 0.25
        : move.kind === "fill"
          ? 14
          : move.kind === "shade"
            ? 1
            : length(move)
    const total = sequence.reduce((sum, move) => sum + weight(move), 0)
    for (const move of sequence) {
      const duration = (weight(move) / total) * PHASES[phase.name]
      moves.push({ ...move, start: clock, duration, phase: index })
      clock += duration
    }
  }
  return { moves, end: clock }
})()

const END = program.end + SETTLE

type Palette = { ink: string; blue: string; faint: string }

/**
 * The cover title, plotted. A pen rules this font's metric lines across the word, draws each
 * glyph's 4 × 7 grid, traces every outline vertex to vertex, then fills the letters and their shade
 * module by module (each module whole on its step), with pen-up travel shown dashed, a coordinate
 * readout at the pen, a running counter, registration marks and module ticks. Every line is a
 * one-device-pixel rectangle on the pixel grid. Plays on first view, replays on click; reduced
 * motion shows the finished plot.
 */
export function CoverTitle() {
  let root!: HTMLSpanElement
  let canvas!: HTMLCanvasElement

  onMount(() => {
    const context = canvas.getContext("2d")!
    const reduced = prefersReducedMotion()
    let md = 16
    let dpr = 1
    let palette: Palette = { ink: "#141414", blue: "#3b5cf6", faint: "#bbb" }
    let started: number | undefined
    let frame = 0

    const layout = () => {
      dpr = Math.max(1, Math.round(window.devicePixelRatio || 1))
      const width = root.clientWidth
      // Whole device pixels per module.
      md = Math.max(4, Math.floor((width * dpr) / WIDTH))
      canvas.width = md * WIDTH
      canvas.height = Math.round(md * HEIGHT)
      canvas.style.width = `${canvas.width / dpr}px`
      canvas.style.height = `${canvas.height / dpr}px`
      const style = getComputedStyle(canvas)
      palette = { ink: style.color, blue: style.borderTopColor, faint: style.outlineColor }
    }

    // Module units to device pixels.
    const X = (x: number) => Math.round((LEFT + x) * md)
    const Y = (y: number) => Math.round((TOP + y) * md)

    /** An axis-aligned hairline from a to b, `progress` of the way, one device pixel thick. */
    const hairline = (a: [number, number], b: [number, number], progress = 1, dashed = false) => {
      const x0 = X(a[0])
      const y0 = Y(a[1])
      const x1 = X(a[0] + (b[0] - a[0]) * progress)
      const y1 = Y(a[1] + (b[1] - a[1]) * progress)
      // A right or bottom edge sits on the last pixel inside its cell, so lines never double up.
      const x = Math.min(x0, x1) - (x0 === x1 && x0 === canvas.width ? 1 : 0)
      const y = Math.min(y0, y1)
      const w = Math.max(1, Math.abs(x1 - x0))
      const h = Math.max(1, Math.abs(y1 - y0))
      if (!dashed) return context.fillRect(x, y, w, h)
      // Dashes of 3 on, 3 off, along the dominant axis; travel can be diagonal, so step both.
      const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))
      for (let step = 0; step < steps; step += 6) {
        const f = step / Math.max(1, steps)
        context.fillRect(Math.round(x0 + (x1 - x0) * f), Math.round(y0 + (y1 - y0) * f), 1, 1)
        context.fillRect(
          Math.round(x0 + (x1 - x0) * (f + 1 / steps)),
          Math.round(y0 + (y1 - y0) * (f + 1 / steps)),
          1,
          1,
        )
        context.fillRect(
          Math.round(x0 + (x1 - x0) * (f + 2 / steps)),
          Math.round(y0 + (y1 - y0) * (f + 2 / steps)),
          1,
          1,
        )
      }
    }

    const fillLetter = (letter: number) => {
      for (const [col, row] of buildOrder(WORD[letter] as Letter)) context.fillRect(X(letter * 5 + col), Y(row), md, md)
    }

    const ticks = (letter: number) => {
      const y = Y(7) + Math.round(md * 0.55)
      context.fillRect(X(letter * 5), y, X(letter * 5 + 4) - X(letter * 5), 1)
      for (let col = 0; col <= 4; col++) {
        const x = Math.min(X(letter * 5 + col), X(letter * 5 + 4) - 1)
        context.fillRect(x, y - Math.round(md * 0.18), 1, Math.round(md * 0.36) + 1)
      }
      context.fillText("4 × 120u", X(letter * 5), y + Math.round(md * 0.25) + 10 * dpr)
    }

    const registration = () => {
      const arm = Math.round(md * 0.45)
      const corners: [number, number][] = [
        [X(0) - Math.round(md * 0.6), Y(0) - Math.round(md * 0.6)],
        [X(COLS) + Math.round(md * 0.6), Y(0) - Math.round(md * 0.6)],
        [X(0) - Math.round(md * 0.6), Y(7) + Math.round(md * 0.6)],
        [X(COLS) + Math.round(md * 0.6), Y(7) + Math.round(md * 0.6)],
      ]
      for (const [x, y] of corners) {
        context.fillRect(x - arm, y, arm * 2 + 1, 1)
        context.fillRect(x, y - arm, 1, arm * 2 + 1)
        const box = Math.round(arm * 0.5)
        context.strokeStyle = context.fillStyle as string
        context.lineWidth = 1
        context.strokeRect(x - box + 0.5, y - box + 0.5, box * 2, box * 2)
      }
    }

    const draw = (t: number) => {
      const done = t >= END
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.font = `${10 * dpr}px "OpenTUI Mono", "OpenTUI Mono Menlo", ui-monospace, monospace`
      context.textBaseline = "alphabetic"

      // Registration marks: always there, faint once the plot is done.
      context.globalAlpha = done ? 0.5 : 1
      context.fillStyle = palette.blue
      registration()
      context.globalAlpha = 1

      let segments = 0
      let travelled = 0
      let pen: { at: [number, number]; down: boolean } | undefined
      const filled = new Set<number>()
      // Pen-up travel is shown only for the phase in progress, so finished phases stay clean.
      const phase = program.moves.findLast((move) => move.start <= t)?.phase ?? 0

      for (const move of program.moves) {
        if (t < move.start) break
        const progress = move.duration ? Math.min(1, (t - move.start) / move.duration) : 1
        const at: [number, number] = [
          move.from[0] + (move.to[0] - move.from[0]) * progress,
          move.from[1] + (move.to[1] - move.from[1]) * progress,
        ]
        if (move.kind === "metric" || move.kind === "grid" || move.kind === "outline") {
          context.fillStyle = move.kind === "outline" ? palette.blue : palette.faint
          context.globalAlpha = done && move.kind !== "outline" ? 0.55 : 1
          // Outlines vanish under the ink once a letter is filled; the grid and metrics stay faint.
          if (!(done && move.kind === "outline")) hairline(move.from, move.to, progress)
          context.globalAlpha = 1
          segments += progress === 1 ? 1 : 0
          travelled += length(move) * progress
          pen = { at, down: true }
        }
        if (move.kind === "travel") {
          if (!done && move.phase === phase) {
            context.fillStyle = palette.blue
            context.globalAlpha = 0.45
            hairline(move.from, move.to, progress, true)
            context.globalAlpha = 1
          }
          pen = { at, down: false }
        }
        if (move.kind === "fill") {
          // The letter's modules appear whole, one per step, in build order: no lines, no growth.
          const order = buildOrder(WORD[move.letter] as Letter)
          const shown = progress === 1 ? order.length : Math.floor(progress * order.length)
          context.fillStyle = palette.ink
          order.slice(0, shown).forEach(([col, row]) => context.fillRect(X(move.letter * 5 + col), Y(row), md, md))
          if (progress === 1) {
            filled.add(move.letter)
            context.fillStyle = palette.blue
            context.globalAlpha = done ? 0.6 : 1
            ticks(move.letter)
            context.globalAlpha = 1
          } else if (shown > 0) {
            const [col, row] = order[shown - 1]
            pen = { at: [move.letter * 5 + col + 0.5, row + 0.5], down: true }
          }
          segments += shown
          travelled += shown
        }
        if (move.kind === "shade" && move.cell) {
          // Each shade module appears whole on its step, a solid translucent wash of the ink.
          context.fillStyle = palette.ink
          context.globalAlpha = SHADE_ALPHA
          context.fillRect(X(move.cell[0]), Y(move.cell[1]), md, md)
          context.globalAlpha = 1
          segments += 1
          travelled += 1
          pen = { at: [move.cell[0] + 0.5, move.cell[1] + 0.5], down: true }
        }
      }

      // Outline segments drawn before the fill sit under the ink; redraw ink on top of them.
      context.fillStyle = palette.ink
      for (const letter of filled) fillLetter(letter)

      if (done || !pen) return
      // The pen: a filled square when down, an open one when up; its position in font units beside it.
      const px = X(pen.at[0])
      const py = Y(pen.at[1])
      const size = Math.max(3, Math.round(md * 0.22))
      context.fillStyle = palette.blue
      if (pen.down) context.fillRect(px - Math.floor(size / 2), py - Math.floor(size / 2), size, size)
      else {
        context.strokeStyle = palette.blue
        context.lineWidth = 1
        context.strokeRect(px - Math.floor(size / 2) + 0.5, py - Math.floor(size / 2) + 0.5, size - 1, size - 1)
      }
      const letter = Math.max(0, Math.min(7, Math.floor(pen.at[0] / 5)))
      const local = pen.at[0] - letter * 5
      const label = `${WORD[letter]} x ${Math.round(60 + local * 120)} y ${Math.round((6 - pen.at[1]) * 120)}${pen.down ? "" : " ↑"}`
      // Keep the readout on the canvas: it flips to the pen's left near the right edge.
      const labelWidth = context.measureText(label).width
      const right = px + size + 4 * dpr + labelWidth <= canvas.width
      context.fillText(label, right ? px + size + 4 * dpr : px - size - 4 * dpr - labelWidth, py - size)
      // Running counter, bottom right.
      context.textAlign = "right"
      context.fillText(
        `SEG ${String(segments).padStart(3, "0")} · L ${units(travelled).toLocaleString("en")}u · ${pen.down ? "PEN DOWN" : "PEN UP"}`,
        X(COLS),
        canvas.height - Math.round(md * 0.35),
      )
      context.textAlign = "left"
    }

    const tick = (now: number) => {
      started ??= now
      const t = now - started
      draw(t)
      frame = t < END ? requestAnimationFrame(tick) : 0
    }
    const play = () => {
      if (reduced) return
      cancelAnimationFrame(frame)
      started = undefined
      frame = requestAnimationFrame(tick)
    }

    layout()
    draw(reduced ? END : 0)

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        observer.disconnect()
        if (reduced) return draw(END)
        play()
      },
      { threshold: 0.6 },
    )
    observer.observe(root)
    root.addEventListener("click", play)

    let width = root.clientWidth
    const resize = new ResizeObserver(() => {
      if (root.clientWidth === width) return
      width = root.clientWidth
      layout()
      if (!frame) draw(END)
    })
    resize.observe(root)

    const repaint = () => {
      layout()
      if (!frame) draw(END)
    }
    const site = root.closest("[data-site]")
    const themeObserver = new MutationObserver(repaint)
    if (site) themeObserver.observe(site, { attributes: true, attributeFilter: ["data-theme"] })
    const scheme = window.matchMedia("(prefers-color-scheme: dark)")
    scheme.addEventListener("change", repaint)

    onCleanup(() => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      resize.disconnect()
      themeObserver.disconnect()
      scheme.removeEventListener("change", repaint)
      root.removeEventListener("click", play)
    })
  })

  return (
    <span data-slot="cover-word" ref={root}>
      <canvas ref={canvas} role="img" aria-label="OpenCode" />
    </span>
  )
}
