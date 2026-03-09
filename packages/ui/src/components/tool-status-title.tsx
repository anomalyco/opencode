import { Show, createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js"
import { useReducedMotion } from "../hooks/use-reduced-motion"
import { animate, type AnimationPlaybackControls, GROW_SPRING } from "./motion"
import { TextShimmer } from "./text-shimmer"
import { commonPrefix } from "./text-utils"

function contentWidth(el: HTMLSpanElement | undefined) {
  if (!el) return 0
  const range = document.createRange()
  range.selectNodeContents(el)
  return Math.ceil(range.getBoundingClientRect().width)
}

export function ToolStatusTitle(props: {
  active: boolean
  activeText: string
  doneText: string
  class?: string
  split?: boolean
}) {
  const reduce = useReducedMotion()
  const split = createMemo(() => commonPrefix(props.activeText, props.doneText))
  const suffix = createMemo(
    () =>
      (props.split ?? true) && split().prefix.length >= 2 && split().aSuffix.length > 0 && split().bSuffix.length > 0,
  )
  const prefixLen = createMemo(() => Array.from(split().prefix).length)
  const activeTail = createMemo(() => (suffix() ? split().aSuffix : props.activeText))
  const doneTail = createMemo(() => (suffix() ? split().bSuffix : props.doneText))

  const [ready, setReady] = createSignal(false)
  let activeRef: HTMLSpanElement | undefined
  let doneRef: HTMLSpanElement | undefined
  let swapRef: HTMLSpanElement | undefined
  let tailRef: HTMLSpanElement | undefined
  let frame: number | undefined
  let readyFrame: number | undefined
  let widthAnim: AnimationPlaybackControls | undefined

  const node = () => (suffix() ? tailRef : swapRef)

  const setNodeWidth = (width: string) => {
    if (swapRef) swapRef.style.width = width
    if (tailRef) tailRef.style.width = width
  }

  const measure = () => {
    const target = props.active ? activeRef : doneRef
    const next = contentWidth(target)
    if (next <= 0) return

    const ref = node()
    if (!ref || !ready() || reduce()) {
      widthAnim?.stop()
      setNodeWidth(`${next}px`)
      return
    }

    const prev = Math.max(0, Math.ceil(ref.getBoundingClientRect().width))
    if (Math.abs(next - prev) < 1) {
      ref.style.width = `${next}px`
      return
    }

    ref.style.width = `${prev}px`
    widthAnim?.stop()
    widthAnim = animate(ref, { width: `${next}px` }, GROW_SPRING)
    widthAnim.finished.then(() => {
      const el = node()
      if (!el) return
      el.style.width = `${next}px`
    })
  }

  const schedule = () => {
    if (typeof requestAnimationFrame !== "function") {
      measure()
      return
    }
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      frame = undefined
      measure()
    })
  }

  const finish = () => {
    if (typeof requestAnimationFrame !== "function") {
      setReady(true)
      return
    }
    if (readyFrame !== undefined) cancelAnimationFrame(readyFrame)
    readyFrame = requestAnimationFrame(() => {
      readyFrame = undefined
      setReady(true)
    })
  }

  createEffect(on([() => props.active, activeTail, doneTail, suffix], () => schedule()))

  onMount(() => {
    measure()
    const fonts = typeof document !== "undefined" ? document.fonts : undefined
    if (!fonts) {
      finish()
      return
    }
    fonts.ready.finally(() => {
      measure()
      finish()
    })
  })

  onCleanup(() => {
    if (frame !== undefined) cancelAnimationFrame(frame)
    if (readyFrame !== undefined) cancelAnimationFrame(readyFrame)
    widthAnim?.stop()
  })

  return (
    <span
      data-component="tool-status-title"
      data-active={props.active ? "true" : "false"}
      data-ready={ready() ? "true" : "false"}
      data-mode={suffix() ? "suffix" : "swap"}
      class={props.class}
      aria-label={props.active ? props.activeText : props.doneText}
    >
      <Show
        when={suffix()}
        fallback={
          <span data-slot="tool-status-swap" ref={swapRef}>
            <span data-slot="tool-status-active" ref={activeRef}>
              <TextShimmer text={activeTail()} active={props.active} offset={0} />
            </span>
            <span data-slot="tool-status-done" ref={doneRef}>
              <TextShimmer text={doneTail()} active={false} offset={0} />
            </span>
          </span>
        }
      >
        <span data-slot="tool-status-suffix">
          <span data-slot="tool-status-prefix">
            <TextShimmer text={split().prefix} active={props.active} offset={0} />
          </span>
          <span data-slot="tool-status-tail" ref={tailRef}>
            <span data-slot="tool-status-active" ref={activeRef}>
              <TextShimmer text={activeTail()} active={props.active} offset={prefixLen()} />
            </span>
            <span data-slot="tool-status-done" ref={doneRef}>
              <TextShimmer text={doneTail()} active={false} offset={prefixLen()} />
            </span>
          </span>
        </span>
      </Show>
    </span>
  )
}
