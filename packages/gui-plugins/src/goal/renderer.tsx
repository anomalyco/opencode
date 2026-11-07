import { onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { ComposerPill, createKeyed, type ComposerPillProps, type Plugin } from "@opencode/plugin/gui"
import { Goal } from "@opencode/schema/goal"
import { Button } from "@opencode/ui/button"
import { showToast } from "@opencode/ui/toast"
import type GoalDefinition from "./index"

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
  // The last goal heard for each server and session. A session switched back to shows it until the refetch lands.
  const [goals, setGoals] = createStore<Record<string, { goal: Goal.State | null }>>({})
  const key = (server: string, sessionID: string) => `${server}\u0000${sessionID}`
  const goal = (input: ComposerPillProps) => goals[key(input.session.server.id, input.session.id)]?.goal

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
          (next) => {
            if (!controller.signal.aborted && !heard.value) setGoals(key(server, session.id), { goal: next })
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
      const current = goal(input)

      if (!current) return

      const view = status[current.status]

      return { label: ctx.t(view.label), icon: view.icon, tone: view.tone, title: current.objective }
    },
    menu: (input) => {
      const run = (text: "pause" | "resume" | "clear") => {
        input.close()
        command(input, text)
      }

      return (
        <div class="flex justify-end gap-1 px-1 pt-1">
          <Show when={goal(input)?.status === "active"}>
            <Button size="small" variant="ghost" icon="stop" onClick={() => run("pause")}>
              {ctx.t("pause")}
            </Button>
          </Show>
          <Show when={goal(input)?.status === "paused"}>
            <Button size="small" variant="ghost" icon="refresh" onClick={() => run("resume")}>
              {ctx.t("resume")}
            </Button>
          </Show>
          <Button size="small" variant="ghost" icon="outline-trash" onClick={() => run("clear")}>
            {ctx.t("clear")}
          </Button>
        </div>
      )
    },
  })
}

export default setup
