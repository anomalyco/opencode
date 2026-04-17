import { Show, createEffect, createMemo, on, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { TextShimmer } from "./text-shimmer"

function common(active: string, done: string) {
  const a = Array.from(active)
  const b = Array.from(done)
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return {
    prefix: a.slice(0, i).join(""),
    active: a.slice(i).join(""),
    done: b.slice(i).join(""),
  }
}

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
  const split = createMemo(() => common(props.activeText, props.doneText))
  const suffix = createMemo(
    () => (props.split ?? true) && split().prefix.length >= 2 && split().active.length > 0 && split().done.length > 0,
  )
  const prefixLen = createMemo(() => Array.from(split().prefix).length)
  const activeTail = createMemo(() => (suffix() ? split().active : props.activeText))
  const doneTail = createMemo(() => (suffix() ? split().done : props.doneText))

  const [state, setState] = createStore({
    width: "auto",
    ready: false,
  })
  const width = () => state.width
  const ready = () => state.ready
  let activeRef: HTMLSpanElement | undefined
  let doneRef: HTMLSpanElement | undefined
  let frame: number | undefined
  let readyFrame: number | undefined

  const measure = () => {
    const target = props.active ? activeRef : doneRef
    const px = contentWidth(target)
    if (px > 0) setState("width", `${px}px`)
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
      setState("ready", true)
      return
    }
    if (readyFrame !== undefined) cancelAnimationFrame(readyFrame)
    readyFrame = requestAnimationFrame(() => {
      readyFrame = undefined
      setState("ready", true)
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
    void fonts.ready.finally(() => {
      measure()
      finish()
    })
  })

  onCleanup(() => {
    if (frame !== undefined) cancelAnimationFrame(frame)
    if (readyFrame !== undefined) cancelAnimationFrame(readyFrame)
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
          <span data-slot="tool-status-swap" style={{ width: width() }}>
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
          <span data-slot="tool-status-tail" style={{ width: width() }}>
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
