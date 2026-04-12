import { BoxRenderable, MouseEvent, RGBA, TextAttributes } from "@opentui/core"
import { For, createSignal, onCleanup, type JSX } from "solid-js"
import { useTheme, tint } from "@tui/context/theme"
import { logo } from "@/cli/logo"

// Shadow markers (rendered chars in parens):
// _ = full shadow cell (space with bg=shadow)
// ^ = letter top, shadow bottom (▀ with fg=letter, bg=shadow)
// ~ = shadow top only (▀ with fg=shadow)
const GAP = 1
const WIDTH = 1.15
const GAIN = 1.7
const FLASH = 2.2
const TRAIL = 0.75
const SWELL = 0.95
const WIDE = 2.8
const DRIFT = 1.8
const LIFE = 1050
const CHARGE = 900
const PEAK = RGBA.fromInts(255, 255, 255)

type Ring = {
  x: number
  y: number
  at: number
  force: number
}

type Charge = {
  x: number
  y: number
  at: number
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

function noise(x: number, y: number, t: number) {
  const n = Math.sin(x * 12.9898 + y * 78.233 + t * 0.043) * 43758.5453
  return n - Math.floor(n)
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

  const pulse = (x: number, y: number, force: number) => {
    const t = performance.now()
    setNow(t)
    setRings((list) => [...list, { x: x + 0.5, y: y * 2 + 1, at: t, force }])
    start()
  }

  const burst = (x: number, y: number) => {
    const item = charge()
    if (!item) return
    const level = Math.min(1, (performance.now() - item.at) / CHARGE)
    setCharge(undefined)
    pulse(x, y, 1 + level * 1.35)
  }

  const bright = (x: number, y: number, t: number, list: Ring[], hold?: Charge) => {
    const pulse = list.reduce((sum, item) => {
      const age = t - item.at
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
      return sum + ring + swell + trail + flash
    }, 0)

    if (!hold) return pulse
    const level = Math.min(1, (t - hold.at) / CHARGE)
    const dx = x + 0.5 - hold.x - 0.5
    const dy = y * 2 + 1 - hold.y * 2 - 1
    const dist = Math.hypot(dx, dy)
    const core = Math.exp(-(dist * dist) / Math.max(1.2, 5 - level * 2.2)) * (0.85 + level * 2.8)
    const shell = Math.exp(-(((dist - (0.9 + level * 1.8)) / Math.max(0.7, 1.5 - level * 0.5)) ** 2)) * (0.4 + level)
    const spark = Math.max(0, noise(x, y, t) - (0.83 - level * 0.18)) * (1 + level * 4.5)
    const glitch = spark * Math.exp(-dist / Math.max(1.2, 3.2 - level))
    return pulse + core + shell + glitch
  }

  const renderLine = (line: string, y: number, fg: RGBA, bold: boolean, off: number): JSX.Element[] => {
    const shadow = tint(theme.background, fg, 0.25)
    const attrs = bold ? TextAttributes.BOLD : undefined
    const t = now()
    const list = rings()
    const hold = charge()
    return [...line].map((char, i) => {
      const n = bright(off + i, y, t, list, hold)
      if (char === "_") {
        return (
          <text fg={glow(fg, theme, n * 0.35)} bg={glow(shadow, theme, n * 0.6)} attributes={attrs} selectable={false}>
            {" "}
          </text>
        )
      }

      if (char === "^") {
        return (
          <text fg={glow(fg, theme, n)} bg={glow(shadow, theme, n * 0.45)} attributes={attrs} selectable={false}>
            ▀
          </text>
        )
      }

      if (char === "~") {
        return (
          <text fg={glow(shadow, theme, n * 0.6)} attributes={attrs} selectable={false}>
            ▀
          </text>
        )
      }

      if (char === " ") {
        return (
          <text fg={fg} attributes={attrs} selectable={false}>
            {char}
          </text>
        )
      }

      return (
        <text fg={glow(fg, theme, n)} attributes={attrs} selectable={false}>
          {char}
        </text>
      )
    })
  }

  onCleanup(stop)

  return (
    <box
      ref={(item: BoxRenderable) => (box = item)}
      onMouseDown={(evt: MouseEvent) => {
        if (!box) return
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
      }}
      onMouseUp={() => {
        const item = charge()
        if (!item) return
        burst(item.x, item.y)
      }}
      onMouseDragEnd={() => {
        const item = charge()
        if (!item) return
        burst(item.x, item.y)
      }}
      onMouseDrop={() => {
        const item = charge()
        if (!item) return
        burst(item.x, item.y)
      }}
    >
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
