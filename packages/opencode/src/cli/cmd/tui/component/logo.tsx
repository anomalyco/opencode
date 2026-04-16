import { BoxRenderable, MouseButton, MouseEvent, RGBA, TextAttributes } from "@opentui/core"
import { For, createMemo, createSignal, onCleanup, type JSX } from "solid-js"
import { useTheme, tint } from "@tui/context/theme"
import * as Sound from "@tui/util/sound"
import { logo } from "@/cli/logo"

// Shadow markers (rendered chars in parens):
// _ = full shadow cell (space with bg=shadow)
// ^ = letter top, shadow bottom (▀ with fg=letter, bg=shadow)
// ~ = shadow top only (▀ with fg=shadow)
const GAP = 1
const WIDTH = 0.76
const GAIN = 2.3
const FLASH = 2.15
const TRAIL = 0.28
const SWELL = 0.24
const WIDE = 1.85
const DRIFT = 1.45
const EXPAND = 1.62
const LIFE = 1020
const CHARGE = 3000
const HOLD = 90
const SINK = 40
const ARC = 2.2
const FORK = 1.2
const DIM = 1.04
const KICK = 0.86
const LAG = 60
const SUCK = 0.34
const SHIMMER_IN = 60
const SHIMMER_OUT = 2.8
const TRACE = 0.033
const TAIL = 1.8
const TRACE_IN = 200
const GLOW_OUT = 1600
const PEAK = RGBA.fromInts(255, 255, 255)

type Ring = {
  x: number
  y: number
  at: number
  force: number
  kick: number
}

type Hold = {
  x: number
  y: number
  at: number
  glyph: number | undefined
}

type Release = {
  x: number
  y: number
  at: number
  glyph: number | undefined
  level: number
  rise: number
}

type Glow = {
  glyph: number
  at: number
  force: number
}

type Frame = {
  t: number
  list: Ring[]
  hold: Hold | undefined
  release: Release | undefined
  glow: Glow | undefined
  spark: number
}

const LEFT = logo.left[0]?.length ?? 0
const FULL = logo.left.map((line, i) => line + " ".repeat(GAP) + logo.right[i])
const SPAN = Math.hypot(FULL[0]?.length ?? 0, FULL.length * 2) * 0.94
const NEAR = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
] as const

type Trace = {
  glyph: number
  i: number
  l: number
}

function clamp(n: number) {
  return Math.max(0, Math.min(1, n))
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * clamp(t)
}

function ease(t: number) {
  const p = clamp(t)
  return p * p * (3 - 2 * p)
}

function push(t: number) {
  const p = clamp(t)
  return ease(p * p)
}

function ramp(t: number, start: number, end: number) {
  if (end <= start) return ease(t >= end ? 1 : 0)
  return ease((t - start) / (end - start))
}

function glow(base: RGBA, theme: ReturnType<typeof useTheme>["theme"], n: number) {
  const mid = tint(base, theme.primary, 0.84)
  const top = tint(theme.primary, PEAK, 0.96)
  if (n <= 1) return tint(base, mid, Math.min(1, Math.sqrt(Math.max(0, n)) * 1.14))
  return tint(mid, top, Math.min(1, 1 - Math.exp(-2.4 * (n - 1))))
}

function shade(base: RGBA, theme: ReturnType<typeof useTheme>["theme"], n: number) {
  if (n >= 0) return glow(base, theme, n)
  return tint(base, theme.background, Math.min(0.82, -n * 0.64))
}

function ghost(n: number, scale: number) {
  if (n < 0) return n
  return n * scale
}

function noise(x: number, y: number, t: number) {
  const n = Math.sin(x * 12.9898 + y * 78.233 + t * 0.043) * 43758.5453
  return n - Math.floor(n)
}

function lit(char: string) {
  return char !== " " && char !== "_" && char !== "~"
}

function key(x: number, y: number) {
  return `${x},${y}`
}

