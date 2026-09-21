import "./execution.css"
import { For, Match, Show, Suspense, Switch, lazy } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { ExecutionAgentList } from "./agent-list"
import { ExecutionTaskDetails } from "./task-details"
import { ExecutionTaskList } from "./task-list"
import { EXECUTION_SUBVIEWS, structuredViewsEnabled, type ExecutionModel } from "./model"

const LazyExecutionMap = lazy(() =>
  import("./execution-map").then((module) => ({ default: module.ExecutionMap })),
)

export type ExecutionPresentation = "panel" | "expanded" | "mobile"

export function ExecutionPanel(props: { model: ExecutionModel; presentation: ExecutionPresentation }) {
  const language = useLanguage()
  const structuredEnabled = () => structuredViewsEnabled(props.model.mode())
  const effectiveSubview = () => (structuredEnabled() ? props.model.subview() : "agents")
  return (
    <section
      data-slot="execution-panel"
      data-testid="execution-panel"
      data-presentation={props.presentation}
      data-mode={props.model.mode()}
      aria-label={language.t("execution.panel.label")}
      class="execution-panel"
    >
      <nav
        data-slot="execution-toolbar"
        class="execution-panel__toolbar"
        aria-label={language.t("execution.subviews.label")}
      >
        <For each={EXECUTION_SUBVIEWS}>
          {(subview) => (
            <button
              type="button"
              data-subview={subview}
              disabled={subview !== "agents" && !structuredEnabled()}
              aria-pressed={effectiveSubview() === subview}
              class="execution-panel__subview disabled:opacity-60"
              classList={{ "execution-panel__subview--active": effectiveSubview() === subview }}
              onClick={() => props.model.selectSubview(subview)}
            >
              {language.t(`execution.subview.${subview}`)}
            </button>
          )}
        </For>
      </nav>
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
      <div data-slot="execution-body" class="execution-panel__body">
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
            <TrackingUnavailable model={props.model} />
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
