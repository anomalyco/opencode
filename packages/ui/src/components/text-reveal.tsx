import { createEffect, createSignal, on, onCleanup, onMount } from "solid-js"
import { useReducedMotion } from "../hooks/use-reduced-motion"
import {
  animate,
  type AnimationPlaybackControls,
  clearFadeStyles,
  clearMaskStyles,
  GROW_SPRING,
  WIPE_MASK,
} from "./motion"

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

const pct = (value: number | undefined, fallback: number) => {
  const v = value ?? fallback
  return `${v}%`
}

const clearWipe = (el: HTMLElement) => {
  clearFadeStyles(el)
  clearMaskStyles(el)
}

export function TextReveal(props: {
  text?: string
  class?: string
  duration?: number | string
  /** Gradient edge softness as a percentage of the mask (0 = hard wipe, 17 = soft). */
  edge?: number
  /** Optional small vertical travel for entering text (px). Default 0. */
  travel?: number | string
  spring?: string
  springSoft?: string
  growOnly?: boolean
  truncate?: boolean
}) {
  const [cur, setCur] = createSignal(props.text)
  const [old, setOld] = createSignal<string | undefined>()
  const [width, setWidth] = createSignal("auto")
  const [ready, setReady] = createSignal(false)
  const [swapping, setSwapping] = createSignal(false)
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
      data-component="text-reveal"
      data-ready={ready() ? "true" : "false"}
      data-swapping={swapping() ? "true" : "false"}
      data-truncate={props.truncate ? "true" : "false"}
      class={props.class}
      aria-label={props.text ?? ""}
      style={{
        "--text-reveal-duration": ms(props.duration, 450),
        "--text-reveal-edge": pct(props.edge, 17),
        "--text-reveal-travel": px(props.travel, 0),
        "--text-reveal-spring": props.spring ?? "cubic-bezier(0.34, 1.08, 0.64, 1)",
        "--text-reveal-spring-soft": props.springSoft ?? "cubic-bezier(0.34, 1, 0.64, 1)",
      }}
    >
      <span data-slot="text-reveal-track" style={{ width: props.truncate ? "100%" : width() }}>
        <span data-slot="text-reveal-entering" ref={inRef}>
          {cur() ?? "\u00A0"}
        </span>
        <span data-slot="text-reveal-leaving" ref={outRef}>
          {old() ?? "\u00A0"}
        </span>
      </span>
    </span>
  )
}

export function TextWipe(props: { text?: string; class?: string; delay?: number; animate?: boolean }) {
  let ref: HTMLSpanElement | undefined
  let frame: number | undefined
  let anim: AnimationPlaybackControls | undefined
  const reduce = useReducedMotion()

  const run = () => {
    if (props.animate === false) return
    const el = ref
    if (!el || !props.text || typeof window === "undefined") return
    if (reduce()) return

    const mask =
      typeof CSS !== "undefined" &&
      (CSS.supports("mask-image", "linear-gradient(to right, black, transparent)") ||
        CSS.supports("-webkit-mask-image", "linear-gradient(to right, black, transparent)"))

    anim?.stop()
    if (frame !== undefined && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(frame)
      frame = undefined
    }

    el.style.opacity = "0"
    el.style.filter = "blur(3px)"
    el.style.transform = "translateX(-0.06em)"

    if (mask) {
      el.style.maskImage = WIPE_MASK
      el.style.webkitMaskImage = WIPE_MASK
      el.style.maskSize = "240% 100%"
      el.style.webkitMaskSize = "240% 100%"
      el.style.maskRepeat = "no-repeat"
      el.style.webkitMaskRepeat = "no-repeat"
      el.style.maskPosition = "100% 0%"
      el.style.webkitMaskPosition = "100% 0%"
    }

    if (typeof requestAnimationFrame !== "function") {
      clearWipe(el)
      return
    }

    frame = requestAnimationFrame(() => {
      frame = undefined
      const node = ref
      if (!node) return
      anim = mask
        ? animate(
            node,
            { opacity: 1, filter: "blur(0px)", transform: "translateX(0)", maskPosition: "0% 0%" },
            { ...GROW_SPRING, delay: props.delay ?? 0 },
          )
        : animate(
            node,
            { opacity: 1, filter: "blur(0px)", transform: "translateX(0)" },
            { ...GROW_SPRING, delay: props.delay ?? 0 },
          )

      anim?.finished.then(() => {
        const value = ref
        if (!value) return
        clearWipe(value)
      })
    })
  }

  createEffect(
    on(
      () => [props.text, props.animate] as const,
      ([text, enabled]) => {
        if (!text || enabled === false) {
          if (ref) clearWipe(ref)
          return
        }
        run()
      },
    ),
  )

  onCleanup(() => {
    if (frame !== undefined && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame)
    anim?.stop()
  })

  return (
    <span ref={ref} class={props.class} aria-label={props.text ?? ""}>
      {props.text ?? "\u00A0"}
    </span>
  )
}
