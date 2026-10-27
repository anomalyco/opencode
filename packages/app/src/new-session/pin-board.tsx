import { createEffect, onCleanup, onMount } from "solid-js"
import { createQuads, type Quads, type Rgba } from "./pin-quads"
import { PinSound } from "./pin-sound"
import { prefersReducedMotion } from "@opencode/ui/motion"

// The wordmark as a 78×14 pin grid: 1 = counter shadow, 2 = "open", 3 = "code".
const GRID = [
  "..................................................................33..........",
  "..................................................................33..........",
  "22222222..22222222..22222222..222222....33333333..33333333..33333333..33333333",
  "22222222..22222222..22222222..222222....33333333..33333333..33333333..33333333",
  "22....22..22....22..22....22..22....22..33........33....33..33....33..33....33",
  "22....22..22....22..22....22..22....22..33........33....33..33....33..33....33",
  "22111122..22111122..22222222..22111122..33111111..33111133..33111133..33333333",
  "22111122..22111122..22222222..22111122..33111111..33111133..33111133..33333333",
  "22111122..22111122..22111111..22111122..33111111..33111133..33111133..33111111",
  "22111122..22111122..22111111..22111122..33111111..33111133..33111133..33111111",
  "22222222..22222222..22222222..22111122..33333333..33333333..33333333..33333333",
  "22222222..22222222..22222222..22111122..33333333..33333333..33333333..33333333",
  "..........22..................................................................",
  "..........22..................................................................",
]
const COLS = 78
const ROWS = 14

const HOME = 0
const AIR = 1
const REST = 2
const RETURN = 3
// Knocked out by the brick breaker ball and fallen off the panel; the socket stays empty until the game ends.
const OUT = 4

export type PinEntrance = "sweep" | "chain"

/** Lets the brick breaker treat the pins as bricks. Coordinates are relative to the new session panel. */
export type PinBoardHandle = {
  /**
   * When the ball touches a pin, knocks out every pin within `blast` of the ball's edge. Returns the average
   * offset from the touched pins to the ball and how many pins were knocked out.
   */
  collide: (
    x: number,
    y: number,
    radius: number,
    blast: number,
    vx: number,
    vy: number,
  ) => { nx: number; ny: number; count: number } | undefined
  /** Pins still in their sockets. */
  left: () => number
  /** Starts game mode: pins ignore the pointer, follow the ball, and knocked pins fall off the panel. */
  play: () => void
  steer: (x: number, y: number) => void
  /** Ends game mode and flies every pin home. */
  restore: () => void
}

const REST_TILT = [0.42, 0.7] as const
const LIGHT = [0.55 / Math.hypot(0.55, 0.83), -0.83 / Math.hypot(0.55, 0.83)] as const
const SHADES = 16
const LOOSE = 4
const REVEAL = 0.75
const INTERACTIVE =
  'button, a, input, textarea, select, label, [contenteditable], [role], [data-component="composer"], [data-component="new-session-tip"]'

type Pin = {
  c: number
  r: number
  lv: number
  hx: number
  hy: number
  x: number
  y: number
  vx: number
  vy: number
  z: number
  zv: number
  e: number
  rot: number
  spin: number
  state: number
  pop: number
  popAt: number
  bucket: number
  onComposer: boolean
  level: number
  x0: number
  y0: number
  rot0: number
  t0: number
  duration: number
  lift: number
  fd: number
  bd: number
}

/**
 * The new session wordmark as a 3D pin board. Pins tilt toward the cursor and sink under it.
 * A click or drag knocks pins out; they pop toward the viewer, pile up on the composer,
 * then slot back in. The animation loop only runs while something is moving.
 */
export function NewSessionPinBoard(props: {
  logo: HTMLElement
  sound: () => boolean
  entrance?: PinEntrance
  closing?: boolean
  ref?: (board: PinBoardHandle) => void
}) {
  let back!: HTMLCanvasElement
  let front!: HTMLCanvasElement

  onMount(() => {
    const board = mountPinBoard(back, front, props.logo, props.sound, props.entrance)
    props.ref?.(board.handle)
    createEffect(() => {
      if (props.closing) board.close()
    })
    onCleanup(board.dispose)
  })

  return (
    <>
      <canvas
        ref={back}
        aria-hidden="true"
        data-slot="new-session-pins"
        class="pointer-events-none absolute left-0 top-0 -z-10"
      />
      <canvas
        ref={front}
        aria-hidden="true"
        data-slot="new-session-pins-popped"
        class="pointer-events-none absolute left-0 top-0"
      />
    </>
  )
}

