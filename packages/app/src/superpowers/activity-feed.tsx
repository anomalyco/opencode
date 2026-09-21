import { For, Show } from "solid-js"
import type { OperationType } from "@bearmanser/opencode-superpowers-execution/contract"
import { useLanguage } from "@/runtime/i18n/language"
import type { ExecutionActivityEvent, ExecutionModel } from "./model"

export function ExecutionActivityFeed(props: { model: ExecutionModel }) {
  const language = useLanguage()
  const page = () => props.model.activity()
  return (
    <div class="execution-activity" data-testid="execution-activity">
      <p class="execution-activity__note">{language.t("execution.activity.note")}</p>
      <Show
        when={page().total > 0}
        fallback={
          <p class="execution-activity__empty" data-testid="execution-activity-empty">
            {language.t("execution.activity.empty")}
          </p>
        }
      >
        <ul
          class="execution-activity__list"
          data-testid="execution-activity-list"
          aria-label={language.t("execution.activity.list.label")}
        >
          <For each={page().events}>{(event) => <ActivityRow model={props.model} event={event} />}</For>
        </ul>
      </Show>
      <Show when={page().hasMore}>
        <button
          type="button"
          class="execution-activity__more"
          data-testid="execution-activity-more"
          onClick={() => props.model.loadMoreActivity()}
        >
          {language.t("execution.activity.loadMore")}
        </button>
      </Show>
      <Show when={page().truncatedBeforeRevision}>
        {(revision) => (
          <p class="execution-activity__boundary" data-testid="execution-activity-boundary" role="status">
            {language.t("execution.activity.boundary", { revision: revision() })}
          </p>
        )}
      </Show>
      <ActivityUsage model={props.model} />
    </div>
  )
}

function ActivityRow(props: { model: ExecutionModel; event: ExecutionActivityEvent }) {
  const language = useLanguage()
  return (
    <li
      class="execution-activity__event"
      data-testid="execution-activity-event"
      data-revision={props.event.revision}
      data-type={props.event.type}
      data-task-id={props.event.taskID}
      data-session-id={props.event.sessionID}
    >
      <span class="execution-activity__revision">
        {language.t("execution.activity.revision", { revision: props.event.revision })}
      </span>
      <span class="execution-activity__type">{language.t(activityTypeKey(props.event.type))}</span>
      <span class="execution-activity__summary">{props.event.summary}</span>
      <Show when={props.event.taskID}>
        {(taskID) => (
          <button
            type="button"
            class="execution-activity__link"
            aria-label={language.t("execution.activity.task.open", {
              title: props.event.taskTitle ?? taskID(),
            })}
            onClick={() => {
              props.model.selectTask(taskID())
              props.model.selectSubview("tasks")
            }}
          >
            {language.t("execution.activity.task.link")}
          </button>
        )}
      </Show>
      <Show when={props.event.sessionID}>
        {(sessionID) => (
          <button
            type="button"
            class="execution-activity__link"
            aria-label={language.t("execution.activity.session.open", {
              session: props.event.sessionTitle || sessionID(),
            })}
            onClick={() => props.model.openSession(sessionID())}
          >
            {language.t("execution.activity.session.link")}
          </button>
        )}
      </Show>
      <time class="execution-activity__time" dateTime={new Date(props.event.createdAt).toISOString()}>
        {language.t("execution.activity.reported", { time: new Date(props.event.createdAt).toISOString() })}
      </time>
    </li>
  )
}

function ActivityUsage(props: { model: ExecutionModel }) {
  const language = useLanguage()
  const usage = () => props.model.activityUsage()
  const coverage = () => {
    const cost = usage().cost.coverage
    const tokens = usage().tokens.coverage
    if (cost === "unavailable" && tokens === "unavailable") return "unavailable"
    if (cost === "complete" && tokens === "complete") return "complete"
    return "partial"
  }
  const cost = () => {
    const value = usage().cost.value
    return value === undefined
      ? undefined
      : new Intl.NumberFormat(language.intl(), { style: "currency", currency: "USD" }).format(value)
  }
  const tokenTotalValue = () => usage().tokens.value
  const tokens = () => tokenTotalValue()?.toLocaleString(language.intl())
  return (
    <section class="execution-activity__usage" data-testid="execution-activity-usage" data-coverage={coverage()}>
      <Show
        when={coverage() !== "unavailable"}
        fallback={
          <p class="execution-activity__usage-unavailable">
            {language.t("execution.activity.usage.unavailable")}
          </p>
        }
      >
        <Show when={cost()}>
          {(value) => <span>{language.t("execution.activity.usage.cost", { cost: value() })}</span>}
        </Show>
        <Show when={tokens()}>
          {(value) => (
            <span>
              {language.plural("execution.activity.usage.tokens", tokenTotalValue() ?? 0, { tokens: value() })}
            </span>
          )}
        </Show>
        <Show when={coverage() === "partial"}>
          <span class="execution-activity__usage-partial">{language.t("execution.activity.usage.partial")}</span>
        </Show>
        <p class="execution-activity__usage-source">{language.t("execution.activity.usage.source")}</p>
      </Show>
    </section>
  )
}

function activityTypeKey(type: OperationType) {
  if (type === "run.start") return "execution.activity.type.run.start" as const
  if (type === "task.state") return "execution.activity.type.task.state" as const
  if (type === "assignment.add") return "execution.activity.type.assignment.add" as const
  if (type === "assignment.end") return "execution.activity.type.assignment.end" as const
  if (type === "evidence.add") return "execution.activity.type.evidence.add" as const
  if (type === "task.verify") return "execution.activity.type.task.verify" as const
  if (type === "task.reopen") return "execution.activity.type.task.reopen" as const
  if (type === "plan.revise") return "execution.activity.type.plan.revise" as const
  if (type === "run.finish") return "execution.activity.type.run.finish" as const
  return "execution.activity.type.run.cancel" as const
}
