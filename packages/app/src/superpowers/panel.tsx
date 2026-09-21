import "./execution.css"
import { For, Match, Show, Switch } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { ExecutionAgentList } from "./agent-list"
import { EXECUTION_SUBVIEWS, type ExecutionModel } from "./model"

export type ExecutionPresentation = "panel" | "expanded" | "mobile"

export function ExecutionPanel(props: { model: ExecutionModel; presentation: ExecutionPresentation }) {
  const language = useLanguage()
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
              aria-pressed={props.model.subview() === subview}
              class="execution-panel__subview"
              classList={{ "execution-panel__subview--active": props.model.subview() === subview }}
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
          <Match when={props.model.subview() === "agents"}>
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
          <Match when={props.model.subview() === "map"}>
            <div data-slot="execution-graph" data-testid="execution-graph" class="execution-panel__graph">
              <TrackingUnavailable />
            </div>
          </Match>
          <Match when={props.model.subview() === "tasks"}>
            <TrackingUnavailable />
          </Match>
          <Match when={props.model.subview() === "activity"}>
            <TrackingUnavailable />
          </Match>
        </Switch>
      </div>
    </section>
  )
}

function TrackingUnavailable() {
  const language = useLanguage()
  return (
    <div data-slot="execution-tracking-unavailable" class="execution-panel__unavailable">
      <p class="execution-panel__unavailable-title">{language.t("execution.tracking.unavailable.title")}</p>
      <p class="execution-panel__unavailable-description">
        {language.t("execution.tracking.unavailable.description")}
      </p>
    </div>
  )
}