function mountPinBoard(
  back: HTMLCanvasElement,
  front: HTMLCanvasElement,
  logo: HTMLElement,
  sound: () => boolean,
  entrance: PinEntrance = "sweep",
) {
  const stage = back.parentElement!
  // The pins behind the composer and the ones popped in front of it are each one layer of quads.
  const layers = { back: createQuads(back, () => wake()), front: createQuads(front, () => wake()) }
  const still = prefersReducedMotion()
  const pins: Pin[] = GRID.flatMap((row, r) =>
    [...row].flatMap((ch, c) => (ch === "." ? [] : [createPin(c, r, Number(ch))])),
  )
  const band: Pin[] = []
  const orders = new Map<number, Pin[]>()
  const corners = new Float32Array(8)
  const view = {
    left: 0,
    top: 0,
    w: 0,
    h: 0,
    x0: 0,
    y0: 0,
    activity: 0,
    dpr: 1,
    pitch: 7,
    depth: 12,
    size: 6,
    composer: undefined as { left: number; right: number; top: number } | undefined,
    region: { x: 0, y: 0, w: 0, h: 0, full: false },
    frontOn: true,
    game: false,
  }
  const pointer = { x: 0, y: 0, lx: 0, ly: 0, vx: 0, vy: 0, inside: false, down: false, dragX: 0, dragY: 0 }
  const tilt = { x: REST_TILT[0], y: REST_TILT[1] }
  const piles = { top: new Int16Array(0), floor: new Int16Array(0) }
  const clock = { born: performance.now() / 1000 - (still ? REVEAL * 2 : 0), last: 0, knocked: -99, closed: 0 }
  let colors = readColors(stage)
  let raf = 0

  const wake = () => {
    if (raf) return
    clock.last = performance.now() / 1000 - 1 / 60
    raf = requestAnimationFrame(frame)
  }

  const frame = (ms: number) => {
    raf = 0
    const now = ms / 1000
    const dt = Math.min(1 / 30, Math.max(1 / 240, now - clock.last))
    clock.last = now
    if (!still) step(now, dt)
    draw(now)
    if (!still && !settled(now)) raf = requestAnimationFrame(frame)
  }

  const layout = () => {
    const s = stage.getBoundingClientRect()
    const l = logo.getBoundingClientRect()
    const composer = stage.querySelector('[data-component="composer"]')?.getBoundingClientRect()
    const pitch = Math.max(3, Math.round(l.width / COLS))
    const x0 = Math.round(l.left - s.left + (l.width - pitch * COLS) / 2)
    const y0 = Math.round(l.top - s.top + (l.height - pitch * ROWS) / 2)
    view.left = s.left
    view.top = s.top
    if (view.w === s.width && view.h === s.height && view.pitch === pitch && view.x0 === x0 && view.y0 === y0) return
    view.w = s.width
    view.h = s.height
    view.dpr = Math.min(2, devicePixelRatio || 1)
    view.pitch = pitch
    view.depth = view.pitch * 1.7
    view.size = view.pitch * 0.8
    view.composer = composer && {
      left: composer.left - s.left,
      right: composer.right - s.left,
      top: composer.top - s.top,
    }
    view.x0 = x0
    view.y0 = y0
    for (const p of pins) {
      p.hx = view.x0 + (p.c + 0.5) * view.pitch
      p.hy = view.y0 + (p.r + 0.5) * view.pitch
      p.x = p.hx
      p.y = p.hy
      p.state = HOME
      p.pop = 0
      p.rot = 0
    }
    const buckets = Math.ceil(view.w / view.pitch) + 1
    piles.top = new Int16Array(buckets)
    piles.floor = new Int16Array(buckets)
    setRegion(false)
    setFront(false)
    wake()
  }

  // The back canvas only covers the logo while it is intact, and the whole panel while pins are loose.
  const setRegion = (full: boolean) => {
    const r = view.region
    const margin = Math.ceil(view.pitch * 3 + view.depth * 1.5)
    const x = full ? 0 : view.x0 - margin
    const y = full ? 0 : view.y0 - margin
    const next = {
      x,
      y,
      w: full ? Math.ceil(view.w) : Math.ceil(view.pitch * COLS + margin * 2),
      h: full ? Math.ceil(view.h) : Math.ceil(view.pitch * ROWS + margin * 2),
    }
    if (r.full === full && r.x === next.x && r.y === next.y && r.w === next.w && r.h === next.h && back.width) return
    Object.assign(r, next, { full })
    back.width = Math.round(r.w * view.dpr)
    back.height = Math.round(r.h * view.dpr)
    back.style.transform = `translate(${r.x}px, ${r.y}px)`
    back.style.width = `${r.w}px`
    back.style.height = `${r.h}px`
  }

  // The popped-pin layer covers the panel only while pins are popped, so it holds no memory at rest.
  const setFront = (on: boolean) => {
    if (view.frontOn === on) return
    view.frontOn = on
    front.width = on ? Math.round(view.w * view.dpr) : 0
    front.height = on ? Math.round(view.h * view.dpr) : 0
    front.style.width = on ? `${view.w}px` : "0px"
    front.style.height = on ? `${view.h}px` : "0px"
  }

  const popOf = (p: Pin, now: number) => {
    if (!p.pop) return 0
    const t = now - p.popAt
    return p.pop * (1 - Math.exp(-t * 22)) * Math.exp(-t * 2.6)
  }

  const knock = (x: number, y: number, radius: number, power: number, carryX: number, carryY: number, now: number) => {
    const hits = pins.filter((p) => Math.hypot(p.x - x, p.y - y) <= radius)
    hits.filter((p) => p.state === REST).forEach(unstack)
    for (const p of hits) {
      const dx = p.x - x
      const dy = p.y - y
      const dist = Math.hypot(dx, dy) || 1
      const f = 1 - dist / radius
      const home = p.state === HOME
      p.state = AIR
      p.e = 1
      p.vx = (home ? 0 : p.vx * 0.3) + (dx / dist) * power * f + carryX + (Math.random() - 0.5) * 60
      p.vy = (home ? 0 : Math.min(0, p.vy) * 0.3) + (dy / dist) * power * f + carryY - (home ? 220 : 420) - 380 * f
      p.spin += (Math.random() - 0.5) * 18
      p.pop = 0.35 + 0.65 * f
      p.popAt = now
    }
    if (!hits.length) return
    clock.knocked = now
    setRegion(true)
    if (sound()) PinSound.knock(x, view.w)
  }

  // Hitting a piled pin topples everything stacked above it.
  const unstack = (p: Pin) => {
    const heights = p.onComposer ? piles.top : piles.floor
    for (const o of pins) {
      if (o.state !== REST || o.onComposer !== p.onComposer || o.bucket !== p.bucket || o.level < p.level) continue
      o.state = AIR
      o.vx = (Math.random() - 0.5) * 120
      o.vy = -80 - Math.random() * 120
      o.spin += (Math.random() - 0.5) * 6
    }
    heights[p.bucket] = Math.min(heights[p.bucket], p.level)
  }

  // Piled pins sit above the composer's edge by their extrusion depth, so their sides do not tuck behind it.
  const composerSurface = () => (view.composer ? view.composer.top - view.depth * REST_TILT[1] : Infinity)

  const onComposer = (bucket: number) => {
    const x = (bucket + 0.5) * view.pitch
    return !!view.composer && x > view.composer.left + 2 && x < view.composer.right - 2
  }

  const settle = (p: Pin, start: number, top: boolean) => {
    const heights = top ? piles.top : piles.floor
    const bucket = Array.from({ length: 14 }).reduce<number>((b) => {
      const options = [b - 1, b + 1].filter(
        (n) => n >= 0 && n < heights.length && (top && !onComposer(n) ? heights[b] > 0 : heights[n] < heights[b]),
      )
      if (!options.length) return b
      return options[Math.floor(Math.random() * options.length)]
    }, start)
    if (top && !onComposer(bucket)) {
      p.x = (bucket + 0.5) * view.pitch
      p.vx = (bucket < start ? -1 : 1) * 90
      p.vy = 0
      return
    }
    p.state = REST
    p.bucket = bucket
    p.onComposer = top
    p.level = heights[bucket]
    p.x = (bucket + 0.5) * view.pitch
    p.y = (top ? composerSurface() : view.h) - heights[bucket] * view.pitch - view.pitch / 2
    heights[bucket]++
  }

  const reassemble = (now: number) => {
    for (const p of pins) {
      if (p.state !== AIR && p.state !== REST) continue
      p.state = RETURN
      p.x0 = p.x
      p.y0 = p.y
      p.rot0 = p.rot
      p.t0 = now + (p.c / COLS) * 0.6 + Math.random() * 0.1
      p.duration = 0.5 + Math.random() * 0.25
      p.lift = 30 + Math.random() * 70
    }
    piles.top.fill(0)
    piles.floor.fill(0)
    clock.knocked = now
  }

  const step = (now: number, dt: number) => {
    pointer.vx += ((pointer.x - pointer.lx) / dt - pointer.vx) * 0.5
    pointer.vy += ((pointer.y - pointer.ly) / dt - pointer.vy) * 0.5
    pointer.lx = pointer.x
    pointer.ly = pointer.y

    const cx = view.x0 + (COLS * view.pitch) / 2
    const cy = view.y0 + (ROWS * view.pitch) / 2
    // In game mode the board leans only slightly after the ball, so the bricks stay readable.
    const lean = view.game ? 0.12 : 0.6
    const tx = pointer.inside ? lerp(REST_TILT[0], clamp(((cx - pointer.x) / (view.w * 0.5)) * 1.4), lean) : REST_TILT[0]
    const ty = pointer.inside ? lerp(REST_TILT[1], clamp(((cy - pointer.y) / (view.h * 0.5)) * 1.4), lean) : REST_TILT[1]
    const ease = 1 - Math.exp(-dt * 4)
    tilt.x += (tx - tilt.x) * ease
    tilt.y += (ty - tilt.y) * ease

    // A held button keeps knocking along the drag path, spaced so it reads as a trail.
    if (pointer.down && Math.hypot(pointer.x - pointer.dragX, pointer.y - pointer.dragY) > view.pitch * 1.2) {
      pointer.dragX = pointer.x
      pointer.dragY = pointer.y
      knock(pointer.x, pointer.y, 16, 260, pointer.vx * 0.25, pointer.vy * 0.25, now)
    }

    const cell = view.pitch
    const counts = { air: 0, loose: 0 }
    const sink = view.game ? 36 : 55
    view.activity = Math.abs(tx - tilt.x) + Math.abs(ty - tilt.y) + (Math.abs(pointer.vx) + Math.abs(pointer.vy)) / 1000
    for (const p of pins) {
      if (p.state === OUT) continue
      p.e *= Math.exp(-dt * 1.8)
      if (p.pop && now - p.popAt > 1.5) p.pop = 0
      if (p.state === HOME) {
        const dist = pointer.inside ? Math.hypot(p.hx - pointer.x, p.hy - pointer.y) : Infinity
        const f = dist < sink ? 1 - dist / sink : 0
        const target = f * f * 0.9
        p.zv += ((target - p.z) * 260 - p.zv * 14) * dt
        p.z = Math.max(-0.8, Math.min(1, p.z + p.zv * dt))
        view.activity = Math.max(view.activity, Math.abs(p.zv) * 0.1 + Math.abs(target - p.z), p.e * 0.05)
        continue
      }
      if (p.state === REST) {
        counts.loose++
        p.rot = wrapQuarter(p.rot) * Math.exp(-dt * 14)
        continue
      }
      if (p.state === RETURN) {
        const k = (now - p.t0) / p.duration
        if (k < 0) continue
        if (k >= 1) {
          Object.assign(p, {
            state: HOME,
            x: p.hx,
            y: p.hy,
            vx: 0,
            vy: 0,
            rot: 0,
            spin: 0,
            pop: 0,
            e: clock.closed ? 0.5 : 0.9,
            z: clock.closed ? -0.2 : -0.8,
            zv: 0,
          })
          if (sound()) PinSound.slot(p.c, COLS, p.hx, view.w)
          continue
        }
        const e = 1 - Math.pow(1 - k, 3)
        p.x = lerp(p.x0, p.hx, e)
        p.y = lerp(p.y0, p.hy, e) - Math.sin(k * Math.PI) * p.lift
        p.rot = lerp(wrapQuarter(p.rot0), 0, e)
        continue
      }
      counts.air++
      counts.loose++
      p.vy += 2400 * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.rot += p.spin * dt
      if (p.x < cell) Object.assign(p, { x: cell, vx: Math.abs(p.vx) * 0.5 })
      if (p.x > view.w - cell) Object.assign(p, { x: view.w - cell, vx: -Math.abs(p.vx) * 0.5 })
      if (view.game) {
        if (p.y > view.h + cell * 4) p.state = OUT
        continue
      }
      if (p.vy <= 0 || popOf(p, now) >= 0.1) continue
      const bucket = Math.max(0, Math.min(piles.top.length - 1, Math.floor(p.x / cell)))
      const topSurface = composerSurface() - piles.top[bucket] * cell
      const top = onComposer(bucket) && p.y - p.vy * dt + cell / 2 <= topSurface + 1
      const surface = top ? topSurface : view.h - piles.floor[bucket] * cell
      if (p.y + cell / 2 < surface) continue
      if (p.vy <= 260) {
        settle(p, bucket, top)
        continue
      }
      p.y = surface - cell / 2
      if (sound()) PinSound.bounce(p.x, view.w, p.vy)
      p.vy = -p.vy * 0.34
      p.vx *= 0.55
      p.spin = -p.spin * 0.5 + (Math.random() - 0.5) * 4
    }

    const idle = now - clock.knocked
    if (!view.game && !pointer.down && counts.loose && ((counts.air === 0 && idle > 2) || idle > 6)) reassemble(now)
    if (view.region.full && pins.every((p) => p.state === HOME)) setRegion(false)
  }

  const revealSpan = entrance === "sweep" ? REVEAL : 1.3
  const resting = (p: Pin) => p.state === HOME || p.state === OUT
  const settled = (now: number) => {
    if (clock.closed) return now - clock.closed >= 1.2 && pins.every((p) => p.state === HOME)
    if (now - clock.born < revealSpan || pointer.down || view.activity > 1e-3) return false
    return pins.every(resting)
  }

  const draw = (now: number) => {
    const back = layers.back
    back.begin()
    drawBoard(now)

    const loose = pins.filter((p) => !resting(p))
    const popped = loose.filter((p) => popOf(p, now) > 0.06).sort((a, b) => popOf(a, now) - popOf(b, now))
    const flat = loose.filter((p) => popOf(p, now) <= 0.06)

    for (const p of loose) {
      const pop = popOf(p, now)
      const offset = view.depth * (0.35 + pop * 5)
      const size = view.size * (1 + pop * 1.6) * (1 + pop * 0.4)
      back.rect(
        p.x + tilt.x * view.depth - LIGHT[0] * offset - size / 2,
        p.y + tilt.y * view.depth - LIGHT[1] * offset - size / 2,
        size,
        size,
        [0, 0, 0, colors.shadow[3] * (1 - pop * 0.65)],
      )
    }
    // Cubes further along the extrusion direction sit in front, so stacked pins overlap correctly.
    flat.sort((a, b) => a.x * tilt.x + a.y * tilt.y - (b.x * tilt.x + b.y * tilt.y))
    for (const p of flat) drawCube(back, p, 1)
    back.draw(view.region, view.dpr)

    setFront(popped.length > 0)
    if (!popped.length) return
    layers.front.begin()
    for (const p of popped) drawCube(layers.front, p, 1 + popOf(p, now) * 1.6)
    layers.front.draw({ x: 0, y: 0, w: view.w, h: view.h }, view.dpr)
  }

  // Pins are prisms from their front face back to the board. Drawing them in order of their
  // grid position along the extrusion direction is a correct painter's order for any heights,
  // since pins on the same diagonal never overlap.
  const drawBoard = (now: number) => {
    const quads = layers.back
    const sx = tilt.x >= 0 ? 1 : -1
    const sy = tilt.y >= 0 ? 1 : -1
    const ox = tilt.x * view.depth
    const oy = tilt.y * view.depth
    const half = view.size / 2
    const size = view.size
    const age = now - clock.born
    const closeAge = clock.closed ? now - clock.closed : -1

    for (const p of pins) {
      if (p.state !== HOME) continue
      const g =
        closeAge >= 0
          ? closeOf(p, closeAge)
          : entrance === "sweep"
            ? age >= (p.c / COLS) * 0.45
              ? 1
              : 0
            : chainOf(p, age)
      if (g <= 0.05) continue
      const s = Math.min(1, g)
      quads.shadow(
        p.hx + ox * s - LIGHT[0] * 2.5 * s - half - 1,
        p.hy + oy * s - LIGHT[1] * 2.5 * s - half - 1,
        size + 2,
        size + 2,
        [colors.shadow[0], colors.shadow[1], colors.shadow[2], colors.shadow[3] * s],
      )
    }

    // An empty socket: a dark rim with its floor visible through the opening, shifted by the tilt.
    for (const p of pins)
      if (p.state !== HOME) quads.rect(p.hx + ox - half, p.hy + oy - half, size, size, colors.socketRim)
    for (const p of pins) {
      if (p.state === HOME) continue
      const w = size - Math.abs(ox * 0.45)
      const h = size - Math.abs(oy * 0.45)
      if (w > 0 && h > 0)
        quads.rect(
          p.hx + ox - half + Math.max(0, ox * 0.45),
          p.hy + oy - half + Math.max(0, oy * 0.45),
          w,
          h,
          colors.socketFloor,
        )
    }

    const key = (sx > 0 ? 1 : 0) + (sy > 0 ? 2 : 0)
    const order =
      orders.get(key) ??
      orders
        .set(
          key,
          [...pins].sort((a, b) => a.c * sx + a.r * sy - (b.c * sx + b.r * sy)),
        )
        .get(key)!
    const sideX = sx > 0 ? Math.round(Math.max(0, LIGHT[0]) * SHADES) : 0
    const sideY = sy < 0 ? Math.round(Math.max(0, -LIGHT[1]) * SHADES) : 0

    // Each diagonal goes out grouped by colour, so the 2D fallback can fill each run as one path.
    const flush = () => {
      for (let lv = 1; lv <= 3; lv++) {
        for (const p of band) {
          if (p.lv !== lv) continue
          const fx = p.hx + ox * p.fd + sx * half
          quads.quad(fx, p.hy + oy * p.fd - half, ox * (p.bd - p.fd), oy * (p.bd - p.fd), 0, size, colors.side[lv][sideX])
        }
        for (const p of band) {
          if (p.lv !== lv) continue
          const fy = p.hy + oy * p.fd + sy * half
          quads.quad(p.hx + ox * p.fd - half, fy, size, 0, ox * (p.bd - p.fd), oy * (p.bd - p.fd), colors.side[lv][sideY])
        }
      }
      for (const p of band)
        quads.rect(
          p.hx + ox * p.fd - half,
          p.hy + oy * p.fd - half,
          size,
          size,
          colors.face[p.lv][shadeOf(Math.max(p.e, p.z))],
        )
      if (size < 4) return
      // The lit and shaded edges are split at the corners so no pixel is tinted twice by one of them.
      for (const p of band) {
        if (p.lv === 1) continue
        const x = p.hx + ox * p.fd - half
        const y = p.hy + oy * p.fd - half
        quads.rect(x, y, size, 1, colors.highlight)
        quads.rect(x + size - 1, y + 1, 1, size - 1, colors.highlight)
      }
      for (const p of band) {
        if (p.lv === 1) continue
        const x = p.hx + ox * p.fd - half
        const y = p.hy + oy * p.fd - half
        quads.rect(x, y + size - 1, size, 1, colors.lowlight)
        quads.rect(x, y, 1, size - 1, colors.lowlight)
      }
    }

    let current = NaN
    band.length = 0
    for (const p of order) {
      if (p.state !== HOME) continue
      const height = (p.lv === 1 ? 0.35 : 1) * (1 - Math.max(0, p.z)) + Math.max(0, -p.z) * 0.6
      if (entrance === "sweep" && closeAge < 0) {
        const grow = Math.min(1, Math.max(0, (age - (p.c / COLS) * 0.45) / 0.3))
        if (!grow) continue
        p.bd = 1
        p.fd = 1 - height * (1 - Math.pow(1 - grow, 3))
      }
      if (entrance !== "sweep" || closeAge >= 0) {
        const w = closeAge >= 0 ? closeOf(p, closeAge) : chainOf(p, age)
        if (w <= 0.01) continue
        const g = Math.min(1, w)
        p.bd = g
        p.fd = (1 - height) * g
        p.e = Math.max(p.e, Math.sin(g * Math.PI) * 0.85)
      }
      const k = p.c * sx + p.r * sy
      if (k !== current && band.length) {
        flush()
        band.length = 0
      }
      current = k
      band.push(p)
    }
    if (band.length) flush()
  }

  // Loose pins are extruded squares. Each visible side is lit by its own normal, so tumbling pins flicker.
  // Counter pins are recessed and nearly black on the board; out of it they use the loose shade so they read as cubes.
  const drawCube = (layer: Quads, p: Pin, scale: number) => {
    const lv = p.lv === 1 ? LOOSE : p.lv
    const radius = (view.size * scale) / Math.SQRT2
    for (let j = 0; j < 4; j++) {
      const a = p.rot + Math.PI / 4 + (j * Math.PI) / 2
      corners[j * 2] = p.x + Math.cos(a) * radius
      corners[j * 2 + 1] = p.y + Math.sin(a) * radius
    }
    const ox = tilt.x * view.depth * scale
    const oy = tilt.y * view.depth * scale
    for (let j = 0; j < 4; j++) {
      const ax = corners[j * 2]
      const ay = corners[j * 2 + 1]
      const bx = corners[((j + 1) % 4) * 2]
      const by = corners[((j + 1) % 4) * 2 + 1]
      const nx = (ax + bx) / 2 - p.x
      const ny = (ay + by) / 2 - p.y
      if (nx * tilt.x + ny * tilt.y <= 0) continue
      const n = Math.hypot(nx, ny) || 1
      const shade = Math.round(Math.max(0, (nx * LIGHT[0] + ny * LIGHT[1]) / n) * SHADES)
      layer.quad(ax, ay, bx - ax, by - ay, ox, oy, colors.side[lv][shade])
    }
    const x = corners[0]
    const y = corners[1]
    layer.quad(x, y, corners[2] - x, corners[3] - y, corners[6] - x, corners[7] - y, colors.face[lv][shadeOf(p.e)])
  }

  const toStage = (event: PointerEvent) => {
    pointer.x = event.clientX - view.left
    pointer.y = event.clientY - view.top
  }
  const onEnter = (event: PointerEvent) => {
    if (view.game) return
    const s = stage.getBoundingClientRect()
    view.left = s.left
    view.top = s.top
    toStage(event)
    pointer.lx = pointer.x
    pointer.ly = pointer.y
    pointer.inside = true
    wake()
  }
  const onMove = (event: PointerEvent) => {
    if (view.game) return
    toStage(event)
    pointer.inside = true
    wake()
  }
  const onLeave = () => {
    if (pointer.down || view.game) return
    pointer.inside = false
    wake()
  }
  // Capturing the pointer keeps a long drag alive; without it the browser can start a text
  // selection or native drag mid-gesture and cancel the pointer stream.
  const onDown = (event: PointerEvent) => {
    if (view.game || event.button !== 0 || (event.target instanceof Element && event.target.closest(INTERACTIVE)))
      return
    event.preventDefault()
    stage.setPointerCapture(event.pointerId)
    toStage(event)
    pointer.down = true
    pointer.dragX = pointer.x
    pointer.dragY = pointer.y
    knock(pointer.x, pointer.y, 24, 560, 0, 0, performance.now() / 1000)
    wake()
  }
  const onUp = (event: Event) => {
    pointer.down = false
    if (event instanceof PointerEvent && stage.hasPointerCapture(event.pointerId))
      stage.releasePointerCapture(event.pointerId)
  }
  const onSelect = (event: Event) => {
    if (pointer.down) event.preventDefault()
  }
  const onTheme = () => {
    colors = readColors(stage)
    wake()
  }

  const resize = new ResizeObserver(layout)
  resize.observe(stage)
  resize.observe(logo)
  const theme = new MutationObserver(onTheme)
  theme.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-color-scheme", "data-theme", "class"],
  })
  const scheme = matchMedia("(prefers-color-scheme: dark)")
  scheme.addEventListener("change", onTheme)
  if (!still) {
    stage.addEventListener("pointerenter", onEnter)
    stage.addEventListener("pointermove", onMove)
    stage.addEventListener("pointerleave", onLeave)
    stage.addEventListener("pointerdown", onDown)
    stage.addEventListener("pointerup", onUp)
    stage.addEventListener("pointercancel", onUp)
    stage.addEventListener("lostpointercapture", onUp)
    stage.addEventListener("selectstart", onSelect)
    stage.addEventListener("dragstart", onSelect)
    window.addEventListener("blur", onUp)
  }
  layout()
  // The reveal staggers columns over 0.45 s and each rises over 0.3 s; the sweep spans the same window.
  if (!still && sound()) PinSound.sweep({ duration: entrance === "sweep" ? REVEAL : 0.9, columns: COLS })

  const handle: PinBoardHandle = {
    collide: (x, y, radius, blast, vx, vy) => {
      const half = view.size / 2
      const reach = radius + blast + half
      const now = performance.now() / 1000
      const hit = { nx: 0, ny: 0, count: 0 }
      const struck: Pin[] = []
      for (const p of pins) {
        if (p.state !== HOME) continue
        const dx = x - p.hx
        const dy = y - p.hy
        if (Math.abs(dx) > reach || Math.abs(dy) > reach) continue
        const gap = Math.hypot(dx - Math.max(-half, Math.min(half, dx)), dy - Math.max(-half, Math.min(half, dy)))
        if (gap > radius + blast) continue
        struck.push(p)
        if (gap > radius) continue
        hit.nx += dx
        hit.ny += dy
        hit.count++
      }
      if (!hit.count) return
      hit.nx /= hit.count
      hit.ny /= hit.count
      hit.count = struck.length
      for (const p of struck) {
        const dx = x - p.hx
        const dy = y - p.hy
        const dist = Math.hypot(dx, dy) || 1
        // Bricks burst away from the ball toward the viewer, then fall off the panel.
        p.state = AIR
        p.e = 1
        p.vx = vx * 0.35 - (dx / dist) * 140 + (Math.random() - 0.5) * 160
        p.vy = vy * 0.35 - (dy / dist) * 140 - 180 - Math.random() * 180
        p.spin += (Math.random() - 0.5) * 22
        p.pop = 0.45 + Math.random() * 0.4
        p.popAt = now
      }
      clock.knocked = now
      setRegion(true)
      wake()
      return hit
    },
    left: () => pins.reduce((n, p) => (p.state === HOME ? n + 1 : n), 0),
    play: () => {
      const now = performance.now() / 1000
      view.game = true
      pointer.down = false
      pointer.inside = false
      piles.top.fill(0)
      piles.floor.fill(0)
      // Pins still loose from earlier clicks hurry home so the wall is whole when the ball is served.
      for (const p of pins) {
        if (p.state === HOME) continue
        Object.assign(p, { state: RETURN, x0: p.x, y0: p.y, rot0: p.rot, t0: now + (p.c / COLS) * 0.2 })
        p.duration = 0.35 + Math.random() * 0.1
        p.lift = 20 + Math.random() * 30
      }
      wake()
    },
    steer: (x, y) => {
      pointer.x = x
      pointer.y = y
      pointer.inside = true
      wake()
    },
    restore: () => {
      const now = performance.now() / 1000
      view.game = false
      pointer.inside = false
      clock.knocked = now
      // Lost bricks fly back up from below the panel, sweeping in column by column.
      for (const p of pins) {
        if (p.state === HOME) continue
        const out = p.state === OUT
        Object.assign(p, {
          state: RETURN,
          x0: out ? p.hx + (Math.random() - 0.5) * view.pitch * 6 : p.x,
          y0: out ? view.h + view.pitch * 2 : p.y,
          rot0: out ? (Math.random() - 0.5) * 6 : p.rot,
          t0: now + 0.15 + (p.c / COLS) * 0.55 + Math.random() * 0.08,
          duration: 0.55 + Math.random() * 0.2,
          lift: 20 + Math.random() * 50,
        })
      }
      wake()
    },
  }

  return {
    handle,
    close: () => {
      if (clock.closed) return
      const now = performance.now() / 1000
      clock.closed = now
      pointer.down = false
      piles.top.fill(0)
      piles.floor.fill(0)
      for (const p of pins) {
        if (p.state === HOME) continue
        p.state = RETURN
        p.x0 = p.x
        p.y0 = p.y
        p.rot0 = p.rot
        p.t0 = now + (p.c / COLS) * 0.18
        p.duration = 0.28 + Math.random() * 0.06
        p.lift = 24 + Math.random() * 42
      }
      if (!still && sound()) PinSound.sweep({ duration: 0.95, columns: COLS, reverse: true })
      wake()
    },
    dispose: () => {
      cancelAnimationFrame(raf)
      resize.disconnect()
      theme.disconnect()
      scheme.removeEventListener("change", onTheme)
      stage.removeEventListener("pointerenter", onEnter)
      stage.removeEventListener("pointermove", onMove)
      stage.removeEventListener("pointerleave", onLeave)
      stage.removeEventListener("pointerdown", onDown)
      stage.removeEventListener("pointerup", onUp)
      stage.removeEventListener("pointercancel", onUp)
      stage.removeEventListener("lostpointercapture", onUp)
      stage.removeEventListener("selectstart", onSelect)
      stage.removeEventListener("dragstart", onSelect)
      window.removeEventListener("blur", onUp)
      layers.back.dispose()
      layers.front.dispose()
    },
  }
}