function route(list: Array<{ x: number; y: number }>) {
  const left = new Map(list.map((item) => [key(item.x, item.y), item]))
  const path: Array<{ x: number; y: number }> = []
  let cur = [...left.values()].sort((a, b) => a.y - b.y || a.x - b.x)[0]
  let dir = { x: 1, y: 0 }

  while (cur) {
    path.push(cur)
    left.delete(key(cur.x, cur.y))
    if (!left.size) return path

    const next = NEAR.map(([dx, dy]) => left.get(key(cur.x + dx, cur.y + dy)))
      .filter((item): item is { x: number; y: number } => !!item)
      .sort((a, b) => {
        const ax = a.x - cur.x
        const ay = a.y - cur.y
        const bx = b.x - cur.x
        const by = b.y - cur.y
        const adot = ax * dir.x + ay * dir.y
        const bdot = bx * dir.x + by * dir.y
        if (adot !== bdot) return bdot - adot
        return Math.abs(ax) + Math.abs(ay) - (Math.abs(bx) + Math.abs(by))
      })[0]

    if (!next) {
      cur = [...left.values()].sort((a, b) => {
        const da = (a.x - cur.x) ** 2 + (a.y - cur.y) ** 2
        const db = (b.x - cur.x) ** 2 + (b.y - cur.y) ** 2
        return da - db
      })[0]
      dir = { x: 1, y: 0 }
      continue
    }

    dir = { x: next.x - cur.x, y: next.y - cur.y }
    cur = next
  }

  return path
}

function mapGlyphs() {
  const cells = [] as Array<{ x: number; y: number }>

  for (let y = 0; y < FULL.length; y++) {
    for (let x = 0; x < (FULL[y]?.length ?? 0); x++) {
      if (lit(FULL[y]?.[x] ?? " ")) cells.push({ x, y })
    }
  }

  const all = new Map(cells.map((item) => [key(item.x, item.y), item]))
  const seen = new Set<string>()
  const glyph = new Map<string, number>()
  const trace = new Map<string, Trace>()
  const center = new Map<number, { x: number; y: number }>()
  let id = 0

  for (const item of cells) {
    const start = key(item.x, item.y)
    if (seen.has(start)) continue
    const stack = [item]
    const part = [] as Array<{ x: number; y: number }>
    seen.add(start)

    while (stack.length) {
      const cur = stack.pop()!
      part.push(cur)
      glyph.set(key(cur.x, cur.y), id)
      for (const [dx, dy] of NEAR) {
        const next = all.get(key(cur.x + dx, cur.y + dy))
        if (!next) continue
        const mark = key(next.x, next.y)
        if (seen.has(mark)) continue
        seen.add(mark)
        stack.push(next)
      }
    }

    const path = route(part)
    path.forEach((cell, i) => trace.set(key(cell.x, cell.y), { glyph: id, i, l: path.length }))
    center.set(id, {
      x: part.reduce((sum, item) => sum + item.x, 0) / part.length + 0.5,
      y: (part.reduce((sum, item) => sum + item.y, 0) / part.length) * 2 + 1,
    })
    id++
  }

  return { glyph, trace, center }
}

const MAP = mapGlyphs()

function shimmer(x: number, y: number, frame: Frame) {
  return frame.list.reduce((best, item) => {
    const age = frame.t - item.at
    if (age < SHIMMER_IN || age > LIFE) return best
    const dx = x + 0.5 - item.x
    const dy = y * 2 + 1 - item.y
    const dist = Math.hypot(dx, dy)
    const p = age / LIFE
    const r = SPAN * (1 - (1 - p) ** EXPAND)
    const lag = r - dist
    if (lag < 0.18 || lag > SHIMMER_OUT) return best
    const band = Math.exp(-(((lag - 1.05) / 0.68) ** 2))
    const wobble = 0.5 + 0.5 * Math.sin(frame.t * 0.035 + x * 0.9 + y * 1.7)
    const n = band * wobble * (1 - p) ** 1.45
    if (n > best) return n
    return best
  }, 0)
}

function remain(x: number, y: number, item: Release, t: number) {
  const age = t - item.at
  if (age < 0 || age > LIFE) return 0
  const p = age / LIFE
  const dx = x + 0.5 - item.x - 0.5
  const dy = y * 2 + 1 - item.y * 2 - 1
  const dist = Math.hypot(dx, dy)
  const r = SPAN * (1 - (1 - p) ** EXPAND)
  if (dist > r) return 1
  return clamp((r - dist) / 1.35 < 1 ? 1 - (r - dist) / 1.35 : 0)
}

