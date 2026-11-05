import { createEffect, createSignal, onCleanup, onMount, untrack } from "solid-js"
import {
  createTextRevealState,
  selectTextRevealEntering,
  selectTextRevealLeaving,
  selectTextRevealReady,
  selectTextRevealSwapping,
  selectTextRevealTrackWidth,
  TEXT_REVEAL_READY_TIMEOUT_MS,
  transitionTextReveal,
  type TextRevealEffect,
  type TextRevealEvent,
} from "./text-reveal-machine"

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
  const [machine, setMachine] = createSignal(createTextRevealState(props.text))
  let inRef: HTMLSpanElement | undefined
  let outRef: HTMLSpanElement | undefined
  let rootRef: HTMLSpanElement | undefined
  let frame: number | undefined
  let readyTimer: ReturnType<typeof setTimeout> | undefined

  const win = () => inRef?.scrollWidth ?? 0
  const wout = () => outRef?.scrollWidth ?? 0
  const growOnly = () => props.growOnly ?? true
  const animates = typeof requestAnimationFrame === "function"

  const dispatch = (event: TextRevealEvent) => {
    const next = transitionTextReveal(untrack(machine), event)

    // Commit first: the effects measure the text nodes this state renders.
    if (next.state !== untrack(machine)) setMachine(next.state)
    next.effects.forEach(run)
  }

  const cancelFrame = () => {
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = undefined
  }

  const onFrame = (finish: () => void) => {
    cancelFrame()

    if (!animates) return finish()
    frame = requestAnimationFrame(() => {
      frame = undefined
      finish()
    })
  }

  const run = (effect: TextRevealEffect) => {
    if (effect.type === "measure.entering") {
      dispatch({ type: "width.measured", widthPx: win(), growOnly: growOnly() })

      return
    }

    if (effect.type === "ready.frame") {
      onFrame(() => dispatch({ type: "ready.settled", widthPx: win(), growOnly: growOnly() }))

      return
    }

    if (effect.type === "swap.frame") {
      onFrame(() => {
        const widthPx = Math.max(win(), wout())
        rootRef?.offsetHeight
        dispatch({ type: "swap.settled", attempt: effect.attempt, widthPx, growOnly: growOnly() })
      })

      return
    }

    if (effect.type === "cancel.frame") {
      cancelFrame()

      return
    }

    clearTimeout(readyTimer)
    readyTimer = undefined
  }

  createEffect(() => {
    const text = props.text
    untrack(() => dispatch({ type: "text.changed", text }))
  })

  onMount(() => {
    dispatch({ type: "width.measured", widthPx: win(), growOnly: growOnly() })

    if (!animates) {
      dispatch({ type: "ready.settled", widthPx: win(), growOnly: growOnly() })

      return
    }

    readyTimer = setTimeout(
      () => dispatch({ type: "ready.timed-out", widthPx: win(), growOnly: growOnly() }),
      TEXT_REVEAL_READY_TIMEOUT_MS,
    )
    const fonts = typeof document !== "undefined" ? document.fonts : undefined
    const settle = () => dispatch({ type: "fonts.settled", widthPx: win(), growOnly: growOnly() })

    if (!fonts) return settle()
    void fonts.ready.finally(settle)
  })

  onCleanup(() => dispatch({ type: "disposed" }))

  return (
    <span
      ref={rootRef}
      data-component="text-reveal"
      data-ready={selectTextRevealReady(machine()) ? "true" : "false"}
      data-swapping={selectTextRevealSwapping(machine()) ? "true" : "false"}
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
      <span data-slot="text-reveal-track" style={{ width: selectTextRevealTrackWidth(machine(), props.truncate) }}>
        <span data-slot="text-reveal-entering" ref={inRef}>
          {selectTextRevealEntering(machine())}
        </span>
        <span data-slot="text-reveal-leaving" ref={outRef}>
          {selectTextRevealLeaving(machine())}
        </span>
      </span>
    </span>
  )
}
