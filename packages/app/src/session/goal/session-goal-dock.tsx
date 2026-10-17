import { Button } from "@opencode/ui/button"
import { DockShell } from "@opencode/ui/dock-surface"
import { Icon } from "@opencode/ui/icon"
import type { SessionGoalState } from "@opencode/client/promise"
import { createEffect, createMemo, on, onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import type { SessionGoalModel } from "./model"
import "./session-goal-dock.css"

type GoalSnapshot = NonNullable<SessionGoalState["goal"]>
type GoalPhase = GoalSnapshot["phase"]

const PHASE_ICON: Record<GoalPhase, string> = {
  active: "checklist",
  paused: "pause",
  blocked: "warning",
  complete: "check",
}

export function SessionGoalDock(props: { model: SessionGoalModel }) {
  const language = useLanguage()
  const goal = () => props.model.state()?.goal
  const createdAt = () => {
    const value = props.model.state()?.createdAt

    return typeof value === "number" ? value : undefined
  }
  const [store, setStore] = createStore<{ editing: string | undefined }>({ editing: undefined })
  let input: HTMLInputElement | undefined

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
}) {
  const language = useLanguage()
  const [clock, setClock] = createStore({ elapsedTick: Date.now() })

  // The timer lives with the rendered goal, so no goal means no interval.
  onMount(() => {
    const timer = setInterval(() => setClock("elapsedTick", Date.now()), 1000)
    onCleanup(() => clearInterval(timer))
  })

  const elapsed = createMemo(() => {
    if (props.createdAt === undefined) return ""
    const format = new Intl.NumberFormat(language.intl())
    const total = Math.max(0, Math.round((clock.elapsedTick - props.createdAt) / 1000))

    if (total < 60) return language.t("ui.message.duration.seconds", { count: format.format(total) })

    return language.t("ui.message.duration.minutesSeconds", {
      minutes: format.format(Math.floor(total / 60)),
      seconds: format.format(total % 60),
    })
  })

  const status = createMemo(() => {
    if (props.phase === "paused") return language.t("session.goal.paused")
    if (props.phase === "complete") return language.t("session.goal.complete")
    if (props.stopped) return language.t("session.goal.stopped")
  })

  return (
    <div data-slot="session-goal-progress">
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
