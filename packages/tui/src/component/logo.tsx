import { RGBA, TextAttributes } from "@opentui/core"
import { createEffect, createSignal, For, onCleanup, onMount, type JSX } from "solid-js"
import { tint, useTheme } from "../context/theme"
import { useKV } from "../context/kv"
import { logo } from "../logo"

export function Logo() {
  const { theme } = useTheme()
  const kv = useKV()
  const [animationsEnabled] = kv.signal("animations_enabled", true)
  const [elapsed, setElapsed] = createSignal(animationsEnabled() ? 0 : DURATION)
  let timer: NodeJS.Timeout | undefined
  let start = 0

  onMount(() => {
    start = performance.now()
    if (!animationsEnabled()) {
      setElapsed(DURATION)
      return
    }
    timer = setInterval(() => {
      const now = performance.now() - start
      if (now >= DURATION) {
        setElapsed(DURATION)
        if (timer) {
          clearInterval(timer)
          timer = undefined
        }
        return
      }
      setElapsed(now)
    }, FRAME_MS)
    if (typeof timer.unref === "function") timer.unref()
  })

  onCleanup(() => {
    if (timer) clearInterval(timer)
  })

  createEffect(() => {
    if (!animationsEnabled()) setElapsed(DURATION)
  })

  return (
    <box>
      <For each={logo.left}>
        {(line, index) => (
          <box flexDirection="row" gap={1}>
            <box flexDirection="row">
              {renderLine(line, index(), "left", theme.textMuted, false, theme.background, theme.primary, elapsed())}
            </box>
            <box flexDirection="row">
              {renderLine(
                logo.right[index()] ?? "",
                index(),
                "right",
                theme.text,
                true,
                theme.background,
                theme.primary,
                elapsed(),
              )}
            </box>
          </box>
        )}
      </For>
    </box>
  )
}

const DURATION = 1050
const FRAME_MS = 16
const START = -0.05
const END = 1.7
const REVEAL_SOFT = 0.5
const GLOW_SHARP = 0.13
const GLOW_SOFT = 0.38
const ASPECT = 2

type Side = "left" | "right"

const LEFT_WIDTH = logo.left[0]?.length ?? 0
const RIGHT_WIDTH = logo.right[0]?.length ?? 0
const LOGO_WIDTH = LEFT_WIDTH + 1 + RIGHT_WIDTH
const LOGO_HEIGHT = logo.left.length
const CENTER_X = (LOGO_WIDTH - 1) / 2
const CENTER_Y = (LOGO_HEIGHT - 1) / 2
const MAX_RADIUS = Math.hypot(
  Math.max(CENTER_X, LOGO_WIDTH - 1 - CENTER_X),
  Math.max(CENTER_Y, LOGO_HEIGHT - 1 - CENTER_Y) * ASPECT,
)

type Field = {
  radius: number
  angle: number
}

function key(row: number, side: Side, col: number): string {
  return `${row}:${side}:${col}`
}

function buildField(): Map<string, Field> {
  const field = new Map<string, Field>()
  for (let row = 0; row < LOGO_HEIGHT; row += 1) {
    const left = logo.left[row] ?? ""
    const right = logo.right[row] ?? ""
    const push = (side: Side, col: number, x: number) => {
      const dx = x - CENTER_X
      const dy = (row - CENTER_Y) * ASPECT
      field.set(key(row, side, col), {
        radius: Math.hypot(dx, dy) / MAX_RADIUS,
        angle: Math.atan2(dy, dx),
      })
    }
    Array.from(left).forEach((char, col) => {
      if (char === " ") return
      push("left", col, col)
    })
    Array.from(right).forEach((char, col) => {
      if (char === " ") return
      push("right", col, LEFT_WIDTH + 1 + col)
    })
  }
  return field
}

const FIELD = buildField()

function smoothstep(x: number): number {
  const t = x <= 0 ? 0 : x >= 1 ? 1 : x
  return t * t * (3 - 2 * t)
}

function sample(front: number, field: Field) {
  const swirl = 0.05 * Math.sin(field.angle * 3 + front * 6) + 0.025 * Math.sin(field.angle * 7 - front * 4)
  const local = front - (field.radius + swirl)
  return {
    intensity: smoothstep(local / REVEAL_SOFT),
    glow: Math.min(1, Math.exp(-((local / GLOW_SHARP) ** 2)) * 0.9 + Math.exp(-((local / GLOW_SOFT) ** 2)) * 0.4),
  }
}

function renderLine(
  line: string,
  row: number,
  side: Side,
  fg: RGBA,
  bold: boolean,
  background: RGBA,
  primary: RGBA,
  elapsed: number,
): JSX.Element[] {
  const attrs = bold ? TextAttributes.BOLD : undefined
  const settled = elapsed >= DURATION
  const front = START + (END - START) * smoothstep(elapsed / DURATION)
  const shadowBase = tint(background, fg, 0.25)

  return Array.from(line).map((char, col) => {
    if (char === " ") {
      return (
        <text selectable={false}>
          {" "}
        </text>
      )
    }

    const field = FIELD.get(key(row, side, col))
    const { intensity, glow } = field ? sample(front, field) : { intensity: 1, glow: 0 }
    const g = settled ? 0 : glow
    const paint = tint(tint(background, fg, intensity), primary, g)
    const shadow = tint(tint(background, shadowBase, intensity), primary, g * 0.5)

    if (char === "_") {
      return (
        <text fg={shadow} bg={shadow} attributes={attrs} selectable={false}>
          {" "}
        </text>
      )
    }
    if (char === "^") {
      return (
        <text fg={paint} bg={shadow} attributes={attrs} selectable={false}>
          ▀
        </text>
      )
    }
    if (char === "~") {
      return (
        <text fg={shadow} attributes={attrs} selectable={false}>
          ▀
        </text>
      )
    }
    if (char === ",") {
      return (
        <text fg={shadow} attributes={attrs} selectable={false}>
          ▄
        </text>
      )
    }
    return (
      <text fg={paint} attributes={attrs} selectable={false}>
        {char}
      </text>
    )
  })
}
