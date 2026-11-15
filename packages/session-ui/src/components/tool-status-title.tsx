import { Show, createEffect, createMemo, createSignal, on, onCleanup, untrack } from "solid-js"
import { TextShimmer } from "@opencode/ui/text-shimmer"
import { prefersReducedMotion } from "@opencode/ui/motion"
import {
  createToolStatusTitleState,
  DISPOSED_TOOL_STATUS_TITLE_EVENT,
  TOOL_STATUS_ANIMATION_MS,
  transitionToolStatusTitle,
  viewToolStatusTitle,
  type ToolStatusMode,
  type ToolStatusTitleEvent,
} from "./tool-status-title-machine"

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

// A title in a hidden tab or a detached row measures 0px; pinning that width would clip it until the animation ends.
function contentWidth(el: HTMLSpanElement | undefined) {
  if (!el?.isConnected) return
  const width = Math.ceil(el.getBoundingClientRect().width)

  return width > 0 ? `${width}px` : undefined
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
  const mode = createMemo<ToolStatusMode>(() => (suffix() ? "suffix" : "swap"))
  const text = createMemo(() => (props.active ? activeTail() : doneTail()))

  const [machine, setMachine] = createSignal(
    createToolStatusTitleState({ active: props.active, mode: untrack(mode), text: untrack(text) }),
  )

  const view = createMemo(() => viewToolStatusTitle(machine()))
  let activeRef: HTMLSpanElement | undefined
  let doneRef: HTMLSpanElement | undefined
  let widthRef: HTMLSpanElement | undefined
  let frame: number | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  const dispatch = (event: ToolStatusTitleEvent) => {
    const previous = untrack(machine)
    const next = transitionToolStatusTitle(previous, event)

    if (next === previous) return

    if (frame !== undefined) cancelAnimationFrame(frame)
    clearTimeout(timer)
    frame = undefined
    timer = undefined

    if (next.status === "disposed") return
    setMachine(next)

    if (next.status === "measuring") {
      const attempt = next.attempt

      frame = requestAnimationFrame(() => {
        frame = undefined
        dispatch({ type: "measured", attempt, width: contentWidth(next.active ? activeRef : doneRef) })
      })
    }

    if (next.status === "animating") {
      const attempt = next.attempt

      timer = setTimeout(() => {
        timer = undefined
        dispatch({ type: "settled", attempt })
      }, TOOL_STATUS_ANIMATION_MS)
    }
  }

  createEffect(
    on(
      [() => props.active, mode, text],
      () =>
        dispatch({
          type: "sync",
          active: props.active,
          mode: mode(),
          text: text(),
          width: contentWidth(widthRef),
          reducedMotion: prefersReducedMotion(),
        }),
      { defer: true },
    ),
  )

  onCleanup(() => dispatch(DISPOSED_TOOL_STATUS_TITLE_EVENT))

  return (
    <span
      data-component="tool-status-title"
      data-active={view().active ? "true" : "false"}
      data-ready={view().animating ? "true" : "false"}
      data-mode={mode()}
      class={props.class}
      aria-label={view().active ? props.activeText : props.doneText}
    >
      <Show
        when={suffix()}
        fallback={
          <span data-slot="tool-status-swap" ref={widthRef} style={{ width: view().width }}>
            <Show when={view().showActive}>
              <span data-slot="tool-status-active" ref={activeRef}>
                <TextShimmer text={activeTail()} active={view().active} offset={0} />
              </span>
            </Show>
            <Show when={view().showDone}>
              <span data-slot="tool-status-done" ref={doneRef}>
                <TextShimmer text={doneTail()} active={false} offset={0} />
              </span>
            </Show>
          </span>
        }
      >
        <span data-slot="tool-status-suffix">
          <span data-slot="tool-status-prefix">
            <TextShimmer text={split().prefix} active={view().active} offset={0} />
          </span>
          <span data-slot="tool-status-tail" ref={widthRef} style={{ width: view().width }}>
            <Show when={view().showActive}>
              <span data-slot="tool-status-active" ref={activeRef}>
                <TextShimmer text={activeTail()} active={view().active} offset={prefixLen()} />
              </span>
            </Show>
            <Show when={view().showDone}>
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
