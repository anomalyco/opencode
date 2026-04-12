import { BoxRenderable, MouseEvent, RGBA, TextAttributes } from "@opentui/core"
import { For, createSignal, onCleanup, type JSX } from "solid-js"
import { useTheme, tint } from "@tui/context/theme"
import { logo } from "@/cli/logo"

// Shadow markers (rendered chars in parens):
// _ = full shadow cell (space with bg=shadow)
// ^ = letter top, shadow bottom (▀ with fg=letter, bg=shadow)
// ~ = shadow top only (▀ with fg=shadow)
const GAP = 1
const WIDTH = 0.82
const GAIN = 2.05
const FLASH = 2.2
const TRAIL = 0.32
const SWELL = 0.34
const WIDE = 2.1
const DRIFT = 1.8
const LIFE = 1050
const CHARGE = 3000
const HOLD = 90
const ARC = 2.4
const FORK = 1.45
const DIM = 0.92
const KICK = 0.9
const LAG = 55
const SUCK = 0.42
const PEAK = RGBA.fromInts(255, 255, 255)
const COUNT = 16
const RIM = 4

type Ring = {
  x: number
  y: number
  at: number
  force: number
  kick: number
  wash: number
}

type Charge = {
  x: number
  y: number
  at: number
}

type Frame = {
  t: number
  list: Ring[]
  hold: Charge | undefined
  spark: number
}

type Dust = {
  force: number
}

const LEFT = logo.left[0]?.length ?? 0
const FULL = logo.left.map((line, i) => line + " ".repeat(GAP) + logo.right[i])
const SPAN = Math.hypot(FULL[0]?.length ?? 0, FULL.length * 2) * 0.92

function glow(base: RGBA, theme: ReturnType<typeof useTheme>["theme"], n: number) {
  const mid = tint(base, theme.primary, 0.7)
  const top = tint(theme.primary, PEAK, 0.88)
  if (n <= 1) return tint(base, mid, Math.min(1, Math.sqrt(Math.max(0, n))))
  return tint(mid, top, Math.min(1, 1 - Math.exp(-1.6 * (n - 1))))
}

function shade(base: RGBA, theme: ReturnType<typeof useTheme>["theme"], n: number) {
  if (n >= 0) return glow(base, theme, n)
  return tint(base, theme.background, Math.min(0.7, -n * 0.55))
}

function noise(x: number, y: number, t: number) {
  const n = Math.sin(x * 12.9898 + y * 78.233 + t * 0.043) * 43758.5453
  return n - Math.floor(n)
}

