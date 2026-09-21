import "./execution.css"
import { For, Match, Show, Suspense, Switch, createEffect, createSignal, lazy } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { ExecutionAgentList } from "./agent-list"
import { ExecutionActivityFeed } from "./activity-feed"
import { ExecutionTaskDetails } from "./task-details"
import { ExecutionTaskList } from "./task-list"
import { EXECUTION_SUBVIEWS, structuredViewsEnabled, type ExecutionModel, type ExecutionSubview } from "./model"

const LazyExecutionMap = lazy(() =>
  import("./execution-map").then((module) => ({ default: module.ExecutionMap })),
)

export type ExecutionPresentation = "panel" | "expanded" | "mobile"

function subviewTabID(subview: ExecutionSubview) {
  return `execution-subview-tab-${subview}`
}

export function ExecutionPanel(props: {
  model: ExecutionModel
  presentation: ExecutionPresentation
  onExpand?: () => void
}) {
  const language = useLanguage()
  const structuredEnabled = () => structuredViewsEnabled(props.model.mode())
  const effectiveSubview = () => (structuredEnabled() ? props.model.subview() : "agents")
  const enabledSubviews = () => EXECUTION_SUBVIEWS.filter((subview) => subview === "agents" || structuredEnabled())
  const [focusedSubview, setFocusedSubview] = createSignal<ExecutionSubview | undefined>()
  const tabStop = () => {
    const current = focusedSubview()
    if (current && enabledSubviews().includes(current)) return current
    return effectiveSubview()
  }
  createEffect(() => setFocusedSubview(effectiveSubview()))
  const moveSubviewFocus = (event: KeyboardEvent, subview: ExecutionSubview) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft" && event.key !== "Home" && event.key !== "End") return
    event.preventDefault()
    const options = enabledSubviews()
    const index = options.indexOf(subview)
    if (index < 0) return
    const forward = getComputedStyle(event.currentTarget as Element).direction === "rtl" ? -1 : 1
    const step = event.key === "ArrowRight" ? forward : event.key === "ArrowLeft" ? -forward : 0
    const target =
      event.key === "Home"
        ? options[0]
        : event.key === "End"
          ? options[options.length - 1]
          : options[(index + step + options.length) % options.length]
    if (!target) return
    setFocusedSubview(target)
    document.getElementById(subviewTabID(target))?.focus()
  }
  return (
    <section
      data-slot="execution-panel"
      data-testid="execution-panel"
      data-presentation={props.presentation}
      data-mode={props.model.mode()}
      aria-label={language.t("execution.panel.label")}
      class="execution-panel"
    >
      <div data-slot="execution-toolbar" class="execution-panel__toolbar">
        <div role="tablist" aria-label={language.t("execution.subviews.label")} class="execution-panel__tabs">
          <For each={EXECUTION_SUBVIEWS}>
            {(subview) => (
              <button
                type="button"
                id={subviewTabID(subview)}
                role="tab"
                data-subview={subview}
                disabled={subview !== "agents" && !structuredEnabled()}
                aria-selected={effectiveSubview() === subview}
                aria-controls="execution-subview-panel"
                tabindex={tabStop() === subview ? 0 : -1}
                class="execution-panel__subview disabled:opacity-60"
                classList={{ "execution-panel__subview--active": effectiveSubview() === subview }}
                onClick={() => {
                  setFocusedSubview(subview)
                  props.model.selectSubview(subview)
                }}
                onFocus={() => setFocusedSubview(subview)}
                onKeyDown={(event) => moveSubviewFocus(event, subview)}
              >
                {language.t(`execution.subview.${subview}`)}
              </button>
            )}
          </For>
        </div>
        <Show when={props.presentation === "panel"}>
          <span class="execution-panel__spacer" aria-hidden />
          <button
            type="button"
            data-testid="execution-expand"
            class="execution-panel__expand"
            aria-label={language.t("execution.expand")}
            onClick={() => (props.onExpand ? props.onExpand() : props.model.setExpanded(true))}
          >
            {language.t("execution.expand.short")}
          </button>
        </Show>
      </div>
      <Show when={props.model.mode() !== "observer" && props.model.mode() !== "ready"}>
        <p
          data-slot="execution-mode-notice"
          data-mode={props.model.mode()}
          class="execution-panel__unavailable-description px-3 py-1.5"
          role="status"
        >
          <Switch>
            <Match when={props.model.mode() === "stale"}>{language.t("execution.mode.stale")}</Match>
            <Match when={props.model.mode() === "incompatible"}>{language.t("execution.mode.incompatible")}</Match>
            <Match when={props.model.mode() === "unavailable"}>{language.t("execution.mode.unavailable")}</Match>
          </Switch>
        </p>
      </Show>
      <div
        data-slot="execution-body"
        class="execution-panel__body"
        role="tabpanel"
        id="execution-subview-panel"
        aria-labelledby={subviewTabID(effectiveSubview())}
      >
        <Switch>
          <Match when={effectiveSubview() === "agents"}>
            <Show
              when={props.model.agents().length > 0}
              fallback={
                <p data-slot="execution-agents-empty" class="execution-panel__empty">
                  {language.t("execution.agents.empty")}
                </p>
              }
            >
              <ExecutionAgentList model={props.model} />
            </Show>
          </Match>
          <Match when={effectiveSubview() === "map"}>
            <Show
              when={props.model.run()}
              fallback={
                <div data-slot="execution-graph" data-testid="execution-graph" class="execution-panel__graph">
                  <TrackingUnavailable model={props.model} />
                </div>
              }
            >
              <div data-slot="execution-graph" data-testid="execution-graph" class="execution-panel__graph-view">
                <Suspense
                  fallback={
                    <p class="execution-panel__empty" data-testid="execution-map-loading">
                      {language.t("execution.map.loading")}
                    </p>
                  }
                >
                  <LazyExecutionMap model={props.model} />
                </Suspense>
              </div>
            </Show>
          </Match>
          <Match when={effectiveSubview() === "tasks"}>
            <div data-slot="execution-tasks-view" class="execution-tasks-view">
              <ExecutionTaskList model={props.model} />
              <ExecutionTaskDetails model={props.model} />
            </div>
          </Match>
          <Match when={effectiveSubview() === "activity"}>
            <Show when={props.model.run()} fallback={<TrackingUnavailable model={props.model} />}>
              <ExecutionActivityFeed model={props.model} />
            </Show>
          </Match>
        </Switch>
      </div>
    </section>
  )
}

function TrackingUnavailable(props: { model: ExecutionModel }) {
  const language = useLanguage()
  const description = () =>
    props.model.reason() === "no_run"
      ? language.t("execution.tracking.noRun")
      : language.t("execution.tracking.unavailable.description")
  return (
    <div
      data-slot="execution-tracking-unavailable"
      data-reason={props.model.reason()}
      class="execution-panel__unavailable"
    >
      <p class="execution-panel__unavailable-title">{language.t("execution.tracking.unavailable.title")}</p>
      <p class="execution-panel__unavailable-description">{description()}</p>
    </div>
  )
}