function wave(x: number, y: number, frame: Frame, live: boolean) {
  return frame.list.reduce((sum, item) => {
    const age = frame.t - item.at
    if (age < 0 || age > LIFE) return sum
    const p = age / LIFE
    const dx = x + 0.5 - item.x
    const dy = y * 2 + 1 - item.y
    const dist = Math.hypot(dx, dy)
    const r = SPAN * (1 - (1 - p) ** EXPAND)
    const fade = (1 - p) ** 1.32
    const j = 1.02 + noise(x + item.x * 0.7, y + item.y * 0.7, item.at * 0.002 + age * 0.06) * 0.52
    const edge = Math.exp(-(((dist - r) / WIDTH) ** 2)) * GAIN * fade * item.force * j
    const swell = Math.exp(-(((dist - Math.max(0, r - DRIFT)) / WIDE) ** 2)) * SWELL * fade * item.force
    const trail = dist < r ? Math.exp(-(r - dist) / 2.4) * TRAIL * fade * item.force * lerp(0.92, 1.22, j) : 0
    const flash = Math.exp(-(dist * dist) / 3.2) * FLASH * item.force * Math.max(0, 1 - age / 140) * lerp(0.95, 1.18, j)
    const kick = Math.exp(-(dist * dist) / 2) * item.kick * Math.max(0, 1 - age / 100)
    const suck = Math.exp(-(((dist - 1.25) / 0.75) ** 2)) * item.kick * SUCK * Math.max(0, 1 - age / 110)
    const wake = live && dist < r ? Math.exp(-(r - dist) / 1.25) * 0.32 * fade : 0
    return sum + edge + swell + trail + flash + wake - kick - suck
  }, 0)
}

function field(x: number, y: number, frame: Frame) {
  const held = frame.hold
  const rest = frame.release
  const item = held ?? rest
  if (!item) return 0
  const rise = held ? ramp(frame.t - held.at, HOLD, CHARGE) : rest!.rise
  const level = held ? push(rise) : rest!.level
  const body = rise
  const storm = level * level
  const sink = held ? ramp(frame.t - held.at, SINK, CHARGE) : rest!.rise
  const dx = x + 0.5 - item.x - 0.5
  const dy = y * 2 + 1 - item.y * 2 - 1
  const dist = Math.hypot(dx, dy)
  const angle = Math.atan2(dy, dx)
  const spin = frame.t * lerp(0.008, 0.018, storm)
  const dim = lerp(0, DIM, sink) * lerp(0.99, 1.01, 0.5 + 0.5 * Math.sin(frame.t * 0.014))
  const core = Math.exp(-(dist * dist) / Math.max(0.22, lerp(0.22, 3.2, body))) * lerp(0.42, 2.45, body)
  const shell =
    Math.exp(-(((dist - lerp(0.16, 2.05, body)) / Math.max(0.18, lerp(0.18, 0.82, body))) ** 2)) * lerp(0.1, 0.95, body)
  const ember =
    Math.exp(-(((dist - lerp(0.45, 2.65, body)) / Math.max(0.14, lerp(0.14, 0.62, body))) ** 2)) *
    lerp(0.02, 0.78, body)
  const arc = Math.max(0, Math.cos(angle * 3 - spin + frame.spark * 2.2)) ** 8
  const seam = Math.max(0, Math.cos(angle * 5 + spin * 1.55)) ** 12
  const ring = Math.exp(-(((dist - lerp(1.05, 3, level)) / 0.48) ** 2)) * arc * lerp(0.03, 0.5 + ARC, storm)
  const fork = Math.exp(-(((dist - (1.55 + storm * 2.1)) / 0.36) ** 2)) * seam * storm * FORK
  const spark = Math.max(0, noise(x, y, frame.t) - lerp(0.94, 0.66, storm)) * lerp(0, 5.4, storm)
  const glitch = spark * Math.exp(-dist / Math.max(1.2, 3.1 - storm))
  const crack = Math.max(0, Math.cos((dx - dy) * 1.6 + spin * 2.1)) ** 18
  const lash = crack * Math.exp(-(((dist - (1.95 + storm * 2)) / 0.28) ** 2)) * storm * 1.1
  const flicker =
    Math.max(0, noise(item.x * 3.1, item.y * 2.7, frame.t * 1.7) - 0.72) *
    Math.exp(-(dist * dist) / 0.15) *
    lerp(0.08, 0.42, body)
  const fade = frame.release && !frame.hold ? remain(x, y, frame.release, frame.t) : 1
  return (core + shell + ember + ring + fork + glitch + lash + flicker - dim) * fade
}

function pick(x: number, y: number, frame: Frame) {
  const held = frame.hold
  const rest = frame.release
  const item = held ?? rest
  if (!item) return 0
  const rise = held ? ramp(frame.t - held.at, HOLD, CHARGE) : rest!.rise
  const dx = x + 0.5 - item.x - 0.5
  const dy = y * 2 + 1 - item.y * 2 - 1
  const dist = Math.hypot(dx, dy)
  const fade = frame.release && !frame.hold ? remain(x, y, frame.release, frame.t) : 1
  return Math.exp(-(dist * dist) / 1.7) * lerp(0.2, 0.96, rise) * fade
}

