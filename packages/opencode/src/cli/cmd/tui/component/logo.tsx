import { BoxRenderable, MouseEvent, RGBA, TextAttributes } from "@opentui/core"
import { For, createMemo, createSignal, onCleanup, type JSX } from "solid-js"
import { useTheme, tint } from "@tui/context/theme"
import { logo } from "@/cli/logo"

// Shadow markers (rendered chars in parens):
// _ = full shadow cell (space with bg=shadow)
// ^ = letter top, shadow bottom (▀ with fg=letter, bg=shadow)
// ~ = shadow top only (▀ with fg=shadow)
const GAP = 1
const WIDTH = 0.76
const GAIN = 2.1
const FLASH = 1.9
const TRAIL = 0.24
const SWELL = 0.24
const WIDE = 1.85
const DRIFT = 1.45
const LIFE = 1020
const CHARGE = 2000
const HOLD = 90
const ARC = 2.2
const FORK = 1.2
const DIM = 1.04
const KICK = 0.86
const LAG = 60
const SUCK = 0.34
const PEAK = RGBA.fromInts(255, 255, 255)

type Ring = {
  x: number
  y: number
  at: number
  force: number
  kick: number
  wash: number
}

type Hold = {
  x: number
  y: number
  at: number
}

type Frame = {
  t: number
  list: Ring[]
  hold: Hold | undefined
  spark: number
}

const LEFT = logo.left[0]?.length ?? 0
const FULL = logo.left.map((line, i) => line + " ".repeat(GAP) + logo.right[i])
const SPAN = Math.hypot(FULL[0]?.length ?? 0, FULL.length * 2) * 0.94

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
  const mid = tint(base, theme.primary, 0.72)
  const top = tint(theme.primary, PEAK, 0.9)
  if (n <= 1) return tint(base, mid, Math.min(1, Math.sqrt(Math.max(0, n))))
  return tint(mid, top, Math.min(1, 1 - Math.exp(-1.7 * (n - 1))))
}

function shade(base: RGBA, theme: ReturnType<typeof useTheme>["theme"], n: number) {
  if (n >= 0) return glow(base, theme, n)
  return tint(base, theme.background, Math.min(0.82, -n * 0.64))
}

function noise(x: number, y: number, t: number) {
  const n = Math.sin(x * 12.9898 + y * 78.233 + t * 0.043) * 43758.5453
  return n - Math.floor(n)
}

function lit(char: string) {
  return char !== " " && char !== "_" && char !== "~"
}

function wave(x: number, y: number, frame: Frame, live: boolean) {
  return frame.list.reduce((sum, item) => {
    const age = frame.t - item.at
    if (age < 0 || age > LIFE) return sum
    const p = age / LIFE
    const dx = x + 0.5 - item.x
    const dy = y * 2 + 1 - item.y
    const dist = Math.hypot(dx, dy)
    const r = SPAN * (1 - (1 - p) ** 1.42)
    const fade = (1 - p) ** 1.32
    const edge = Math.exp(-(((dist - r) / WIDTH) ** 2)) * GAIN * fade * item.force
    const swell = Math.exp(-(((dist - Math.max(0, r - DRIFT)) / WIDE) ** 2)) * SWELL * fade * item.force
    const trail = dist < r ? Math.exp(-(r - dist) / 2.4) * TRAIL * fade * item.force : 0
    const flash = Math.exp(-(dist * dist) / 3.2) * FLASH * item.force * Math.max(0, 1 - age / 140)
    const kick = Math.exp(-(dist * dist) / 2) * item.kick * Math.max(0, 1 - age / 100)
    const suck = Math.exp(-(((dist - 1.25) / 0.75) ** 2)) * item.kick * SUCK * Math.max(0, 1 - age / 110)
    const wipe = item.wash * (dist > r ? 1 : Math.max(0, 1 - (r - dist) / 1.5))
    const wake = live && dist < r ? Math.exp(-(r - dist) / 1.25) * 0.32 * fade : 0
    return sum + edge + swell + trail + flash + wake - kick - suck - wipe
  }, 0)
}