function createPin(c: number, r: number, lv: number): Pin {
  return {
    c,
    r,
    lv,
    hx: 0,
    hy: 0,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    z: 0,
    zv: 0,
    e: 0,
    rot: 0,
    spin: 0,
    state: HOME,
    pop: 0,
    popAt: 0,
    bucket: 0,
    onComposer: false,
    level: 0,
    x0: 0,
    y0: 0,
    rot0: 0,
    t0: 0,
    duration: 0,
    lift: 0,
    fd: 0,
    bd: 1,
  }
}

// Radial chain-reaction from the starter pin in the "e" (column 75, row 3).
function chainOf(p: Pin, age: number) {
  const dist = Math.hypot(p.c - 75, (p.r - 3) * 1.4)
  const u = (age - (dist / 76) * 0.62) / 0.36
  if (u <= 0) return 0
  if (u >= 1) return 1
  return 1 - Math.pow(1 - u, 3)
}

// Reverse wave reeling pins from left ("o") back into the "e" hole when the lodger is tucked back in.
function closeOf(p: Pin, closeAge: number) {
  const dist = Math.hypot(p.c - 75, (p.r - 3) * 1.4)
  const u = (closeAge - (0.32 + ((76 - dist) / 76) * 0.48)) / 0.32
  if (u <= 0) return 1
  if (u >= 1) return 0
  return 1 - u * u * (3 - 2 * u)
}