function select(x: number, y: number) {
  const direct = MAP.glyph.get(key(x, y))
  if (direct !== undefined) return direct

  const near = NEAR.map(([dx, dy]) => MAP.glyph.get(key(x + dx, y + dy))).find(
    (item): item is number => item !== undefined,
  )
  return near
}

function trace(x: number, y: number, frame: Frame) {
  const held = frame.hold
  const rest = frame.release
  const item = held ?? rest
  if (!item || item.glyph === undefined) return 0
  const step = MAP.trace.get(key(x, y))
  if (!step || step.glyph !== item.glyph || step.l < 2) return 0
  const age = frame.t - item.at
  const rise = held ? ramp(age, HOLD, CHARGE) : rest!.rise
  const appear = held ? ramp(age, 0, TRACE_IN) : 1
  const speed = lerp(TRACE * 0.48, TRACE * 0.88, rise)
  const head = (age * speed) % step.l
  const dist = Math.min(Math.abs(step.i - head), step.l - Math.abs(step.i - head))
  const tail = (head - TAIL + step.l) % step.l
  const lag = Math.min(Math.abs(step.i - tail), step.l - Math.abs(step.i - tail))
  const fade = frame.release && !frame.hold ? remain(x, y, frame.release, frame.t) : 1
  const core = Math.exp(-((dist / 1.05) ** 2)) * lerp(0.8, 2.35, rise)
  const glow = Math.exp(-((dist / 1.85) ** 2)) * lerp(0.08, 0.34, rise)
  const trail = Math.exp(-((lag / 1.45) ** 2)) * lerp(0.04, 0.42, rise)
  return (core + glow + trail) * appear * fade
}

function bloom(x: number, y: number, frame: Frame) {
  const item = frame.glow
  if (!item) return 0
  const glyph = MAP.glyph.get(key(x, y))
  if (glyph !== item.glyph) return 0
  const age = frame.t - item.at
  if (age < 0 || age > GLOW_OUT) return 0
  const p = age / GLOW_OUT
  const flash = (1 - p) ** 2
  const dx = x + 0.5 - MAP.center.get(item.glyph)!.x
  const dy = y * 2 + 1 - MAP.center.get(item.glyph)!.y
  const bias = Math.exp(-((Math.hypot(dx, dy) / 2.8) ** 2))
  return lerp(item.force, item.force * 0.18, p) * lerp(0.72, 1.1, bias) * flash
}