function field(x: number, y: number, frame: Frame) {
  const item = frame.hold
  if (!item) return 0
  const age = frame.t - item.at
  const rise = ramp(age, HOLD, CHARGE)
  const level = push(rise)
  const body = rise
  const storm = level * level
  const dx = x + 0.5 - item.x - 0.5
  const dy = y * 2 + 1 - item.y * 2 - 1
  const dist = Math.hypot(dx, dy)
  const angle = Math.atan2(dy, dx)
  const spin = frame.t * lerp(0.008, 0.018, storm)
  const sink = lerp(0, DIM, body) * lerp(0.99, 1.01, 0.5 + 0.5 * Math.sin(frame.t * 0.014))
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
  return core + shell + ember + ring + fork + glitch + lash + flicker - sink
}

function pick(x: number, y: number, frame: Frame) {
  const item = frame.hold
  if (!item) return 0
  const age = frame.t - item.at
  const rise = ramp(age, HOLD, CHARGE)
  const dx = x + 0.5 - item.x - 0.5
  const dy = y * 2 + 1 - item.y * 2 - 1
  const dist = Math.hypot(dx, dy)
  return Math.exp(-(dist * dist) / 1.2) * lerp(0.16, 0.7, rise)
}

export function Logo() {
  const { theme } = useTheme()
  const [rings, setRings] = createSignal<Ring[]>([])
  const [hold, setHold] = createSignal<Hold>()
  const [now, setNow] = createSignal(0)
  let box: BoxRenderable | undefined
  let timer: ReturnType<typeof setInterval> | undefined

  const stop = () => {
    if (!timer) return
    clearInterval(timer)
    timer = undefined
  }

  const tick = () => {
    const t = performance.now()
    setNow(t)
    const item = hold()
    if (item && t - item.at >= CHARGE) {
      burst(item.x, item.y)
    }
    let live = false
    setRings((list) => {
      const next = list.filter((item) => t - item.at < LIFE)
      live = next.length > 0
      return next
    })
    if (live || hold()) return
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

  const burst = (x: number, y: number) => {
    const item = hold()
    if (!item) return
    const t = performance.now()
    const age = t - item.at
    const rise = ramp(age, HOLD, CHARGE)
    const level = push(rise)
    setHold(undefined)
    setRings((list) => [
      ...list,
      {
        x: x + 0.5,
        y: y * 2 + 1,
        at: t,
        force: lerp(1, 2.55, level),
        kick: lerp(0.32, 0.32 + KICK, level),
        wash: lerp(0, 0.88, rise),
      },
    ])
    setNow(t)
    start()
  }

  const frame = createMemo(() => {
    const t = now()
    const item = hold()
    return {
      t,
      list: rings(),
      hold: item,
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

    return [...line].map((char, i) => {
      const h = field(off + i, y, frame)
      const n = wave(off + i, y, frame, lit(char)) + h
      const s = wave(off + i, y, dusk, false) + h
      const p = lit(char) ? pick(off + i, y, frame) : 0

      if (char === "_") {
        return (
          <text
            fg={shade(ink, theme, s * 0.08)}
            bg={shade(shadow, theme, s * 0.24)}
            attributes={attrs}
            selectable={false}
          >
            {" "}
          </text>
        )
      }

      if (char === "^") {
        return (
          <text fg={shade(ink, theme, n + p)} bg={shade(shadow, theme, s * 0.18)} attributes={attrs} selectable={false}>
            ▀
          </text>
        )
      }

      if (char === "~") {
        return (
          <text fg={shade(shadow, theme, s * 0.22)} attributes={attrs} selectable={false}>
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
        <text fg={shade(ink, theme, n + p)} attributes={attrs} selectable={false}>
          {char}
        </text>
      )
    })
  }

  onCleanup(stop)

  const mouse = (evt: MouseEvent) => {
    if (!box) return
    if (evt.type === "down") {
      if (evt.button !== 0) return
      const x = evt.x - box.x
      const y = evt.y - box.y
      if (!hit(x, y)) return
      evt.preventDefault()
      evt.stopPropagation()
      const t = performance.now()
      setNow(t)
      setHold({ x, y, at: t })
      start()
      return
    }

    if (!hold()) return
    if (evt.type === "up" || evt.type === "drag-end" || evt.type === "drop" || evt.type === "out") {
      const item = hold()
      if (!item) return
      burst(item.x, item.y)
    }
  }

  return (
    <box ref={(item: BoxRenderable) => (box = item)} onMouse={mouse}>
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
