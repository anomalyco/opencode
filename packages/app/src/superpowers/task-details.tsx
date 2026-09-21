import { For, Show, createMemo } from "solid-js"
import type { Gate, Outcome, Task } from "@bearmanser/opencode-superpowers-execution/contract"
import { useLanguage } from "@/runtime/i18n/language"
import { agentRoleKey, taskStateKey } from "./task-list"
import {
  latestEvidenceForGate,
  type ExecutionAgentState,
  type ExecutionAssignmentJoin,
  type ExecutionEvidenceJoin,
  type ExecutionModel,
} from "./model"

export function ExecutionTaskDetails(props: { model: ExecutionModel }) {
  const language = useLanguage()
  const task = () => props.model.selectedTask()
  const assignments = createMemo(() => {
    const current = task()
    if (!current) return undefined
    return props.model.taskAssignments(current.id, current.attempt)
  })
  const evidence = createMemo(() => {
    const current = task()
    if (!current) return undefined
    return props.model.taskEvidence(current.id, current.attempt)
  })

  const gates = createMemo(() => {
    const current = task()
    if (!current) return []
    const currentEvidence = evidence()?.current ?? []
    return current.requiredGates.map((gate) => ({
      gate,
      latest: latestEvidenceForGate(currentEvidence, gate),
    }))
  })

  const dependencies = createMemo<{ id: string; title: string; state: Task["state"] }[]>(() => {
    const current = task()
    const run = props.model.run()
    if (!current || !run) return []
    return current.dependsOn.flatMap((id) => {
      const dependency = run.tasks.find((candidate) => candidate.id === id)
      return dependency ? [{ id: dependency.id, title: dependency.title, state: dependency.state }] : [{ id, title: id, state: "pending" as const }]
    })
  })

  const waitingOnDependencies = createMemo(() => dependencies().some((dependency) => dependency.state !== "verified"))

  return (
    <Show
      when={task()}
      fallback={
        <p class="execution-task-details__empty" data-testid="execution-task-details-empty">
          {language.t("execution.task.details.empty")}
        </p>
      }
    >
      {(current) => (
        <section
          class="execution-task-details"
          data-testid="execution-task-details"
          aria-label={language.t("execution.task.details.label")}
        >
          <header class="execution-task-details__header">
            <span class="execution-task-details__title" data-testid="execution-task-title">
              {current().title}
            </span>
            <span class="execution-task-details__outcome" data-testid="execution-task-outcome" data-state={current().state}>
              {language.t(taskStateKey(current().state))}
            </span>
            <span class="execution-task-details__phase">
              {language.t("execution.task.phase", { phase: current().phase })}
            </span>
            <span class="execution-task-details__attempt" data-testid="execution-task-attempt">
              {language.t("execution.task.attempt", { attempt: current().attempt })}
            </span>
            <Show when={current().state === "verified"}>
              <span class="execution-task-details__verified" data-testid="execution-task-verified">
                {language.t("execution.task.verifiedReported")}
              </span>
            </Show>
          </header>
          <p class="execution-task-details__provenance" data-testid="execution-task-provenance">
            {language.t("execution.task.provenance")}
          </p>
          <Show when={current().reason}>
            <p class="execution-task-details__reason">
              <span class="execution-task-details__label">{language.t("execution.task.reason.label")}</span>
              <span data-testid="execution-task-reason">{current().reason}</span>
            </p>
          </Show>
          <Show when={current().finalReview}>
            <p class="execution-task-details__final-review" data-testid="execution-task-final-review">
              {current().state === "verified"
                ? language.t("execution.task.finalReview")
                : language.t("execution.task.finalReview.pending")}
            </p>
          </Show>

          <section class="execution-task-details__section">
            <h4 class="execution-task-details__heading">{language.t("execution.task.dependencies.label")}</h4>
            <Show
              when={dependencies().length > 0}
              fallback={
                <p class="execution-task-details__muted" data-testid="execution-task-dependencies-none">
                  {language.t("execution.task.dependencies.none")}
                </p>
              }
            >
              <ul class="execution-task-details__list" data-testid="execution-task-dependencies">
                <For each={dependencies()}>
                  {(dependency) => (
                    <li data-task-id={dependency.id} data-state={dependency.state}>
                      {dependency.title}
                    </li>
                  )}
                </For>
              </ul>
            </Show>
            <Show when={waitingOnDependencies()}>
              <p class="execution-task-details__waiting" data-testid="execution-task-dependencies-waiting">
                {language.t("execution.task.dependencies.waiting")}
              </p>
            </Show>
          </section>

          <section class="execution-task-details__section">
            <h4 class="execution-task-details__heading">{language.t("execution.task.gates.label")}</h4>
            <ul class="execution-task-details__list">
              <For each={gates()}>
                {(gate) => (
                  <li
                    class="execution-task-details__gate"
                    data-testid={`execution-gate-${gate.gate}`}
                    data-outcome={gate.latest?.outcome ?? "unrun"}
                  >
                    <span class="execution-task-details__gate-name">{language.t(gateNameKey(gate.gate))}</span>
                    <span class="execution-task-details__gate-outcome">
                      {gate.latest
                        ? language.t(gateOutcomeKey(gate.latest.outcome))
                        : language.t("execution.task.gate.outcome.unrun")}
                    </span>
                  </li>
                )}
              </For>
            </ul>
          </section>

          <section class="execution-task-details__section">
            <h4 class="execution-task-details__heading">{language.t("execution.task.evidence.label")}</h4>
            <Show
              when={(evidence()?.current.length ?? 0) > 0}
              fallback={
                <p class="execution-task-details__muted" data-testid="execution-task-evidence-none">
                  {language.t("execution.task.evidence.none")}
                </p>
              }
            >
              <ul class="execution-task-details__list" data-testid="execution-task-evidence-current">
                <For each={evidence()?.current ?? []}>
                  {(item) => <EvidenceRow model={props.model} item={item} />}
                </For>
              </ul>
            </Show>
            <Show when={(evidence()?.superseded.length ?? 0) > 0}>
              <p class="execution-task-details__subheading">{language.t("execution.task.evidence.superseded")}</p>
              <ul class="execution-task-details__list" data-testid="execution-task-evidence-superseded">
                <For each={evidence()?.superseded ?? []}>
                  {(item) => <EvidenceRow model={props.model} item={item} />}
                </For>
              </ul>
            </Show>
          </section>

          <section class="execution-task-details__section">
            <h4 class="execution-task-details__heading">{language.t("execution.task.assignments.label")}</h4>
            <p class="execution-task-details__agent-count" data-testid="execution-task-agent-count">
              {language.plural("execution.task.assignments.agentCount", assignments()?.uniqueSessions ?? 0)}
            </p>
            <Show
              when={(assignments()?.current.length ?? 0) > 0}
              fallback={
                <p class="execution-task-details__muted" data-testid="execution-task-assignments-none">
                  {language.t("execution.task.assignments.none")}
                </p>
              }
            >
              <p class="execution-task-details__subheading">{language.t("execution.task.assignments.current")}</p>
              <ul class="execution-task-details__list" data-testid="execution-task-assignments-current">
                <For each={assignments()?.current ?? []}>
                  {(item) => <AssignmentRow item={item} />}
                </For>
              </ul>
            </Show>
            <Show when={(assignments()?.history.length ?? 0) > 0}>
              <p class="execution-task-details__subheading">{language.t("execution.task.assignments.history")}</p>
              <ul class="execution-task-details__list" data-testid="execution-task-assignments-history">
                <For each={assignments()?.history ?? []}>
                  {(item) => <AssignmentRow item={item} />}
                </For>
              </ul>
            </Show>
          </section>
        </section>
      )}
    </Show>
  )
}

