import { RGBA } from "@opentui/core"
import { useTimeline } from "@opentui/solid"
import { createSignal, createEffect, onCleanup, For } from "solid-js"
import { useTheme } from "@tui/context/theme"
import type { JSX } from "@opentui/solid"

/**
 * Animated spinner for tool execution
 */
export function Spinner(props: { color?: RGBA; speed?: number }) {
  const { theme } = useTheme()
  const color = props.color ?? theme.accent
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
  const [frame, setFrame] = createSignal(0)

  const interval = setInterval(() => {
    setFrame((prev) => (prev + 1) % frames.length)
  }, props.speed ?? 80)

  onCleanup(() => clearInterval(interval))

  return <span style={{ fg: color }}>{frames[frame()]}</span>
}

/**
 * Pulsing dot indicator for active tools
 */
export function PulsingDot(props: { color?: RGBA }) {
  const { theme } = useTheme()
  const baseColor = props.color ?? theme.success
  const [opacity, setOpacity] = createSignal(0.3)

  const timeline = useTimeline({
    duration: 1000,
    loop: true,
  })

  const target = {
    opacity: 0.3,
    setOpacity,
  }

  timeline!.add(target, {
    opacity: 1.0,
    duration: 500,
    ease: "inOutQuad",
    alternate: true,
    loop: 2,
    onUpdate: () => {
      target.setOpacity(target.opacity)
    },
  })

  const color = () =>
    RGBA.fromInts(
      baseColor.r * 255,
      baseColor.g * 255,
      baseColor.b * 255,
      opacity() * 255,
    )

  return <span style={{ fg: color() }}>●</span>
}

/**
 * Progress bar for tool execution
 */
export function ProgressBar(props: {
  width?: number
  progress?: number // 0-1
  indeterminate?: boolean
  color?: RGBA
}) {
  const { theme } = useTheme()
  const width = props.width ?? 20
  const color = props.color ?? theme.accent
  const [position, setPosition] = createSignal(0)

  // Indeterminate animation
  createEffect(() => {
    if (props.indeterminate) {
      const interval = setInterval(() => {
        setPosition((prev) => (prev + 1) % (width + 5))
      }, 100)
      onCleanup(() => clearInterval(interval))
    }
  })

  const filled = () => {
    if (props.indeterminate) {
      const pos = position()
      return Array(width)
        .fill(0)
        .map((_, i) => {
          const distance = Math.abs(i - pos)
          return distance < 3 ? "█" : "░"
        })
        .join("")
    }
    const filled = Math.floor((props.progress ?? 0) * width)
    return "█".repeat(filled) + "░".repeat(width - filled)
  }

  return (
    <span style={{ fg: color }}>
      [{filled()}] {props.indeterminate ? "" : `${Math.floor((props.progress ?? 0) * 100)}%`}
    </span>
  )
}

/**
 * Streaming text effect with wave animation
 */
export function StreamingText(props: { text: string; color?: RGBA; speed?: number }) {
  const { theme } = useTheme()
  const baseColor = props.color ?? theme.text
  const characters = props.text.split("")
  const [time, setTime] = createSignal(0)

  const interval = setInterval(() => {
    setTime((prev) => prev + (props.speed ?? 100))
  }, props.speed ?? 100)

  onCleanup(() => clearInterval(interval))

  return (
    <text>
      <For each={characters}>
        {(ch, i) => {
          const phase = (time() + i() * 100) / 1000
          const opacity = 0.5 + Math.sin(phase) * 0.5
          const color = RGBA.fromInts(
            baseColor.r * 255,
            baseColor.g * 255,
            baseColor.b * 255,
            opacity * 255,
          )
          return <span style={{ fg: color }}>{ch}</span>
        }}
      </For>
    </text>
  )
}

/**
 * Pulsing border effect for tool containers
 */
export function PulsingBorder(props: { children: JSX.Element; active: boolean }) {
  const { theme } = useTheme()
  const [intensity, setIntensity] = createSignal(0.3)

  createEffect(() => {
    if (props.active) {
      const timeline = useTimeline({
        duration: 1500,
        loop: true,
      })

      const target = {
        intensity: 0.3,
        setIntensity,
      }

      timeline!.add(target, {
        intensity: 1.0,
        duration: 750,
        ease: "inOutQuad",
        alternate: true,
        loop: 2,
        onUpdate: () => {
          target.setIntensity(target.intensity)
        },
      })
    }
  })

  const borderColor = () => {
    if (!props.active) return theme.border
    return RGBA.fromInts(
      theme.accent.r * 255,
      theme.accent.g * 255,
      theme.accent.b * 255,
      intensity() * 255,
    )
  }

  return (
    <box border={["left"]} borderColor={borderColor()} paddingLeft={2}>
      {props.children}
    </box>
  )
}

