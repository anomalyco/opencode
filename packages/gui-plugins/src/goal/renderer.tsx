import { createSignal, onCleanup, Show, untrack } from "solid-js"
import { ComposerPill, createKeyed, type ComposerPillProps, type Plugin } from "@opencode/plugin/gui"
import { Goal } from "@opencode/schema/goal"
import { Button } from "@opencode/ui/button"
import { showToast } from "@opencode/ui/toast"
import type GoalDefinition from "./index"
import {
  createGoalState,
  GOAL_COMMAND_TIMEOUT_MS,
  GOAL_SNAPSHOT_TIMEOUT_MS,
  selectGoal,
  selectGoalBusy,
  transitionGoal,
  type GoalAction,
  type GoalEffect,
  type GoalEvent,
} from "./machine"

const status = {
  active: { label: "title", icon: "outline-steer", tone: undefined },
  paused: { label: "paused", icon: "circle-exclamation", tone: "warning" },
  complete: { label: "met", icon: "circle-check", tone: "success" },
} as const

/**
 * The session's `/goal` above its composer: the status as a pill, and a popover headed by the objective with the
 * actions that apply. The server's goal plugin owns the goal and serves it over its RPC; a bare `/goal` shows the last
 * reason.
 */
const setup: Plugin.Setup<typeof GoalDefinition> = (ctx) => {
  const [goalState, setGoalState] = createSignal(createGoalState())
  // Ends a subscription, snapshot fetch, retry timer or command by its id.
  const running = new Map<number, () => void>()

  const dispatch = (event: GoalEvent) => {
    const next = transitionGoal(untrack(goalState), event)

    if (next.state !== untrack(goalState)) setGoalState(next.state)
    next.effects.forEach((effect) => void Promise.try(() => run(effect)).catch(console.error))
  }

  const stop = (id: number) => {
    running.get(id)?.()
    running.delete(id)
  }

  const run = (effect: GoalEffect) => {
    if (effect.type === "unsubscribe") return stop(effect.subscription)

    if (effect.type === "cancel") return stop(effect.attempt)

    if (effect.type === "toast-error")
      return showToast({ variant: "error", title: ctx.t("common.requestFailed"), description: effect.message })

    if (effect.type === "schedule-retry") {
      const timer = setTimeout(() => {
        running.delete(effect.attempt)
        dispatch({ type: "retry.due", attempt: effect.attempt })
      }, effect.delay)

      running.set(effect.attempt, () => clearTimeout(timer))

      return
    }

    // A restarted or re-authenticated server gets a new client under the same id.
    const client = ctx.servers.get(effect.serverID)?.client

    if (effect.type === "subscribe") {
      const subscription = effect.subscription

      if (!client) return
      running.set(
        subscription,
        client.rpc(Goal.Definition).events.on("changed", (event) =>
          dispatch({
            type: "changed",
            subscription,
            key: `${effect.serverID}\n${event.data.sessionID}`,
            goal: event.data.goal,
          }),
        ),
      )

      return
    }

    if (effect.type === "fetch") {
      const attempt = effect.attempt

      return guard(
        attempt,
        GOAL_SNAPSHOT_TIMEOUT_MS,
        (signal) => {
          if (!client) throw new Error("server unavailable")

          return client
            .rpc(Goal.Definition)
            .get({ sessionID: effect.sessionID }, { location: { directory: effect.directory }, signal })
        },
        (goal) => ({ type: "snapshot.loaded", attempt, goal }),
        () => ({ type: "snapshot.failed", attempt }),
      )
    }

    const attempt = effect.attempt
    const key = effect.key

    guard(
      attempt,
      GOAL_COMMAND_TIMEOUT_MS,
      (signal) => {
        if (!client) throw new Error("server unavailable")

        return client.session.command({ sessionID: effect.sessionID, name: "goal", text: effect.action }, { signal })
      },
      () => ({ type: "command.succeeded", key, attempt }),
      (message) => ({ type: "command.failed", key, attempt, message }),
    )
  }

  // Runs one request under `attempt` and settles it once: its result, its error, or its timeout (no message).
  const guard = <A,>(
    attempt: number,
    timeout: number,
    request: (signal: AbortSignal) => Promise<A>,
    done: (value: A) => GoalEvent,
    failed: (message?: string) => GoalEvent,
  ) => {
    const controller = new AbortController()

    const timer = setTimeout(() => {
      controller.abort()
      running.delete(attempt)
      dispatch(failed())
    }, timeout)

    running.set(attempt, () => {
      controller.abort()
      clearTimeout(timer)
    })

    const settle = (event: GoalEvent) => {
      if (controller.signal.aborted) return
      clearTimeout(timer)
      running.delete(attempt)
      dispatch(event)
    }

    void Promise.try(() => request(controller.signal)).then(
      (value) => settle(done(value)),
      (cause: unknown) => settle(failed(cause instanceof Error ? cause.message : String(cause))),
    )
  }

  // Subscribes to the routed session's goal: its current value, then every change. It attaches again when another
  // session is routed, the session moves, or its server reconnects, since changes published meanwhile were missed.
  createKeyed(
    () => {
      const session = ctx.sessions.current()

      if (!session?.id || !session.server.connected) return

      return { key: session.key, serverID: session.server.id, sessionID: session.id, directory: session.directory }
    },
    (target) => dispatch({ type: "target.attached", ...target }),
    {
      otherwise: () => dispatch({ type: "target.detached" }),
      equals: (a, b) => a.key === b.key && a.directory === b.directory,
    },
  )

  // Forgets the goals of sessions whose shell tab closed.
  createKeyed(
    () => [...ctx.sessions.list().map((session) => session.key), ctx.sessions.current()?.key].join("\u0000"),
    () =>
      dispatch({
        type: "sessions.pruned",
        keep: new Set(
          [...ctx.sessions.list().map((session) => session.key), ctx.sessions.current()?.key].filter(
            (key): key is string => key !== undefined,
          ),
        ),
      }),
  )
  onCleanup(() => dispatch({ type: "disposed" }))

  const goal = (input: ComposerPillProps) => selectGoal(goalState(), input.session.key)

  const command = (input: ComposerPillProps, action: GoalAction) =>
    dispatch({
      type: "command.requested",
      key: input.session.key,
      serverID: input.session.server.id,
      sessionID: input.session.id,
      action,
    })

  ctx.add(ComposerPill, {
    id: "goal",
    show: (input) => {
      const current = goal(input)

      if (!current) return

      const view = status[current.status]

      return { label: ctx.t(view.label), icon: view.icon, tone: view.tone, title: current.objective }
    },
    menu: (input) => {
      const busy = () => selectGoalBusy(goalState(), input.session.key)

      const run = (action: GoalAction) => {
        input.close()
        command(input, action)
      }

      return (
        <div class="flex justify-end gap-1 px-1 pt-1">
          <Show when={goal(input)?.status === "active"}>
            <Button size="small" variant="ghost" icon="stop" disabled={busy()} onClick={() => run("pause")}>
              {ctx.t("pause")}
            </Button>
          </Show>
          <Show when={goal(input)?.status === "paused"}>
            <Button size="small" variant="ghost" icon="refresh" disabled={busy()} onClick={() => run("resume")}>
              {ctx.t("resume")}
            </Button>
          </Show>
          <Button size="small" variant="ghost" icon="outline-trash" disabled={busy()} onClick={() => run("clear")}>
            {ctx.t("clear")}
          </Button>
        </div>
      )
    },
  })
}

export default setup
