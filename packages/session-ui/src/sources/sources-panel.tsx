import { useI18n } from "@opencode/ui/context/i18n"
import { Icon } from "@opencode/ui/icon"
import { frameLoop, observeReducedMotion, prefersReducedMotion } from "@opencode/ui/motion"
import { createEffect, createMemo, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js"
import { sourcesExpand, type SiteIconMode } from "./experiment"
import {
  COLLAPSE_SOURCES_EXPAND_EVENT,
  DISPOSED_SOURCES_EXPAND_EVENT,
  INITIAL_SOURCES_EXPAND_STATE,
  isSourcesStepMounted,
  isSourcesStepMoving,
  isSourcesStepOpen,
  REDUCED_SOURCES_EXPAND_EVENT,
  transitionSourcesExpand,
  type SourcesExpandEvent,
} from "./sources-expand-machine"
import { SiteIcon } from "./site-icon"
import type { SourceResult, SourceStep, TurnSources } from "./sources"
import "./sources.css"

/** A turn's searches and opened pages in the order they ran. `onOpen` opens a result's or page's URL. */
export function SourcesPanel(props: { sources: TurnSources; icons: SiteIconMode; onOpen: (url: string) => void }) {
  return (
    <div data-component="sources-panel">
      <For each={props.sources.steps}>
        {(step) => (
          <Switch>
            <Match when={step.type === "search" ? step : undefined}>
              {(search) => <SearchStep step={search()} icons={props.icons} onOpen={props.onOpen} />}
            </Match>
            <Match when={step.type === "fetch" ? step : undefined}>
              {(page) => <FetchStep step={page()} onOpen={props.onOpen} />}
            </Match>
          </Switch>
        )}
      </For>
    </div>
  )
}

function SearchStep(props: {
  step: Extract<SourceStep, { type: "search" }>
  icons: SiteIconMode
  onOpen: (url: string) => void
}) {
  const i18n = useI18n()
  let current = INITIAL_SOURCES_EXPAND_STATE
  const [state, setState] = createSignal(current)
  const open = createMemo(() => isSourcesStepOpen(state()))
  const mounted = createMemo(() => isSourcesStepMounted(state()))
  const expandable = () => props.step.results.length > 0
  let region: HTMLDivElement | undefined
  let list: HTMLDivElement | undefined
  let stopFrame: (() => void) | undefined
  // One event object serves every frame, so a step allocates nothing beyond the height string.
  const frame = { type: "frame" as const, attempt: 0, dt: 0 }

  const dispatch = (event: SourcesExpandEvent) => {
    const previous = current
    const next = transitionSourcesExpand(previous, event)

    if (next === previous) return
    current = next

    if (isSourcesStepMoving(previous) && (!isSourcesStepMoving(next) || next.attempt !== previous.attempt)) {
      stopFrame?.()
      stopFrame = undefined

      if (region) delete region.dataset.moving

      if (list) list.style.opacity = ""
    }

    if (next.status === "disposed") return
    setState(next)

    if (!isSourcesStepMoving(next)) {
      if (region) region.style.height = next.status === "open" ? "" : "0px"

      return
    }

    if (!region?.isConnected || !list?.isConnected) return dispatch({ type: "detached", attempt: next.attempt })

    if (next.mode === "fade") {
      region.style.height = ""
      list.style.opacity = "0"
      stopFrame ??= frameLoop.add(tick)

      return
    }

    // Layout is read once per flight, never per frame: where a resting region starts, and the results' height now
    // that they render. A reversed flight starts from its spring.
    if (!next.measured) {
      dispatch({
        type: "measured",
        attempt: next.attempt,
        from: region.offsetHeight,
        to: next.status === "opening" ? list.offsetHeight : 0,
      })

      if (current !== next) return
    }

    region.dataset.moving = ""
    region.style.height = `${next.value}px`
    stopFrame ??= frameLoop.add(tick)
  }

  const tick = (dt: number) => {
    const moving = current

    if (!isSourcesStepMoving(moving)) return false

    if (!region?.isConnected || !list?.isConnected) {
      dispatch({ type: "detached", attempt: moving.attempt })

      return false
    }

    frame.attempt = moving.attempt
    frame.dt = dt
    dispatch(frame)

    if (current !== moving) return false

    if (moving.mode === "fade") list.style.opacity = String(moving.value)

    if (moving.mode === "height") region.style.height = `${moving.value}px`

    return true
  }

  createEffect(() => {
    if (!expandable()) dispatch(COLLAPSE_SOURCES_EXPAND_EVENT)
  })

  onCleanup(
    observeReducedMotion(() => {
      if (prefersReducedMotion()) dispatch(REDUCED_SOURCES_EXPAND_EVENT)
    }),
  )

  onCleanup(() => dispatch(DISPOSED_SOURCES_EXPAND_EVENT))

  const toggle = () =>
    dispatch({ type: "toggle", expandable: expandable(), reduced: prefersReducedMotion(), curve: sourcesExpand() })

  return (
    <div data-slot="sources-step" data-open={open() ? "" : undefined}>
      <button
        type="button"
        data-slot="sources-step-row"
        aria-expanded={expandable() ? open() : undefined}
        disabled={!expandable()}
        onClick={toggle}
      >
        <span data-slot="sources-step-icon">
          <Icon name="magnifying-glass" size="small" />
        </span>
        <span data-slot="sources-step-text">
          <span data-slot="sources-step-label">
            {i18n.t(props.step.status === "error" ? "ui.sources.searchFailed" : "ui.sources.searched")}
          </span>
          <span data-slot="sources-step-detail">{props.step.query}</span>
          <Show when={props.step.error}>{(error) => <span data-slot="sources-step-error">{error()}</span>}</Show>
        </span>
        <Show when={props.step.status === "completed"}>
          <span data-slot="sources-step-count" data-empty={expandable() ? undefined : ""}>
            {expandable() ? props.step.results.length : i18n.t("ui.sources.noResults")}
          </span>
        </Show>
      </button>
      <div ref={region} data-slot="sources-step-results" style={{ height: "0px" }}>
        <div ref={list} data-slot="sources-step-list">
          <Show when={mounted()}>
            <For each={props.step.results}>
              {(result) => <ResultRow result={result} icons={props.icons} onOpen={props.onOpen} />}
            </For>
          </Show>
        </div>
      </div>
    </div>
  )
}

function ResultRow(props: { result: SourceResult; icons: SiteIconMode; onOpen: (url: string) => void }) {
  return (
    <a
      data-slot="sources-result"
      href={props.result.url}
      title={props.result.url}
      onClick={(event) => {
        event.preventDefault()
        props.onOpen(props.result.url)
      }}
    >
      <SiteIcon site={props.result.site} host={props.result.host} mode={props.icons} />
      <span data-slot="sources-result-text">
        <span data-slot="sources-result-title">{props.result.title ?? props.result.url}</span>
        <span data-slot="sources-result-site">{props.result.site}</span>
      </span>
    </a>
  )
}

function FetchStep(props: { step: Extract<SourceStep, { type: "fetch" }>; onOpen: (url: string) => void }) {
  const i18n = useI18n()

  return (
    <div data-slot="sources-step">
      <a
        data-slot="sources-step-row"
        href={props.step.url}
        title={props.step.url}
        onClick={(event) => {
          event.preventDefault()
          props.onOpen(props.step.url)
        }}
      >
        <span data-slot="sources-step-icon">
          <Icon name="window-cursor" size="small" />
        </span>
        <span data-slot="sources-step-text">
          <span data-slot="sources-step-label">
            {i18n.t(props.step.status === "error" ? "ui.sources.openFailed" : "ui.sources.opened")}
          </span>
          <span data-slot="sources-step-detail">
            {props.step.site}
            <span data-slot="sources-step-path">{props.step.path}</span>
          </span>
          <Show when={props.step.error}>{(error) => <span data-slot="sources-step-error">{error()}</span>}</Show>
        </span>
      </a>
    </div>
  )
}