function lit(char: string) {
  return char !== " " && char !== "_" && char !== "~"
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

function pull(x: number, y: number, frame: Frame): Dust | undefined {
  if (!frame.hold) return
  const age = frame.t - frame.hold.at
  const level = push(ramp(age, HOLD, CHARGE))
  if (level <= 0.04) return
  const px = x + 0.5
  const py = y * 2 + 1
  const cx = frame.hold.x + 0.5
  const cy = frame.hold.y * 2 + 1

  const best = Array.from({ length: Math.max(6, Math.round(lerp(6, COUNT, level))) }, (_, i) => {
    const seed = noise(frame.hold!.x * 9 + i * 3.1, frame.hold!.y * 7 - i * 2.7, 0)
    const span = SPAN + RIM + noise(i, seed * 10, 0) * 5
    const angle = seed * Math.PI * 2 + i * 0.61
    const rate = lerp(0.00022, 0.00052, level) * lerp(0.85, 1.25, noise(i * 2, seed * 3, 0))
    const phase = (((age * rate + seed) % 1) + 1) % 1
    const t = ease(phase)
    const rx = cx + Math.cos(angle) * lerp(span, 0.3, t)
    const ry = cy + Math.sin(angle) * lerp(span * 0.52, 0.15, t)
    const dist = Math.hypot(px - rx, py - ry)
    const force = Math.exp(-((dist / 0.72) ** 2)) * lerp(0.18, 1.35, level) * lerp(0.8, 1.25, 1 - phase)
    if (force < 0.05) return undefined
    return { force }
  }).reduce(
    (best, item) => {
      if (!item) return best
      if (!best || item.force > best.force) return item
      return best
    },
    undefined as Dust | undefined,
  )

  return best
}

export function Logo() {
  const { theme } = useTheme()
  const [rings, setRings] = createSignal<Ring[]>([])
  const [charge, setCharge] = createSignal<Charge>()
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
    const hold = charge()
    if (hold && t - hold.at >= CHARGE) {
      burst(hold.x, hold.y)
    }
    let alive = false
    setRings((list) => {
      const next = list.filter((item) => t - item.at < LIFE)
      alive = next.length > 0
      return next
    })
    if (alive || charge()) return
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

  const pulse = (x: number, y: number, force: number, kick: number, wash: number) => {
    const t = performance.now()
    setNow(t)
    setRings((list) => [...list, { x: x + 0.5, y: y * 2 + 1, at: t, force, kick, wash }])
    start()
  }

  const burst = (x: number, y: number) => {
    const item = charge()
    if (!item) return
    const t = performance.now()
    const age = t - item.at
    const rise = ramp(age, HOLD, CHARGE)
    const level = push(rise)
    setCharge(undefined)
    const force = lerp(1, 2.45, level)
    const kick = lerp(0.35, 0.35 + KICK, level)
    const wash = lerp(0, 0.72, rise)
    pulse(x, y, force, kick, wash)
  }

  const bright = (x: number, y: number, frame: Frame, live: boolean) => {
    const pulse = frame.list.reduce((sum, item) => {
      const age = frame.t - item.at
      if (age < 0 || age > LIFE) return sum
      const p = age / LIFE
      const dx = x + 0.5 - item.x
      const dy = y * 2 + 1 - item.y
      const dist = Math.hypot(dx, dy)
      const r = SPAN * (1 - (1 - p) ** 1.45)
      const fade = (1 - p) ** 1.35
      const d = (dist - r) / WIDTH
      const s = (dist - Math.max(0, r - DRIFT)) / WIDE
      const ring = Math.exp(-(d * d)) * GAIN * fade * item.force
      const swell = Math.exp(-(s * s)) * SWELL * fade * item.force
      const trail = dist < r ? Math.exp(-(r - dist) / 2.8) * TRAIL * fade * item.force : 0
      const flash = Math.exp(-(dist * dist) / 3.4) * FLASH * item.force * Math.max(0, 1 - age / 150)
      const kick = Math.exp(-(dist * dist) / 2.1) * item.kick * Math.max(0, 1 - age / 120)
      const suck = Math.exp(-(((dist - 1.35) / 0.8) ** 2)) * item.kick * SUCK * Math.max(0, 1 - age / 110)
      const wipe = item.wash * (r < dist ? 1 : Math.max(0, 1 - (r - dist) / 1.35))
      const wake = live && r > dist ? Math.exp(-(r - dist) / 1.25) * Math.max(0, 1 - (r - dist) / 4.5) * 0.42 * fade : 0
      return sum + ring + swell + trail + flash + wake - kick - suck - wipe
    }, 0)

    if (!frame.hold) return pulse
    const age = frame.t - frame.hold.at
    const rise = ramp(age, HOLD, CHARGE)
    const level = push(rise)
    const body = Math.sqrt(level)
    const storm = level * level
    const dx = x + 0.5 - frame.hold.x - 0.5
    const dy = y * 2 + 1 - frame.hold.y * 2 - 1
    const dist = Math.hypot(dx, dy)
    const angle = Math.atan2(dy, dx)
    const spin = frame.t * lerp(0.009, 0.019, storm)
    const sink = lerp(0, DIM, body) * lerp(0.98, 1.02, 0.5 + 0.5 * Math.sin(frame.t * 0.016))
    const core = Math.exp(-(dist * dist) / Math.max(0.7, lerp(0.7, 4.2, body))) * lerp(0.16, 2.5, body)
    const shell =
      Math.exp(-(((dist - lerp(0.18, 2.5, body)) / Math.max(0.45, lerp(0.45, 1.05, body))) ** 2)) *
      lerp(0.02, 1.1, body)
    const arc = Math.max(0, Math.cos(angle * 3 - spin + frame.spark * 2.4)) ** 8
    const seam = Math.max(0, Math.cos(angle * 5 + spin * 1.6)) ** 12
    const ring = Math.exp(-(((dist - lerp(1.1, 3.1, level)) / 0.5) ** 2)) * arc * lerp(0.08, 0.55 + ARC, storm)
    const fork = Math.exp(-(((dist - (1.7 + storm * 2.2)) / 0.38) ** 2)) * seam * storm * FORK
    const spark = Math.max(0, noise(x, y, frame.t) - lerp(0.9, 0.62, storm)) * lerp(0, 7.2, storm)
    const glitch = spark * Math.exp(-dist / Math.max(1.2, 3.2 - storm))
    const crack = Math.max(0, Math.cos((dx - dy) * 1.7 + spin * 2.2)) ** 18
    const lash = crack * Math.exp(-(((dist - (2 + storm * 2.2)) / 0.3) ** 2)) * storm * 1.35
    const flicker =
      Math.max(0, noise(frame.hold.x * 3.1, frame.hold.y * 2.7, frame.t * 1.8) - 0.66) *
      Math.exp(-(dist * dist) / 0.2) *
      lerp(0, 0.75, body)
    return pulse + core + shell + ring + fork + glitch + lash + flicker - sink
  }

  const renderLine = (line: string, y: number, fg: RGBA, bold: boolean, off: number): JSX.Element[] => {
    const shadow = tint(theme.background, fg, 0.25)
    const attrs = bold ? TextAttributes.BOLD : undefined
    const t = now()
    const list = rings()
    const hold = charge()
    const frame = {
      t,
      list,
      hold,
      spark: hold ? noise(hold.x, hold.y, t) : 0,
    }
    const dusk = {
      t: t - LAG,
      list,
      hold,
      spark: hold ? noise(hold.x, hold.y, t - LAG) : 0,
    }
    return [...line].map((char, i) => {
      const n = bright(off + i, y, frame, lit(char))
      const s = bright(off + i, y, dusk, false)
      const dust = pull(off + i, y, frame)
      const mote = dust?.force ?? 0
      const glow = mote * 0.4
      const wash = mote * 0.85
      if (char === "_") {
        return (
          <text
            fg={shade(fg, theme, s * 0.22 + glow * 0.2)}
            bg={shade(shadow, theme, s * 0.5 + wash)}
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
            fg={shade(fg, theme, n + glow)}
            bg={shade(shadow, theme, s * 0.4 + wash * 0.75)}
            attributes={attrs}
            selectable={false}
          >
            ▀
          </text>
        )
      }

      if (char === "~") {
        return (
          <text
            fg={shade(shadow, theme, s * 0.52 + glow * 0.55)}
            bg={mote > 0.08 ? shade(theme.background, theme, wash * 0.8) : undefined}
            attributes={attrs}
            selectable={false}
          >
            ▀
          </text>
        )
      }

      if (char === " ") {
        return (
          <text
            fg={fg}
            bg={mote > 0.08 ? shade(theme.background, theme, wash) : undefined}
            attributes={attrs}
            selectable={false}
          >
            {char}
          </text>
        )
      }

      return (
        <text
          fg={shade(fg, theme, n + glow)}
          bg={mote > 0.08 ? shade(theme.background, theme, wash * 0.7) : undefined}
          attributes={attrs}
          selectable={false}
        >
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
      setCharge({ x, y, at: t })
      start()
      return
    }

    if (!charge()) return
    if (evt.type === "up" || evt.type === "drag-end" || evt.type === "drop" || evt.type === "out") {
      const item = charge()
      if (!item) return
      burst(item.x, item.y)
    }
  }

  return (
    <box ref={(item: BoxRenderable) => (box = item)} onMouse={mouse}>
      <For each={logo.left}>
        {(line, index) => (
          <box flexDirection="row" gap={1}>
            <box flexDirection="row">{renderLine(line, index(), theme.textMuted, false, 0)}</box>
            <box flexDirection="row">{renderLine(logo.right[index()], index(), theme.text, true, LEFT + GAP)}</box>
          </box>
        )}
      </For>
    </box>
  )
}
