import { useI18n } from "@opencode/ui/context/i18n"
import { Icon } from "@opencode/ui/icon"
import { frameLoop, prefersReducedMotion, Spring } from "@opencode/ui/motion"
import { createSignal, For, Match, onCleanup, Show, Switch } from "solid-js"
import { sourcesExpand, type SiteIconMode } from "./experiment"
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
  const [state, setState] = createSignal({ open: false, mounted: false })
  const expandable = () => props.step.results.length > 0
  let region: HTMLDivElement | undefined
  let list: HTMLDivElement | undefined
  let stop: (() => void) | undefined
  // Height follows one spring; opening again mid-close keeps its velocity.
  const spring = new Spring(0)
  onCleanup(() => stop?.())

  const toggle = () => {
    const open = !state().open
    setState({ open, mounted: true })

    if (!region || !list) return
    const el = region
    // Layout is read once per toggle, never per frame: the results' height, now that they render, and where a
    // resting region starts from. A moving one starts from its spring.
    const height = open ? list.offsetHeight : 0

    if (!stop) spring.snap(el.offsetHeight)
    stop?.()
    stop = undefined

    if (prefersReducedMotion()) {
      spring.snap(height)
      el.style.height = open ? "" : "0px"

      if (open) fadeIn(list)

      if (!open) setState({ open, mounted: false })

      return
    }

    const options = sourcesExpand()
    spring.omega = (2 * Math.PI) / options.duration
    spring.zeta = 1 - options.bounce
    spring.set(height)
    el.dataset.moving = ""

    stop = frameLoop.add((dt) => {
      el.style.height = `${spring.step(dt)}px`

      if (!spring.resting) return true
      delete el.dataset.moving
      el.style.height = open ? "" : "0px"
      stop = undefined

      if (!open) setState({ open, mounted: false })

      return false
    })
  }

  return (
    <div data-slot="sources-step" data-open={state().open ? "" : undefined}>
      <button
        type="button"
        data-slot="sources-step-row"
        aria-expanded={expandable() ? state().open : undefined}
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
          <Show when={state().mounted}>
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

// Reduced motion trades the height for a short fade.
function fadeIn(el: HTMLElement) {
  const spring = Spring.fromDuration(0, { duration: 0.15, bounce: 0 })
  spring.set(1)
  el.style.opacity = "0"
  frameLoop.add((dt) => {
    el.style.opacity = String(spring.step(dt))

    if (!spring.resting) return true
    el.style.opacity = ""

    return false
  })
}
