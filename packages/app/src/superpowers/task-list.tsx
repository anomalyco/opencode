import { For, Show, createEffect, createMemo, createSignal } from "solid-js"
import type { Task } from "@bearmanser/opencode-superpowers-execution/contract"
import { useLanguage } from "@/runtime/i18n/language"
import { ExecutionProgress } from "./progress"
import type { ExecutionAgentRole, ExecutionModel } from "./model"

const TASK_STATES = ["pending", "running", "blocked", "awaiting_review", "verified", "failed", "skipped"] as const

export function ExecutionTaskList(props: { model: ExecutionModel }) {
  const language = useLanguage()
  const [query, setQuery] = createSignal("")
  const [state, setState] = createSignal("all")
  const [phase, setPhase] = createSignal("all")

  const tasks = createMemo(() => props.model.run()?.tasks ?? [])
  const phases = createMemo(() => [...new Set(tasks().map((task) => task.phase))].sort())
  const filtered = createMemo(() => {
    const needle = query().trim().toLowerCase()
    const selectedState = state()
    const selectedPhase = phase()
    return tasks()
      .filter((task) => selectedState === "all" || task.state === selectedState)
      .filter((task) => selectedPhase === "all" || task.phase === selectedPhase)
      .filter((task) => {
        if (!needle) return true
        return task.title.toLowerCase().includes(needle) || task.id.toLowerCase().includes(needle)
      })
      .slice()
      .sort((left, right) => left.order - right.order || compareIDs(left, right))
  })

  createEffect(() => {
    const current = props.model.selectedTaskID()
    if (current && tasks().some((task) => task.id === current)) return
    const first = tasks()[0]
    if (first) props.model.selectTask(first.id)
  })

  const assignmentCount = (taskID: string) =>
    props.model.run()?.assignments.filter((assignment) => assignment.taskID === taskID).length ?? 0

  return (
    <div class="execution-tasks" data-testid="execution-tasks">
      <ExecutionProgress
        summary={props.model.progress()}
        runStatus={props.model.run()?.status}
        stale={props.model.attention().stale}
      />
      <Show when={props.model.run()}>
        {(run) => (
          <div class="execution-tasks__meta">
            <span data-testid="execution-plan-revision">
              {language.t("execution.tasks.planRevision", { revision: run().plan.revision })}
            </span>
          </div>
        )}
      </Show>
      <div class="execution-tasks__filters">
        <input
          type="search"
          class="execution-tasks__search"
          aria-label={language.t("execution.tasks.search.label")}
          placeholder={language.t("execution.tasks.search.placeholder")}
          value={query()}
          onInput={(event) => setQuery(event.currentTarget.value)}
        />
        <select
          class="execution-tasks__filter"
          aria-label={language.t("execution.tasks.filter.state.label")}
          value={state()}
          onChange={(event) => setState(event.currentTarget.value)}
        >
          <option value="all">{language.t("execution.tasks.filter.state.all")}</option>
          <For each={TASK_STATES}>
            {(option) => <option value={option}>{language.t(taskStateKey(option))}</option>}
          </For>
        </select>
        <select
          class="execution-tasks__filter"
          aria-label={language.t("execution.tasks.filter.phase.label")}
          value={phase()}
          onChange={(event) => setPhase(event.currentTarget.value)}
        >
          <option value="all">{language.t("execution.tasks.filter.phase.all")}</option>
          <For each={phases()}>{(option) => <option value={option}>{option}</option>}</For>
        </select>
      </div>
      <Show
        when={filtered().length > 0}
        fallback={
          <p class="execution-tasks__empty" data-testid="execution-tasks-empty">
            {tasks().length === 0 ? language.t("execution.tasks.noRun") : language.t("execution.tasks.empty")}
          </p>
        }
      >
        <ul
          role="list"
          aria-label={language.t("execution.tasks.label")}
          class="execution-tasks__list"
          data-testid="execution-tasks-list"
        >
          <For each={filtered()}>
            {(task) => (
              <li class="execution-tasks__item">
                <button
                  type="button"
                  data-task-id={task.id}
                  data-state={task.state}
                  aria-pressed={props.model.selectedTaskID() === task.id}
                  aria-label={language.t("execution.tasks.row.label", {
                    title: task.title,
                    state: language.t(taskStateKey(task.state)),
                  })}
                  class="execution-task"
                  classList={{ "execution-task--selected": props.model.selectedTaskID() === task.id }}
                  onClick={() => props.model.selectTask(task.id)}
                >
                  <span class="execution-task__title">{task.title}</span>
                  <span class="execution-task__phase">{task.phase}</span>
                  <span class="execution-task__state">{language.t(taskStateKey(task.state))}</span>
                  <span class="execution-task__attempt">
                    {language.t("execution.task.attempt", { attempt: task.attempt })}
                  </span>
                  <Show when={assignmentCount(task.id) > 0}>
                    <span class="execution-task__assignments">
                      {language.plural("execution.tasks.assignmentCount", assignmentCount(task.id))}
                    </span>
                  </Show>
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  )
}

export function taskStateKey(state: Task["state"]) {
  if (state === "running") return "execution.task.state.running" as const
  if (state === "blocked") return "execution.task.state.blocked" as const
  if (state === "awaiting_review") return "execution.task.state.awaiting_review" as const
  if (state === "verified") return "execution.task.state.verified" as const
  if (state === "failed") return "execution.task.state.failed" as const
  if (state === "skipped") return "execution.task.state.skipped" as const
  return "execution.task.state.pending" as const
}

export function agentRoleKey(role: ExecutionAgentRole) {
  if (role === "controller") return "execution.agent.role.controller" as const
  if (role === "implementer") return "execution.agent.role.implementer" as const
  if (role === "spec_reviewer") return "execution.agent.role.spec_reviewer" as const
  if (role === "code_reviewer") return "execution.agent.role.code_reviewer" as const
  return "execution.agent.role.debugger" as const
}

function compareIDs(left: Task, right: Task) {
  if (left.id < right.id) return -1
  if (left.id > right.id) return 1
  return 0
}
