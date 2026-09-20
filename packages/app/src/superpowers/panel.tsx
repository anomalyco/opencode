import "./execution.css"
import { For, Match, Switch } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { EXECUTION_SUBVIEWS, type ExecutionModel } from "./model"

export type ExecutionPresentation = "panel" | "expanded" | "mobile"

export function ExecutionPanel(props: { model: ExecutionModel; presentation: ExecutionPresentation }) {
  const language = useLanguage()
  return (
    <section
      data-slot="execution-panel"
      data-testid="execution-panel"
      data-presentation={props.presentation}
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
      <div data-slot="execution-body" class="execution-panel__body">
        <Switch>
          <Match when={props.model.subview() === "agents"}>
            <p data-slot="execution-agents-empty" class="execution-panel__empty">
              {language.t("execution.agents.empty")}
            </p>
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
