import { For, Show, createEffect, createMemo, on, onCleanup, onMount, type JSX } from "solid-js"
import { animate, GROW_SPRING, type AnimationPlaybackControls } from "./motion"
import { prefersReducedMotion } from "../hooks/use-reduced-motion"

export type RollingResultsProps<T> = {
  items: T[]
  render: (item: T, index: number) => JSX.Element
  getKey?: (item: T, index: number) => string
  rows?: number
  rowHeight?: number
  rowGap?: number
  open?: boolean
  animate?: boolean
  class?: string
  empty?: JSX.Element
}

export function RollingResults<T>(props: RollingResultsProps<T>) {
  let view: HTMLDivElement | undefined
  let track: HTMLDivElement | undefined
  let shift: AnimationPlaybackControls | undefined
  let resize: AnimationPlaybackControls | undefined

  const reducedMotion = prefersReducedMotion

  const rows = createMemo(() => Math.max(1, Math.round(props.rows ?? 3)))
  const rowHeight = createMemo(() => Math.max(16, Math.round(props.rowHeight ?? 22)))
  const rowGap = createMemo(() => Math.max(0, Math.round(props.rowGap ?? 0)))
  const list = createMemo(() => props.items ?? [])
  const count = createMemo(() => list().length)
  const backstop = createMemo(() => Math.max(rows() * 2, 12))
  const rendered = createMemo(() => {
    const items = list()
    const max = backstop()
    return items.length > max ? items.slice(-max) : items
  })
  const skipped = createMemo(() => count() - rendered().length)
  const open = createMemo(() => props.open !== false)
  const active = createMemo(() => props.animate !== false && !reducedMotion())
  const overflowing = createMemo(() => count() > rows())
  const shown = createMemo(() => Math.min(rows(), count()))
  const step = createMemo(() => rowHeight() + rowGap())
  const offset = createMemo(() => Math.max(0, count() - shown()) * step())
  const height = createMemo(() => {
    if (!open()) return 0
    if (shown() > 0) {
      return shown() * rowHeight() + Math.max(0, shown() - 1) * rowGap()
    }
    if (props.empty === undefined) return 0
    return rowHeight()
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

  createEffect(
    on(
      offset,
      (next) => {
        if (!track) return
        if (!active()) {
          shift?.stop()
          shift = undefined
          setTrack(next)
          return
        }
        shift?.stop()
        const anim = animate(track, { transform: `translateY(${-next}px)` }, GROW_SPRING)
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

  createEffect(
    on(height, (next) => {
      if (!view) return
      if (!active()) {
        resize?.stop()
        resize = undefined
        setView(next)
        return
      }
      resize?.stop()
      const anim = animate(view, { height: `${next}px` }, GROW_SPRING)
      resize = anim
      anim.finished
        .catch(() => {})
        .finally(() => {
          if (resize !== anim) return
          setView(next)
          resize = undefined
        })
    }),
  )

  onCleanup(() => {
    shift?.stop()
    resize?.stop()
    shift = undefined
    resize = undefined
  })

  return (
    <div
      data-component="rolling-results"
      class={props.class}
      data-open={open() ? "true" : "false"}
      data-overflowing={overflowing() ? "true" : "false"}
      style={{
        "--rolling-results-row-height": `${rowHeight()}px`,
        "--rolling-results-row-gap": `${rowGap()}px`,
        "--rolling-results-fade": `${Math.round(rowHeight() * 0.6)}px`,
      }}
    >
      <div ref={view} data-slot="rolling-results-viewport" aria-live="polite">
        <Show when={list().length === 0 && props.empty !== undefined}>
          <div data-slot="rolling-results-empty">{props.empty}</div>
        </Show>
        <div ref={track} data-slot="rolling-results-track" style={{ "padding-top": `${skipped() * step()}px` }}>
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
  )
}
