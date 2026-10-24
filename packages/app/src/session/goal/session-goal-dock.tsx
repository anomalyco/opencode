import { Button } from "@opencode/ui/button"
import { DockShell } from "@opencode/ui/dock-surface"
import { Icon } from "@opencode/ui/icon"
import type { SessionGoalState } from "@opencode/client/promise"
import { createEffect, createMemo, on, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import type { SessionGoalModel } from "./model"
import "./session-goal-dock.css"

type GoalSnapshot = NonNullable<SessionGoalState["goal"]>
type GoalPhase = GoalSnapshot["phase"]
type GoalTodo = SessionGoalState["todo"][number]

const PHASE_ICON: Record<GoalPhase, string> = {
  active: "checklist",
  paused: "pause",
  blocked: "warning",
  complete: "check",
}

const TODO_ICON: Record<GoalTodo["status"], string> = {
  pending: "circle",
  in_progress: "circle-dot",
  completed: "circle-check",
  cancelled: "circle-x",
}

const TODO_LABEL = {
  pending: "session.goal.todo.pending",
  in_progress: "session.goal.todo.inProgress",
  completed: "session.goal.todo.completed",
  cancelled: "session.goal.todo.cancelled",
} as const

const TODO_LIMIT = 5

export function SessionGoalDock(props: { model: SessionGoalModel }) {
  const language = useLanguage()
  const goal = () => props.model.state()?.goal
  const createdAt = () => {
    const value = props.model.state()?.createdAt

    return typeof value === "number" ? value : undefined
  }
  const [store, setStore] = createStore<{ editing: string | undefined; hintDismissed: boolean }>({
    editing: undefined,
    hintDismissed: false,
  })
  let input: HTMLInputElement | undefined

  // An interruption by hand only stops the current turn: an active goal the process is not
  // armed for resumes on the next message, and the user has no way to see that. The hint
  // dismisses by hand, and comes back only after it stops applying.
  const hint = () => goal()?.phase === "active" && props.model.state()?.armed === false && props.model.interrupted()

  createEffect(on(hint, (visible) => (visible ? undefined : setStore("hintDismissed", false))))

  // A goal that disappears abandons an inline edit.
  createEffect(on(goal, () => setStore("editing", undefined)))
  // The editor mounts on the click that opened it, so focus follows the state, not the ref.
  createEffect(() => {
    if (store.editing === undefined) return
    input?.focus()
  })

  return (
    <Show when={goal()} keyed>
      {(goal) => (
        <DockShell
          data-component="session-goal-dock"
          data-phase={goal.phase}
          aria-label={language.t("session.goal.title")}
        >
          <span data-slot="session-goal-marker" aria-hidden="true">
            <Icon name={PHASE_ICON[goal.phase]} size="small" />
          </span>
          <Show
            when={store.editing !== undefined}
            fallback={
              <SessionGoalProgress
                objective={goal.objective}
                phase={goal.phase}
                createdAt={createdAt()}
                blockedReason={goal.blockedReason?.message}
                stopped={goal.phase === "active" && props.model.state()?.armed === false}
                hint={hint() && !store.hintDismissed}
                onDismissHint={() => setStore("hintDismissed", true)}
                todo={props.model.state()?.todo ?? []}
              />
            }
          >
            <form
              data-slot="session-goal-editor"
              onSubmit={(event) => {
                event.preventDefault()
                const objective = (store.editing ?? "").trim()
                setStore("editing", undefined)
                if (objective && objective !== goal.objective) props.model.edit(objective)
              }}
            >
              <input
                data-slot="session-goal-input"
                aria-label={language.t("session.goal.edit")}
                placeholder={language.t("session.goal.editPlaceholder")}
                value={store.editing ?? ""}
                ref={input}
                onInput={(event) => setStore("editing", event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setStore("editing", undefined)
                }}
              />
            </form>
          </Show>
          <SessionGoalActions
            model={props.model}
            phase={goal.phase}
            onEdit={() => setStore("editing", goal.objective)}
          />
        </DockShell>
      )}
    </Show>
  )
}

function SessionGoalProgress(props: {
  objective: string
  phase: GoalPhase
  createdAt?: number
  blockedReason?: string
  stopped: boolean
  hint: boolean
  onDismissHint: () => void
  todo: SessionGoalState["todo"]
}) {
  const language = useLanguage()
  const [clock, setClock] = createStore({ elapsed: 0 })
  let timer: ReturnType<typeof setInterval> | undefined

  const stop = () => {
    if (timer === undefined) return
    clearInterval(timer)
    timer = undefined
  }

  // Elapsed time is only known while the goal is active. The durable goal has no
  // phase-change time, so a stopped goal would have to guess where its run ended; it
  // shows the phase instead rather than a number that drifts between reloads.
  const tick = () => {
    const total = props.createdAt === undefined ? 0 : Math.round((Date.now() - props.createdAt) / 1000)
    setClock("elapsed", Math.max(0, total))
  }

  createEffect(
    on(
      () => [props.phase, props.createdAt] as const,
      ([phase]) => {
        stop()
        tick()
        if (phase === "active") timer = setInterval(tick, 1000)
      },
    ),
  )
  onCleanup(stop)

  const elapsed = createMemo(() => {
    if (props.phase !== "active" || props.createdAt === undefined) return ""
    const format = new Intl.NumberFormat(language.intl())
    const total = clock.elapsed

    if (total < 60) return language.t("ui.message.duration.seconds", { count: format.format(total) })
    if (total < 3600)
      return language.t("ui.message.duration.minutesSeconds", {
        minutes: format.format(Math.floor(total / 60)),
        seconds: format.format(total % 60),
      })

    return language.t("ui.message.duration.hoursMinutes", {
      hours: format.format(Math.floor(total / 3600)),
      minutes: format.format(Math.floor((total % 3600) / 60)),
    })
  })

  const status = createMemo(() => {
    if (props.phase === "paused") return language.t("session.goal.paused")
    if (props.phase === "complete") return language.t("session.goal.complete")
    if (props.stopped) return language.t("session.goal.stopped")
  })

  return (
    <div data-slot="session-goal-progress">
      <div data-slot="session-goal-summary">
        <span data-slot="session-goal-objective" title={props.objective}>
          {props.objective}
        </span>
        <Show
          when={props.blockedReason}
          fallback={
            <span data-slot="session-goal-meta">
              <Show when={elapsed()}>{(value) => <span data-slot="session-goal-elapsed">{value()}</span>}</Show>
              <Show when={status()}>{(value) => <span data-slot="session-goal-status">{value()}</span>}</Show>
            </span>
          }
        >
          {(reason) => <span data-slot="session-goal-blocked">{reason()}</span>}
        </Show>
      </div>
      <Show when={props.hint}>
        <p data-slot="session-goal-hint">
          <span data-slot="session-goal-hint-text">{language.t("session.goal.stillActive")}</span>
          <Button
            variant="ghost"
            size="small"
            icon="close-small"
            aria-label={language.t("session.goal.hintDismiss")}
            onClick={props.onDismissHint}
          />
        </p>
      </Show>
      <Show when={props.todo.length > 0}>
        <ul data-slot="session-goal-todos" aria-label={language.t("session.goal.todos")}>
          {props.todo.slice(0, TODO_LIMIT).map((item) => (
            <li
              data-slot="session-goal-todo"
              data-status={item.status}
              aria-label={language.t(TODO_LABEL[item.status], { content: item.content })}
            >
              <Icon name={TODO_ICON[item.status]} size="small" />
              <span data-slot="session-goal-todo-content">{item.content}</span>
            </li>
          ))}
          <Show when={props.todo.length > TODO_LIMIT}>
            <li data-slot="session-goal-todo-more">
              {language.plural("session.goal.todo.more", props.todo.length - TODO_LIMIT)}
            </li>
          </Show>
        </ul>
      </Show>
    </div>
  )
}

function SessionGoalActions(props: { model: SessionGoalModel; phase: GoalPhase; onEdit: () => void }) {
  const language = useLanguage()

  return (
    <div data-slot="session-goal-actions">
      <Show when={props.phase === "active"}>
        <Button
          variant="ghost"
          size="small"
          icon="pause"
          aria-label={language.t("session.goal.pause")}
          onClick={() => props.model.pause()}
        />
      </Show>
      <Show when={props.phase === "paused" || props.phase === "blocked"}>
        <Button
          variant="ghost"
          size="small"
          icon="play"
          aria-label={language.t("session.goal.resume")}
          onClick={() => props.model.resume()}
        />
      </Show>
      <Show when={props.phase === "paused"}>
        <Button
          variant="ghost"
          size="small"
          icon="pencil-line"
          aria-label={language.t("session.goal.edit")}
          onClick={props.onEdit}
        />
      </Show>
      <Show when={props.phase !== "active"}>
        <Button
          variant="ghost"
          size="small"
          icon="trash"
          aria-label={language.t("session.goal.clear")}
          onClick={() => props.model.clear()}
        />
      </Show>
    </div>
  )
}
