import type { Component } from "solid-js"
import { createSignal, onMount } from "solid-js"

interface GridAnimatedTextProps {
  col: number
  row: number
  text: string
  fg?: string
  bg?: string
  delay?: number // ms delay before animation starts
  speed?: number // ms per character
}

// Typing animation - reveals text character by character
export const GridTypingText: Component<GridAnimatedTextProps> = (props) => {
  const [visibleChars, setVisibleChars] = createSignal(0)

  onMount(() => {
    setTimeout(() => {
      const interval = setInterval(() => {
        setVisibleChars((prev) => {
          if (prev >= props.text.length) {
            clearInterval(interval)
            return prev
          }
          return prev + 1
        })
      }, props.speed || 50)
    }, props.delay || 0)
  })

  return (
    <span
      style={{
        position: "absolute",
        left: `${props.col}ch`,
        top: `${props.row * 1.5}em`,
        color: props.fg || "#d4d4d4",
        background: props.bg || "transparent",
        "font-family": '"Berkeley Mono", "JetBrains Mono", monospace',
        "font-size": "16px",
        "line-height": "1.5",
        "white-space": "pre",
      }}
    >
      {props.text.slice(0, visibleChars())}
    </span>
  )
}

interface GridSlideProps {
  fromCol: number
  toCol: number
  row: number
  duration?: number // ms
  children: any
}

// Slide animation - moves from one column to another, snapping to grid
export const GridSlide: Component<GridSlideProps> = (props) => {
  const [currentCol, setCurrentCol] = createSignal(props.fromCol)

  onMount(() => {
    const steps = Math.abs(props.toCol - props.fromCol)
    const duration = props.duration || 300
    const stepDuration = duration / steps
    const direction = props.toCol > props.fromCol ? 1 : -1

    let step = 0
    const interval = setInterval(() => {
      if (step >= steps) {
        clearInterval(interval)
        return
      }
      setCurrentCol((prev) => prev + direction)
      step++
    }, stepDuration)
  })

  return (
    <div
      style={{
        position: "absolute",
        left: `${currentCol()}ch`,
        top: `${props.row * 1.5}em`,
        transition: `left ${(props.duration || 300) / Math.abs(props.toCol - props.fromCol)}ms linear`,
      }}
    >
      {props.children}
    </div>
  )
}

// Blink animation - toggles visibility on/off (like cursor)
export const GridBlink: Component<{
  col: number
  row: number
  text: string
  fg?: string
  speed?: number
}> = (props) => {
  const [visible, setVisible] = createSignal(true)

  onMount(() => {
    const interval = setInterval(() => {
      setVisible((prev) => !prev)
    }, props.speed || 500)
  })

  return (
    <span
      style={{
        position: "absolute",
        left: `${props.col}ch`,
        top: `${props.row * 1.2}em`,
        color: props.fg || "#dcdcaa",
        "font-family": '"Berkeley Mono", "JetBrains Mono", monospace',
        "font-size": "16px",
        "line-height": "1.2",
        opacity: visible() ? 1 : 0,
        transition: "opacity 0.1s",
      }}
    >
      {props.text}
    </span>
  )
}

// Shimmer animation - pulsing opacity for streaming/loading text
export const GridShimmer: Component<{
  col: number
  row: number
  text: string
  fg?: string
  bg?: string
}> = (props) => {
  return (
    <span
      style={{
        position: "absolute",
        left: `${props.col}ch`,
        top: `${props.row * 1.2}em`,
        color: props.fg || "#569cd6",
        background: props.bg || "transparent",
        "font-family": '"Berkeley Mono", "JetBrains Mono", monospace',
        "font-size": "16px",
        "line-height": "1.2",
        animation: "shimmer 1.5s ease-in-out infinite",
        "white-space": "pre",
      }}
    >
      {props.text}
      <style>{`
        @keyframes shimmer {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
      `}</style>
    </span>
  )
}