/**
 * Success checkmark animation
 */
export function SuccessCheckmark(props: { delay?: number }) {
  const { theme } = useTheme()
  const [visible, setVisible] = createSignal(false)
  const [scale, setScale] = createSignal(0)

  setTimeout(() => {
    setVisible(true)
    const timeline = useTimeline({
      duration: 300,
    })

    const target = { scale: 0, setScale }
    timeline!.add(target, {
      scale: 1,
      duration: 300,
      ease: "outBack",
      onUpdate: () => target.setScale(target.scale),
    })
  }, props.delay ?? 0)

  const opacity = () => Math.min(scale(), 1)
  const color = RGBA.fromInts(
    theme.success.r * 255,
    theme.success.g * 255,
    theme.success.b * 255,
    opacity() * 255,
  )

  return visible() ? <span style={{ fg: color, bold: true }}>✓</span> : <></>
}

/**
 * Error X animation
 */
export function ErrorX(props: { delay?: number }) {
  const { theme } = useTheme()
  const [visible, setVisible] = createSignal(false)
  const [shake, setShake] = createSignal(0)

  setTimeout(() => {
    setVisible(true)
    const timeline = useTimeline({
      duration: 300,
    })

    const target = { shake: 0, setShake }
    timeline!.add(target, {
      shake: 1,
      duration: 300,
      ease: "outElastic",
      onUpdate: () => target.setShake(target.shake),
    })
  }, props.delay ?? 0)

  return visible() ? <span style={{ fg: theme.error, bold: true }}>✗</span> : <></>
}

/**
 * Tool status badge with animations
 */
export function ToolStatusBadge(props: { status: "pending" | "running" | "completed" | "error" }) {
  const { theme } = useTheme()

  return (
    <text>
      {props.status === "pending" && (
        <span style={{ fg: theme.textMuted }}>
          <Spinner /> pending
        </span>
      )}
      {props.status === "running" && (
        <span style={{ fg: theme.accent }}>
          <PulsingDot /> running
        </span>
      )}
      {props.status === "completed" && (
        <span style={{ fg: theme.success }}>
          <SuccessCheckmark /> completed
        </span>
      )}
      {props.status === "error" && (
        <span style={{ fg: theme.error }}>
          <ErrorX /> error
        </span>
      )}
    </text>
  )
}

/**
 * Streaming dots indicator
 */
export function StreamingDots() {
  const { theme } = useTheme()
  const [count, setCount] = createSignal(0)

  const interval = setInterval(() => {
    setCount((prev) => (prev + 1) % 4)
  }, 400)

  onCleanup(() => clearInterval(interval))

  return <span style={{ fg: theme.accent }}>{".".repeat(count())}</span>
}

/**
 * Matrix-style falling characters effect
 */
export function MatrixRain(props: { width?: number; height?: number }) {
  const { theme } = useTheme()
  const width = props.width ?? 20
  const height = props.height ?? 5
  const [drops, setDrops] = createSignal<number[]>(Array(width).fill(0))

  const interval = setInterval(() => {
    setDrops((prev) =>
      prev.map((y) => {
        if (y > height && Math.random() > 0.975) return 0
        return y + 1
      }),
    )
  }, 100)

  onCleanup(() => clearInterval(interval))

  const chars = "01"

  return (
    <box>
      <For each={Array(height).fill(0)}>
        {(_, row) => (
          <text>
            <For each={drops()}>
              {(drop, col) => {
                const isActive = drop === row()
                const opacity = isActive ? 1 : Math.max(0, 1 - (row() - drop) * 0.3)
                const color = RGBA.fromInts(
                  theme.success.r * 255,
                  theme.success.g * 255,
                  theme.success.b * 255,
                  opacity * 255,
                )
                const char = chars[Math.floor(Math.random() * chars.length)]
                return <span style={{ fg: color }}>{isActive && drop > 0 ? char : " "}</span>
              }}
            </For>
          </text>
        )}
      </For>
    </box>
  )
}
