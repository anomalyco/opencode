import { createResizeObserver } from "@solid-primitives/resize-observer"
import { onCleanup, onMount, Show, splitProps, type ComponentProps, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import "./menu-scroll.css"

/**
 * A scroll container for menus, popovers and dialog lists. It hides the native scrollbar and draws the shared thumb
 * over the content, so rows keep equal start and end padding whether or not the list overflows. Touch devices keep
 * their native overlay scrollbar.
 */
export function MenuScroll(
  props: Omit<ComponentProps<"div">, "ref" | "onScroll"> & {
    viewportClass?: string
    viewportRef?: (element: HTMLDivElement) => void
    onScroll?: JSX.EventHandler<HTMLDivElement, Event>
  },
) {
  const [local, rest] = splitProps(props, ["class", "children", "viewportClass", "viewportRef", "onScroll"])

  const [state, setState] = createStore<{
    size: number
    start: number
    overflow: boolean
    scrolling: boolean
    grab?: number
  }>({
    size: 0,
    start: 4,
    overflow: false,
    scrolling: false,
  })

  let viewport!: HTMLDivElement

  let content!: HTMLDivElement

  let idle: ReturnType<typeof setTimeout> | undefined

  const measure = () => {
    const track = Math.max(0, viewport.clientHeight - 8)

    const size = Math.min(track, Math.max(32, (viewport.clientHeight / Math.max(1, viewport.scrollHeight)) * track))

    const max = viewport.scrollHeight - viewport.clientHeight

    setState({ size, start: 4 + (max > 0 ? (viewport.scrollTop / max) * (track - size) : 0), overflow: max > 0 })

    if (max <= 0) setState("grab", undefined)
  }

  onMount(() => createResizeObserver([viewport, content], measure))

  onCleanup(() => clearTimeout(idle))

  return (
    <div
      data-component="menu-scroll"
      data-scrolling={state.scrolling ? "" : undefined}
      data-dragging={state.grab !== undefined ? "" : undefined}
      class={local.class}
    >
      <div
        data-slot="menu-scroll-viewport"
        {...rest}
        ref={(element) => {
          viewport = element
          local.viewportRef?.(element)
        }}
        data-scrollable
        class={local.viewportClass}
        onScroll={(event) => {
          measure()
          // Keyboard navigation scrolls without hovering, so the thumb also shows while the list scrolls.
          setState("scrolling", true)
          clearTimeout(idle)
          idle = setTimeout(() => setState("scrolling", false), 800)
          local.onScroll?.(event)
        }}
      >
        <div ref={content}>{local.children}</div>
      </div>
      <Show when={state.overflow}>
        <div
          data-slot="menu-scroll-thumb"
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
