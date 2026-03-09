import { For, Show, batch, createEffect, createMemo, createSignal, on, onCleanup, onMount, type JSX } from "solid-js"
import { useReducedMotion } from "../hooks/use-reduced-motion"
import { animate, clearMaskStyles, GROW_SPRING, type AnimationPlaybackControls, type SpringConfig } from "./motion"

export type RollingResultsProps<T> = {
  items: T[]
  render: (item: T, index: number) => JSX.Element
  fixed?: JSX.Element
  getKey?: (item: T, index: number) => string
  rows?: number
  rowHeight?: number
  fixedHeight?: number
  rowGap?: number
  open?: boolean
  scrollable?: boolean
  spring?: SpringConfig
  animate?: boolean
  class?: string
  empty?: JSX.Element
  noFadeOnCollapse?: boolean
}

export function RollingResults<T>(props: RollingResultsProps<T>) {
  let view: HTMLDivElement | undefined
  let track: HTMLDivElement | undefined
  let windowEl: HTMLDivElement | undefined
  let shift: AnimationPlaybackControls | undefined
  let resize: AnimationPlaybackControls | undefined
  let edgeFade: AnimationPlaybackControls | undefined
  const reduce = useReducedMotion()

  const rows = createMemo(() => Math.max(1, Math.round(props.rows ?? 3)))
  const rowHeight = createMemo(() => Math.max(16, Math.round(props.rowHeight ?? 22)))
  const fixedHeight = createMemo(() => Math.max(0, Math.round(props.fixedHeight ?? rowHeight())))
  const rowGap = createMemo(() => Math.max(0, Math.round(props.rowGap ?? 0)))
  const fixed = createMemo(() => props.fixed !== undefined)
  const list = createMemo(() => props.items ?? [])
  const count = createMemo(() => list().length)

  // scrollReady is the internal "transition complete" state.
  // It only becomes true after props.scrollable is true AND the offset animation has settled.
  const [scrollReady, setScrollReady] = createSignal(false)

  const backstop = createMemo(() => Math.max(rows() * 2, 12))
  const rendered = createMemo(() => {
    const items = list()
    if (scrollReady()) return items
    const max = backstop()
    return items.length > max ? items.slice(-max) : items
  })
  const skipped = createMemo(() => {
    if (scrollReady()) return 0
    return count() - rendered().length
  })
  const open = createMemo(() => props.open !== false)
  const active = createMemo(() => (props.animate !== false || props.spring !== undefined) && !reduce())
  const noFade = () => props.noFadeOnCollapse === true
  const overflowing = createMemo(() => count() > rows())
  const shown = createMemo(() => Math.min(rows(), count()))
  const step = createMemo(() => rowHeight() + rowGap())
  const offset = createMemo(() => Math.max(0, count() - shown()) * step())
  const body = createMemo(() => {
    if (shown() > 0) {
      return shown() * rowHeight() + Math.max(0, shown() - 1) * rowGap()
    }
    if (props.empty === undefined) return 0
    return rowHeight()
  })
  const gap = createMemo(() => {
    if (!fixed()) return 0
    if (body() <= 0) return 0
    return rowGap()
  })
  const height = createMemo(() => {
    if (!open()) return 0
    if (!fixed()) return body()
    return fixedHeight() + gap() + body()
  })

  const key = (item: T, index: number) => {
    const value = props.getKey
    if (value) return value(item, index)
    return String(index)
  }

  const setTrack = (value: number) => {
    if (!track) return
    track.style.transform = `translateY(${-Math.round(value)}px)`
  }

  const setView = (value: number) => {
    if (!view) return
    view.style.height = `${Math.max(0, Math.round(value))}px`
  }

  onMount(() => {
    setTrack(offset())
  })

  // Original WAAPI offset animation — untouched rolling behavior.
  createEffect(
    on(
      offset,
      (next) => {
        if (!track) return
        if (scrollReady()) return
        if (props.scrollable) return
        if (!active()) {
          shift?.stop()
          shift = undefined
          setTrack(next)
          return
        }
        shift?.stop()
        const anim = animate(track, { transform: `translateY(${-next}px)` }, props.spring ?? GROW_SPRING)
        shift = anim
        anim.finished
          .catch(() => {})
          .finally(() => {
            if (shift !== anim) return
            setTrack(next)
            shift = undefined
          })
      },
      { defer: true },
    ),
  )

  // Scrollable transition: wait for the offset animation to finish,
  // then batch all DOM changes in one synchronous pass.
  createEffect(
    on(
      () => props.scrollable === true,
      (isScrollable) => {
        if (!isScrollable) {
          setScrollReady(false)
          if (windowEl) {
            windowEl.style.overflowY = ""
            windowEl.style.maskImage = ""
            windowEl.style.webkitMaskImage = ""
          }
          return
        }
        // Wait for the current offset animation to settle (if any).
        const done = shift?.finished ?? Promise.resolve()
        done
          .catch(() => {})
          .then(() => {
            if (props.scrollable !== true) return

            // Batch the signal update — Solid updates the DOM synchronously:
            // rendered() returns all items, skipped() returns 0, padding-top removed,
            // data-scrollable becomes "true".
            batch(() => setScrollReady(true))

            // Now the DOM has all items. Safe to switch layout strategy.
            // CSS handles `transform: none !important` on [data-scrollable="true"].
            if (windowEl) {
              windowEl.style.overflowY = "auto"
              windowEl.scrollTop = windowEl.scrollHeight
            }
            updateScrollMask()
          })
      },
    ),
  )

  // Auto-scroll to bottom when new items arrive in scrollable mode
  const [userScrolled, setUserScrolled] = createSignal(false)

  const updateScrollMask = () => {
    if (!windowEl) return
    if (!scrollReady()) {
      windowEl.style.maskImage = ""
      windowEl.style.webkitMaskImage = ""
      return
    }
    const { scrollTop, scrollHeight, clientHeight } = windowEl
    const atBottom = scrollHeight - scrollTop - clientHeight < 8
    // Top fade is always present in scrollable mode (matches rolling mode appearance).
    // Bottom fade only when not scrolled to the end.
    const mask = atBottom
      ? "linear-gradient(to bottom, transparent 0, black 8px)"
      : "linear-gradient(to bottom, transparent 0, black 8px, black calc(100% - 8px), transparent 100%)"
    windowEl.style.maskImage = mask
    windowEl.style.webkitMaskImage = mask
  }

  createEffect(() => {
    if (!scrollReady()) {
      setUserScrolled(false)
      return
    }
    const _n = count()
    const scrolled = userScrolled()
    if (scrolled) return
    if (windowEl) {
      windowEl.scrollTop = windowEl.scrollHeight
      updateScrollMask()
    }
  })

  const onWindowScroll = () => {
    if (!windowEl || !scrollReady()) return
    const atBottom = windowEl.scrollHeight - windowEl.scrollTop - windowEl.clientHeight < 8
    setUserScrolled(!atBottom)
    updateScrollMask()
  }

  const EDGE_MASK = "linear-gradient(to top, transparent 0%, black 8px)"
  const applyEdge = () => {
    if (!view) return
    edgeFade?.stop()
    edgeFade = undefined
    view.style.maskImage = EDGE_MASK
    view.style.webkitMaskImage = EDGE_MASK
    view.style.maskSize = "100% 100%"
    view.style.maskRepeat = "no-repeat"
  }
  const clearEdge = () => {
    if (!view) return
    if (!active()) {
      clearMaskStyles(view)
      return
    }
    edgeFade?.stop()
    const anim = animate(view, { maskSize: "100% 200%" }, props.spring ?? GROW_SPRING)
    edgeFade = anim
    anim.finished
      .catch(() => {})
      .then(() => {
        if (edgeFade !== anim || !view) return
        clearMaskStyles(view)
        edgeFade = undefined
      })
  }

  createEffect(
    on(height, (next, prev) => {
      if (!view) return
      if (!active()) {
        resize?.stop()
        resize = undefined
        setView(next)
        view.style.opacity = ""
        clearEdge()
        return
      }
      const collapsing = next === 0 && prev !== undefined && prev > 0
      const expanding = prev === 0 && next > 0
      resize?.stop()
      view.style.opacity = ""
      applyEdge()
      const spring = props.spring ?? GROW_SPRING
      const anim = collapsing
        ? animate(view, noFade() ? { height: `${next}px` } : { height: `${next}px`, opacity: 0 }, spring)
        : expanding
          ? animate(view, noFade() ? { height: `${next}px` } : { height: `${next}px`, opacity: [0, 1] }, spring)
          : animate(view, { height: `${next}px` }, spring)
      resize = anim
      anim.finished
        .catch(() => {})
        .finally(() => {
          view.style.opacity = ""
          if (resize !== anim) return
          setView(next)
          resize = undefined
          clearEdge()
        })
    }),
  )

  onCleanup(() => {
    shift?.stop()
    resize?.stop()
    edgeFade?.stop()
    shift = undefined
    resize = undefined
    edgeFade = undefined
  })

  return (
    <div
      data-component="rolling-results"
      class={props.class}
      data-open={open() ? "true" : "false"}
      data-overflowing={overflowing() ? "true" : "false"}
      data-scrollable={scrollReady() ? "true" : "false"}
      data-fixed={fixed() ? "true" : "false"}
      style={{
        "--rolling-results-row-height": `${rowHeight()}px`,
        "--rolling-results-fixed-height": `${fixed() ? fixedHeight() : 0}px`,
        "--rolling-results-fixed-gap": `${gap()}px`,
        "--rolling-results-row-gap": `${rowGap()}px`,
        "--rolling-results-fade": `${Math.round(rowHeight() * 0.6)}px`,
      }}
    >
      <div ref={view} data-slot="rolling-results-viewport" aria-live="polite">
        <Show when={fixed()}>
          <div data-slot="rolling-results-fixed">{props.fixed}</div>
        </Show>
        <div ref={windowEl} data-slot="rolling-results-window" onScroll={onWindowScroll}>
          <div data-slot="rolling-results-body">
            <Show when={list().length === 0 && props.empty !== undefined}>
              <div data-slot="rolling-results-empty">{props.empty}</div>
            </Show>
            <div
              ref={track}
              data-slot="rolling-results-track"
              style={{ "padding-top": scrollReady() ? undefined : `${skipped() * step()}px` }}
            >
              <For each={rendered()}>
                {(item, index) => (
                  <div data-slot="rolling-results-row" data-key={key(item, index())}>
                    {props.render(item, index())}
                  </div>
                )}
              </For>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
