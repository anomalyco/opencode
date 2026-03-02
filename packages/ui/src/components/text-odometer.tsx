import { createEffect, createSignal, on, onCleanup, onMount } from "solid-js"

const px = (value: number | string | undefined, fallback: number) => {
  if (typeof value === "number") return `${value}px`
  if (typeof value === "string") return value
  return `${fallback}px`
}

const ms = (value: number | string | undefined, fallback: number) => {
  if (typeof value === "number") return `${value}ms`
  if (typeof value === "string") return value
  return `${fallback}ms`
}

export function TextOdometer(props: {
  text?: string
  class?: string
  duration?: number | string
  travel?: number | string
  mask?: number | string
  pad?: number | string
  height?: number | string
  line?: number | string
  spring?: string
  springSoft?: string
  growOnly?: boolean
}) {
  const [cur, setCur] = createSignal(props.text)
  const [old, setOld] = createSignal<string | undefined>()
  const [width, setWidth] = createSignal("auto")
  const [ready, setReady] = createSignal(false)
  const [swapping, setSwapping] = createSignal(false)
  const [fit, setFit] = createSignal({
    line: 20,
    travel: 4,
    mask: 12,
    pad: 9,
    height: 0,
  })
  let inRef: HTMLSpanElement | undefined
  let outRef: HTMLSpanElement | undefined
  let rootRef: HTMLSpanElement | undefined
  let frame: number | undefined

  const win = () => inRef?.scrollWidth ?? 0
  const wout = () => outRef?.scrollWidth ?? 0

  const widen = (next: number) => {
    if (next <= 0) return
    if (props.growOnly ?? true) {
      const prev = Number.parseFloat(width())
      if (Number.isFinite(prev) && next <= prev) return
    }
    setWidth(`${next}px`)
  }

  const refine = () => {
    const el = rootRef
    if (!el || typeof window === "undefined") return
    const style = window.getComputedStyle(el)
    const font = Number.parseFloat(style.fontSize)
    const line = Number.parseFloat(style.lineHeight)
    const unit = Number.isFinite(font) ? font : 14
    const high = Number.isFinite(line) ? line : unit * 1.43
    const travel = Math.max(2, Math.round(high * 0.2))
    const mask = Math.max(2, Math.round(high * 0.6))
    const pad = Math.max(4, Math.round(high * 0.45))
    const height = Math.max(0, Math.round((high - 20) * 0.25))
    setFit({ line: high, travel, mask, pad, height })
  }

  createEffect(
    on(
      () => props.text,
      (next, prev) => {
        if (next === prev) return
        setSwapping(true)
        setOld(prev)
        setCur(next)

        if (typeof requestAnimationFrame !== "function") {
          widen(Math.max(win(), wout()))
          rootRef?.offsetHeight
          setSwapping(false)
          return
        }
        if (frame !== undefined && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame)
        frame = requestAnimationFrame(() => {
          widen(Math.max(win(), wout()))
          rootRef?.offsetHeight
          setSwapping(false)
          frame = undefined
        })
      },
    ),
  )

  onMount(() => {
    widen(win())
    refine()
    const el = rootRef
    if (el && typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(refine)
      observer.observe(el)
      onCleanup(() => observer.disconnect())
    }
    const fonts = typeof document !== "undefined" ? document.fonts : undefined
    if (typeof requestAnimationFrame !== "function") {
      setReady(true)
      return
    }
    if (!fonts) {
      requestAnimationFrame(() => setReady(true))
      return
    }
    fonts.ready.finally(() => {
      widen(win())
      refine()
      requestAnimationFrame(() => setReady(true))
    })
  })

  onCleanup(() => {
    if (frame === undefined || typeof cancelAnimationFrame !== "function") return
    cancelAnimationFrame(frame)
  })

  return (
    <span
      ref={rootRef}
      data-component="text-odometer"
      data-ready={ready() ? "true" : "false"}
      data-swapping={swapping() ? "true" : "false"}
      class={props.class}
      aria-label={props.text ?? ""}
      style={{
        "--text-odometer-duration": ms(props.duration, 550),
        "--text-odometer-travel": px(props.travel, fit().travel),
        "--text-odometer-mask-size": px(props.mask, fit().mask),
        "--text-odometer-mask-pad": px(props.pad, fit().pad),
        "--text-odometer-mask-height": px(props.height, fit().height),
        "--text-odometer-line": props.line === undefined ? undefined : px(props.line, fit().line),
        "--text-odometer-spring": props.spring ?? "cubic-bezier(0.34, 1.35, 0.64, 1)",
        "--text-odometer-spring-soft": props.springSoft ?? "cubic-bezier(0.34, 1, 0.64, 1)",
      }}
    >
      <span data-slot="text-odometer-track" style={{ width: width() }}>
        <span data-slot="text-odometer-entering" ref={inRef}>
          {cur() ?? "\u00A0"}
        </span>
        <span data-slot="text-odometer-leaving" ref={outRef}>
          {old() ?? "\u00A0"}
        </span>
      </span>
    </span>
  )
}
