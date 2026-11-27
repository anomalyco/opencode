import { createSignal, Match, onCleanup, Show, Switch, untrack } from "solid-js"
import { ComposerPill, createKeyed, Style, type ComposerPillProps, type Plugin } from "@opencode/plugin/gui"
import { Goal } from "@opencode/schema/goal"
import { Button } from "@opencode/ui/button"
import { showToast } from "@opencode/ui/toast"
import styles from "./goal.css?inline"
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

/**
 * The session's `/goal` above its composer: the status as a pill with its own glyph, and a popover with the
 * objective, the last reason and the actions that apply. The server's goal plugin owns the goal and serves it over
 * its RPC; a bare `/goal` shows the last reason.
 */
const setup: Plugin.Setup<typeof GoalDefinition> = (ctx) => {
  // The pill and the popover's status line of each goal status. The pill shows the plugin's own glyphs: the host
  // colors a paused and a reached goal by `tone`, and the active glyph carries the accent color itself.
  const status = {
    active: { label: "active", status: "statusActive", icon: ctx.icons.active, tone: undefined },
    paused: { label: "paused", status: "statusPaused", icon: ctx.icons.paused, tone: "warning" },
    complete: { label: "reached", status: "statusFinished", icon: ctx.icons.complete, tone: "success" },
  } as const

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
      async (signal) => {
        if (!client) throw new Error("server unavailable")
        const sessionID = effect.sessionID
        const selection = effect.selection

        // As sending a prompt does, the agent first: switching it can move the model. The server ignores a switch to
        // what the session already has.
        if (selection?.agent) await client.session.switchAgent({ sessionID, agent: selection.agent }, { signal })

        if (selection?.model)
          await client.session.switchModel(
            {
              sessionID,
              model: {
                id: selection.model.modelID,
                providerID: selection.model.providerID,
                variant: selection.model.variant,
              },
            },
            { signal },
          )

        return client.session.command({ sessionID, name: "goal", text: effect.action }, { signal })
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
      // The goal's continuations run with the session's agent and model, which a pick in the composer changes only
      // once a prompt is sent. Resuming is the user's next send, so it takes the pick along.
      ...(action === "resume" && {
        selection: { agent: input.screen.composer.agent(), model: input.screen.composer.model() },
      }),
    })

  ctx.add(Style, styles)

  ctx.add(ComposerPill, {
    id: "goal",
    show: (input) => {
      const current = goal(input)

      if (!current) return

      const view = status[current.status]

      return { label: ctx.t(view.label), icon: view.icon, tone: view.tone }
    },
    menu: (input) => {
      const busy = () => selectGoalBusy(goalState(), input.session.key)

      const run = (action: GoalAction) => {
        input.close()
        command(input, action)
      }

      return (
        <Show when={goal(input)}>
          {(current) => (
            <div data-component="goal-panel">
              <p dir="auto" data-slot="goal-objective" data-scrollable>
                {current().objective}
              </p>
              {/* Until the goal has a reason, the status is the pill's alone. */}
              <Show when={current().reason}>
                {(reason) => (
                  <>
                    <div data-slot="goal-divider" aria-hidden="true" />
                    <div class="flex flex-col">
                      <span data-slot="goal-status" data-status={current().status}>
                        {ctx.t(status[current().status].status)}
                      </span>
                      <p dir="auto" data-slot="goal-reason">
                        {reason()}
                      </p>
                    </div>
                  </>
                )}
              </Show>
              <div class="flex flex-wrap gap-2 pt-1">
                <Switch>
                  <Match when={current().status === "active"}>
                    <Button data-action="goal-pause" size="small" disabled={busy()} onClick={() => run("pause")}>
                      {ctx.t("pause")}
                    </Button>
                  </Match>
                  <Match when={current().status === "paused"}>
                    <Button data-action="goal-resume" size="small" disabled={busy()} onClick={() => run("resume")}>
                      {ctx.t("resume")}
                    </Button>
                  </Match>
                </Switch>
                <Show
                  when={current().status === "complete"}
                  fallback={
                    <Button
                      data-action="goal-clear"
                      size="small"
                      variant="danger"
                      disabled={busy()}
                      onClick={() => run("clear")}
                    >
                      {ctx.t("clear")}
                    </Button>
                  }
                >
                  {/* A reached goal has nothing left to stop, so clearing it only dismisses the pill. */}
                  <Button data-action="goal-dismiss" size="small" disabled={busy()} onClick={() => run("clear")}>
                    {ctx.t("dismiss")}
                  </Button>
                </Show>
              </div>
            </div>
          )}
        </Show>
      )
    },
  })
}

export default setup
