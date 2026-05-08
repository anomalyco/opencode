import { Show, createEffect, createMemo, on, onCleanup } from "solid-js"
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
  if (!el) return
  return `${Math.ceil(el.getBoundingClientRect().width)}px`
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
    active: props.active,
    animating: false,
    width: undefined as string | undefined,
  })
  const width = () => state.width
  const active = () => state.active
  const animating = () => state.animating
  let activeRef: HTMLSpanElement | undefined
  let doneRef: HTMLSpanElement | undefined
  let widthRef: HTMLSpanElement | undefined
  let frame: number | undefined
  let finishTimer: ReturnType<typeof setTimeout> | undefined

  const finish = () => {
    if (frame !== undefined) cancelAnimationFrame(frame)
    if (finishTimer !== undefined) clearTimeout(finishTimer)
    frame = undefined
    finishTimer = undefined
    setState("animating", false)
    setState("width", undefined)
  }

  const animate = () => {
    const first = contentWidth(widthRef)
    finish()
    setState("animating", true)
    setState("active", props.active)
    const last = contentWidth(props.active ? activeRef : doneRef)
    if (!first || !last) {
      finish()
      return
    }

    setState("width", first)
    if (first === last) {
      finishTimer = setTimeout(finish, 600)
      return
    }

    frame = requestAnimationFrame(() => {
      frame = undefined
      setState("width", last)
      finishTimer = setTimeout(finish, 600)
    })
  }

  createEffect(on([() => props.active, activeTail, doneTail], () => animate(), { defer: true }))

  onCleanup(() => {
    finish()
  })

  return (
    <span
      data-component="tool-status-title"
      data-active={active() ? "true" : "false"}
      data-ready={animating() ? "true" : "false"}
      data-mode={suffix() ? "suffix" : "swap"}
      class={props.class}
      aria-label={active() ? props.activeText : props.doneText}
    >
      <Show
        when={suffix()}
        fallback={
          <span data-slot="tool-status-swap" ref={widthRef} style={{ width: width() }}>
            <Show when={animating() || active()}>
              <span data-slot="tool-status-active" ref={activeRef}>
                <TextShimmer text={activeTail()} active={active()} offset={0} />
              </span>
            </Show>
            <Show when={animating() || !active()}>
              <span data-slot="tool-status-done" ref={doneRef}>
                <TextShimmer text={doneTail()} active={false} offset={0} />
              </span>
            </Show>
          </span>
        }
      >
        <span data-slot="tool-status-suffix">
          <span data-slot="tool-status-prefix">
            <TextShimmer text={split().prefix} active={active()} offset={0} />
          </span>
          <span data-slot="tool-status-tail" ref={widthRef} style={{ width: width() }}>
            <Show when={animating() || active()}>
              <span data-slot="tool-status-active" ref={activeRef}>
                <TextShimmer text={activeTail()} active={active()} offset={prefixLen()} />
              </span>
            </Show>
            <Show when={animating() || !active()}>
              <span data-slot="tool-status-done" ref={doneRef}>
                <TextShimmer text={doneTail()} active={false} offset={prefixLen()} />
              </span>
            </Show>
          </span>
        </span>
      </Show>
    </span>
  )
}
