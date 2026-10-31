import { createResizeObserver } from "@solid-primitives/resize-observer"
import { onMount, Show, splitProps, type ComponentProps } from "solid-js"
import { createStore } from "solid-js/store"
import "./menu-scroll.css"

export function MenuScroll(
  props: Omit<ComponentProps<"div">, "ref" | "onScroll"> & {
    viewportClass?: string
    viewportRef?: (element: HTMLDivElement) => void
  },
) {
  const [local, rest] = splitProps(props, ["class", "children", "viewportClass", "viewportRef"])

  const [state, setState] = createStore<{ size: number; start: number; overflow: boolean; grab?: number }>({
    size: 0,
    start: 4,
    overflow: false,
  })

  let viewport!: HTMLDivElement

  let content!: HTMLDivElement

  const measure = () => {
    const track = Math.max(0, viewport.clientHeight - 8)

    const size = Math.min(track, Math.max(32, (viewport.clientHeight / Math.max(1, viewport.scrollHeight)) * track))

    const max = viewport.scrollHeight - viewport.clientHeight

    setState({ size, start: 4 + (max > 0 ? (viewport.scrollTop / max) * (track - size) : 0), overflow: max > 0 })

    if (max <= 0) setState("grab", undefined)
  }

  onMount(() => {
    local.viewportRef?.(viewport)
    createResizeObserver([viewport, content], measure)
  })

  return (
    <div data-component="menu-scroll" class={local.class}>
      <div
        {...rest}
        ref={viewport}
        data-slot="menu-scroll-viewport"
        data-scrollable
        class={local.viewportClass}
        onScroll={measure}
      >
        <div ref={content}>{local.children}</div>
      </div>
      <Show when={state.overflow}>
        <div
          data-slot="menu-scroll-thumb"
          data-dragging={state.grab !== undefined ? "" : undefined}
          aria-hidden="true"
          style={{ height: `${state.size}px`, transform: `translateY(${state.start}px)` }}
          onPointerDown={(event) => {
            if (event.button !== 0) return
            event.preventDefault()
            event.stopPropagation()
            setState("grab", event.clientY - event.currentTarget.getBoundingClientRect().top)
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerMove={(event) => {
            if (state.grab === undefined) return
            const travel = viewport.clientHeight - 8 - state.size

            if (travel <= 0) return
            viewport.scrollTop =
              ((event.clientY - viewport.getBoundingClientRect().top - 4 - state.grab) / travel) *
              (viewport.scrollHeight - viewport.clientHeight)
          }}
          onPointerUp={(event) => {
            if (state.grab === undefined) return
            event.currentTarget.releasePointerCapture(event.pointerId)
          }}
          onLostPointerCapture={() => setState("grab", undefined)}
        />
      </Show>
    </div>
  )
}