// Theme colours are resolved through a 1×1 canvas so any CSS colour syntax works.
function readColors(stage: HTMLElement) {
  const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!
  const style = getComputedStyle(stage)
  const rgb = (value: string, fallback: string) => {
    probe.clearRect(0, 0, 1, 1)
    probe.fillStyle = fallback
    probe.fillStyle = value || fallback
    probe.fillRect(0, 0, 1, 1)
    const d = probe.getImageData(0, 0, 1, 1).data
    return [d[0], d[1], d[2]] as const
  }
  const token = (name: string, fallback: string) => rgb(style.getPropertyValue(name).trim(), fallback)
  const bg = rgb(style.backgroundColor, "#161616")
  const faint = token("--v2-icon-icon-faint", "#5c5c5c")
  const levels = [
    bg,
    mix(bg, faint, 0.5),
    token("--v2-icon-icon-muted", "#808080"),
    token("--v2-icon-icon-base", "#dbdbdb"),
    faint,
  ]
  const brand = token("--v2-orange-500", "#ffa478")
  const dark = bg[0] * 0.2126 + bg[1] * 0.7152 + bg[2] * 0.0722 < 128
  const black = [0, 0, 0]
  const shades = (fn: (t: number) => readonly number[]) =>
    Array.from({ length: SHADES + 1 }, (_, i) => color(fn(i / SHADES)))
  // Sides are the pin's own colour in shadow, so they stay darker than its face in either theme.
  return {
    side: levels.map((level) => shades((t) => mix(black, level, 0.3 + 0.5 * t))),
    face: levels.map((level, lv) => shades((t) => mix(level, brand, t * (lv === 1 ? 0.4 : 0.85)))),
    socketRim: color(mix(bg, black, dark ? 0.6 : 0.16)),
    socketFloor: color(mix(bg, black, dark ? 0.35 : 0.08)),
    shadow: color(black, dark ? 0.3 : 0.12),
    highlight: color([255, 255, 255], 0.2),
    lowlight: color(black, 0.2),
  }
}

const mix = (a: readonly number[], b: readonly number[], t: number) => a.map((v, i) => v + (b[i] - v) * t)
const color = (c: readonly number[], alpha = 1): Rgba => [Math.round(c[0]), Math.round(c[1]), Math.round(c[2]), alpha]
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp = (v: number) => Math.max(-1, Math.min(1, v))
const shadeOf = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * SHADES)
const wrapQuarter = (a: number) => {
  const q = Math.PI / 2
  const m = (((a + q / 2) % q) + q) % q
  return m - q / 2
}