export function Logo() {
  const { theme } = useTheme()
  const [rings, setRings] = createSignal<Ring[]>([])
  const [hold, setHold] = createSignal<Hold>()
  const [release, setRelease] = createSignal<Release>()
  const [glow, setGlow] = createSignal<Glow>()
  const [now, setNow] = createSignal(0)
  let box: BoxRenderable | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let hum = false

  const stop = () => {
    if (!timer) return
    clearInterval(timer)
    timer = undefined
  }

  const tick = () => {
    const t = performance.now()
    setNow(t)
    const item = hold()
    if (item && !hum && t - item.at >= HOLD) {
      hum = true
      Sound.start()
    }
    if (item && t - item.at >= CHARGE) {
      burst(item.x, item.y)
    }
    let live = false
    setRings((list) => {
      const next = list.filter((item) => t - item.at < LIFE)
      live = next.length > 0
      return next
    })
    const flash = glow()
    if (flash && t - flash.at >= GLOW_OUT) {
      setGlow(undefined)
    }
    if (!live) setRelease(undefined)
    if (live || hold() || release() || glow()) return
    stop()
  }

  const start = () => {
    if (timer) return
    timer = setInterval(tick, 16)
  }

  const hit = (x: number, y: number) => {
    const char = FULL[y]?.[x]
    return char !== undefined && char !== " "
  }

  const press = (x: number, y: number, t: number) => {
    const last = hold()
    if (last) burst(last.x, last.y)
    setNow(t)
    if (!last) setRelease(undefined)
    setHold({ x, y, at: t, glyph: select(x, y) })
    hum = false
    start()
  }

  const burst = (x: number, y: number) => {
    const item = hold()
    if (!item) return
    hum = false
    const t = performance.now()
    const age = t - item.at
    const rise = ramp(age, HOLD, CHARGE)
    const level = push(rise)
    setHold(undefined)
    setRelease({ x, y, at: t, glyph: item.glyph, level, rise })
    if (item.glyph !== undefined) {
      setGlow({ glyph: item.glyph, at: t, force: lerp(0.18, 1.5, rise * level) })
    }
    setRings((list) => [
      ...list,
      {
        x: x + 0.5,
        y: y * 2 + 1,
        at: t,
        force: lerp(0.82, 2.55, level),
        kick: lerp(0.32, 0.32 + KICK, level),
      },
    ])
    setNow(t)
    start()
    Sound.pulse(lerp(0.8, 1, level))
  }

  const frame = createMemo(() => {
    const t = now()
    const item = hold()
    return {
      t,
      list: rings(),
      hold: item,
      release: release(),
      glow: glow(),
      spark: item ? noise(item.x, item.y, t) : 0,
    }
  })

  const dusk = createMemo(() => {
    const base = frame()
    const t = base.t - LAG
    const item = base.hold
    return {
      t,
      list: base.list,
      hold: item,
      release: base.release,
      glow: base.glow,
      spark: item ? noise(item.x, item.y, t) : 0,
    }
  })

  const renderLine = (
    line: string,
    y: number,
    ink: RGBA,
    bold: boolean,
    off: number,
    frame: Frame,
    dusk: Frame,
  ): JSX.Element[] => {
    const shadow = tint(theme.background, ink, 0.25)
    const attrs = bold ? TextAttributes.BOLD : undefined

    return Array.from(line).map((char, i) => {
      const h = field(off + i, y, frame)
      const n = wave(off + i, y, frame, lit(char)) + h
      const s = wave(off + i, y, dusk, false) + h
      const p = lit(char) ? pick(off + i, y, frame) : 0
      const e = lit(char) ? trace(off + i, y, frame) : 0
      const b = lit(char) ? bloom(off + i, y, frame) : 0
      const q = shimmer(off + i, y, frame)

      if (char === "_") {
        return (
          <text
            fg={shade(ink, theme, s * 0.08)}
            bg={shade(shadow, theme, ghost(s, 0.24) + ghost(q, 0.06))}
            attributes={attrs}
            selectable={false}
          >
            {" "}
          </text>
        )
      }

      if (char === "^") {
        return (
          <text
            fg={shade(ink, theme, n + p + e + b)}
            bg={shade(shadow, theme, ghost(s, 0.18) + ghost(q, 0.05) + ghost(b, 0.08))}
            attributes={attrs}
            selectable={false}
          >
            ▀
          </text>
        )
      }

      if (char === "~") {
        return (
          <text fg={shade(shadow, theme, ghost(s, 0.22) + ghost(q, 0.05))} attributes={attrs} selectable={false}>
            ▀
          </text>
        )
      }

      if (char === " ") {
        return (
          <text fg={ink} attributes={attrs} selectable={false}>
            {char}
          </text>
        )
      }

      return (
        <text fg={shade(ink, theme, n + p + e + b)} attributes={attrs} selectable={false}>
          {char}
        </text>
      )
    })
  }

  onCleanup(() => {
    stop()
    hum = false
    Sound.dispose()
  })

  const mouse = (evt: MouseEvent) => {
    if (!box) return
    if ((evt.type === "down" || evt.type === "drag") && evt.button === MouseButton.LEFT) {
      const x = evt.x - box.x
      const y = evt.y - box.y
      if (!hit(x, y)) return
      if (evt.type === "drag" && hold()) return
      evt.preventDefault()
      evt.stopPropagation()
      const t = performance.now()
      press(x, y, t)
      return
    }

    if (!hold()) return
    if (evt.type === "up") {
      const item = hold()
      if (!item) return
      burst(item.x, item.y)
    }
  }

  return (
    <box ref={(item: BoxRenderable) => (box = item)}>
      <box
        position="absolute"
        top={0}
        left={0}
        width={FULL[0]?.length ?? 0}
        height={FULL.length}
        zIndex={1}
        onMouse={mouse}
      />
      <For each={logo.left}>
        {(line, index) => (
          <box flexDirection="row" gap={1}>
            <box flexDirection="row">{renderLine(line, index(), theme.textMuted, false, 0, frame(), dusk())}</box>
            <box flexDirection="row">
              {renderLine(logo.right[index()], index(), theme.text, true, LEFT + GAP, frame(), dusk())}
            </box>
          </box>
        )}
      </For>
    </box>
  )
}
