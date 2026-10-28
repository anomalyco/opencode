import { onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import {
  ComposerPill,
  createKeyed,
  type ComposerPillAction,
  type ComposerPillProps,
  type Plugin,
} from "@opencode/plugin/gui"
import { Goal } from "@opencode/plugin-goal/rpc"
import { showToast } from "@opencode/ui/toast"
import type GoalDefinition from "./index"

const status = {
  active: { label: "title", icon: "outline-steer", tone: undefined },
  paused: { label: "paused", icon: "circle-exclamation", tone: "warning" },
  complete: { label: "met", icon: "circle-check", tone: "success" },
} as const

/**
 * The session's `/goal` above its composer: the status as a pill, and a menu headed by the objective with the actions
 * that apply. The server's goal plugin owns the goal and serves it over its RPC; a bare `/goal` shows the last reason.
 */
const setup: Plugin.Setup<typeof GoalDefinition> = (ctx) => {
  // The last goal heard for each server and session. A session switched back to shows it until the refetch lands.
  const [goals, setGoals] = createStore<Record<string, { goal: Goal.State | null }>>({})
  const key = (server: string, sessionID: string) => `${server}\u0000${sessionID}`

  // Subscribes to the routed session's goal: its current value, then every change. It runs again when another session
  // is routed, the session moves, or its server reconnects, since changes published meanwhile were missed.
  createKeyed(
    () => {
      const session = ctx.sessions.current()

      return session?.server.connected ? key(session.server.id, session.id) + `\u0000${session.directory}` : undefined
    },
    () => {
      const session = ctx.sessions.current()

      if (!session) return

      const server = session.server.id
      const rpc = session.server.client.rpc(Goal.Definition)
      const controller = new AbortController()
      // A change that arrives before the snapshot is newer than it.
      const heard = { value: false }
      onCleanup(() => controller.abort())
      onCleanup(
        rpc.events.on(
          "changed",
          (event) => {
            if (event.data.sessionID === session.id) heard.value = true
            setGoals(key(server, event.data.sessionID), { goal: event.data.goal })
          },
          { signal: controller.signal },
        ),
      )
      // A server without the goal plugin answers with an error, and the session shows no goal.
      void rpc
        .get({ sessionID: session.id }, { location: { directory: session.directory }, signal: controller.signal })
        .then(
          (goal) => {
            if (!controller.signal.aborted && !heard.value) setGoals(key(server, session.id), { goal })
          },
          () => undefined,
        )
    },
  )

  const command = (input: ComposerPillProps, text: "pause" | "resume" | "clear") =>
    void input.session.server.client.session
      .command({ sessionID: input.session.id, name: "goal", text })
      .catch((cause: unknown) =>
        showToast({
          variant: "error",
          title: ctx.t("common.requestFailed"),
          description: cause instanceof Error ? cause.message : String(cause),
        }),
      )

  ctx.add(ComposerPill, {
    id: "goal",
    show: (input) => {
      const goal = goals[key(input.session.server.id, input.session.id)]?.goal

      if (!goal) return

      const view = status[goal.status]
      const actions: ComposerPillAction[] = []

      if (goal.status === "active")
        actions.push({ id: "pause", label: ctx.t("pause"), icon: "stop", run: () => command(input, "pause") })

      if (goal.status === "paused")
        actions.push({ id: "resume", label: ctx.t("resume"), icon: "refresh", run: () => command(input, "resume") })

      actions.push({ id: "clear", label: ctx.t("clear"), icon: "outline-trash", run: () => command(input, "clear") })

      return { label: ctx.t(view.label), icon: view.icon, tone: view.tone, title: goal.objective, actions }
    },
  })
}

export default setup