function EvidenceRow(props: { model: ExecutionModel; item: ExecutionEvidenceJoin }) {
  const language = useLanguage()
  const resolution = () => props.model.evidenceResolution(props.item.id)
  const available = () => props.item.available && resolution() !== "unavailable"
  const unavailableReason = () =>
    props.item.available
      ? "execution.task.evidence.notFound"
      : "execution.task.evidence.unavailable"
  return (
    <li
      class="execution-evidence"
      data-testid={`execution-evidence-${props.item.id}`}
      data-available={String(available())}
      data-resolving={resolution() === "resolving" ? "true" : undefined}
      data-outcome={props.item.outcome}
      data-message-id={props.item.messageID}
      data-part-id={props.item.partID}
    >
      <span class="execution-evidence__gate">{language.t(gateNameKey(props.item.gate))}</span>
      <span class="execution-evidence__outcome">{language.t(gateOutcomeKey(props.item.outcome))}</span>
      <span class="execution-evidence__summary">{props.item.summary}</span>
      <Show
        when={available()}
        fallback={
          <span class="execution-evidence__unavailable">{language.t(unavailableReason())}</span>
        }
      >
        <button
          type="button"
          class="execution-evidence__open"
          onClick={() =>
            props.model.openEvidence({
              id: props.item.id,
              sessionID: props.item.sessionID,
              messageID: props.item.messageID,
              partID: props.item.partID,
            })
          }
        >
          {language.t("execution.task.evidence.open", {
            session: props.item.sessionTitle ?? props.item.sessionID,
          })}
        </button>
      </Show>
      <time class="execution-evidence__time" dateTime={new Date(props.item.createdAt).toISOString()}>
        {language.t("execution.task.evidence.reported", {
          session: props.item.reportedBySessionID,
          time: formatTime(props.item.createdAt),
        })}
      </time>
    </li>
  )
}

function AssignmentRow(props: { item: ExecutionAssignmentJoin }) {
  const language = useLanguage()
  return (
    <li
      class="execution-assignment"
      data-testid={`execution-assignment-${props.item.id}`}
      data-session-id={props.item.sessionID}
      data-native-state={props.item.sessionState ?? "unknown"}
      data-active={String(props.item.active)}
      data-available={String(props.item.available)}
    >
      <span class="execution-assignment__role">{language.t(agentRoleKey(props.item.role))}</span>
      <span class="execution-assignment__session">
        {props.item.sessionTitle ?? props.item.sessionID}
      </span>
      <Show
        when={props.item.available}
        fallback={
          <span class="execution-assignment__unavailable">
            {language.t("execution.task.assignments.sessionUnavailable")}
          </span>
        }
      >
        <span class="execution-assignment__native">
          {language.t("execution.task.assignments.native", {
            state: language.t(nativeStateKey(props.item.sessionState)),
          })}
        </span>
      </Show>
      <span class="execution-assignment__status">
        {props.item.active
          ? language.t("execution.task.assignments.active")
          : language.t("execution.task.assignments.endedBadge")}
      </span>
      <time class="execution-assignment__time" dateTime={new Date(props.item.createdAt).toISOString()}>
        {language.t("execution.task.assignments.reported", { time: formatTime(props.item.createdAt) })}
      </time>
      <Show when={props.item.endedAt}>
        {(endedAt) => (
          <time class="execution-assignment__time" dateTime={new Date(endedAt()).toISOString()}>
            {language.t("execution.task.assignments.ended", { time: formatTime(endedAt()) })}
          </time>
        )}
      </Show>
    </li>
  )
}

function gateNameKey(gate: Gate) {
  if (gate === "tests") return "execution.task.gate.tests" as const
  if (gate === "spec_review") return "execution.task.gate.spec_review" as const
  if (gate === "code_review") return "execution.task.gate.code_review" as const
  return "execution.task.gate.manual" as const
}

function gateOutcomeKey(outcome: Outcome) {
  if (outcome === "failed") return "execution.task.gate.outcome.failed" as const
  return "execution.task.gate.outcome.passed" as const
}

function nativeStateKey(state: ExecutionAgentState | undefined) {
  if (state === "running") return "execution.agent.state.running" as const
  if (state === "idle") return "execution.agent.state.idle" as const
  if (state === "needs_input") return "execution.agent.state.needs_input" as const
  if (state === "error") return "execution.agent.state.error" as const
  return "execution.agent.state.unknown" as const
}

function formatTime(value: number) {
  return new Date(value).toISOString()
}
