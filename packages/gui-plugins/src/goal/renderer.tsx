import { Match, onCleanup, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { ComposerPill, createKeyed, Style, type ComposerPillProps, type Plugin } from "@opencode/plugin/gui"
import { Goal } from "@opencode/schema/goal"
import { Button } from "@opencode/ui/button"
import { showToast } from "@opencode/ui/toast"
import styles from "./goal.css?inline"
import type GoalDefinition from "./index"

const status = {
  active: { label: "active", status: "statusActive" },
  paused: { label: "paused", status: "statusPaused" },
  complete: { label: "reached", status: "statusFinished" },
} as const

/**
 * The session's `/goal` above its composer: the status as a pill with its own glyph, and a popover with the
 * objective, the last reason and the actions that apply. The server's goal plugin owns the goal and serves it over
 * its RPC; a bare `/goal` shows the last reason.
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

  ctx.add(Style, styles)

  ctx.add(ComposerPill, {
    id: "goal",
    show: (input) => {
      const current = goal(input)

      if (!current) return

      return { label: ctx.t(status[current.status].label) }
    },
    icon: (input) => <GoalGlyph status={goal(input)?.status ?? "active"} />,
    menu: (input) => {
      const run = (text: "pause" | "resume" | "clear") => {
        input.close()
        command(input, text)
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
                    <Button data-action="goal-pause" size="small" onClick={() => run("pause")}>
                      {ctx.t("pause")}
                    </Button>
                  </Match>
                  <Match when={current().status === "paused"}>
                    <Button data-action="goal-resume" size="small" onClick={() => run("resume")}>
                      {ctx.t("resume")}
                    </Button>
                  </Match>
                </Switch>
                <Show
                  when={current().status === "complete"}
                  fallback={
                    <Button data-action="goal-clear" size="small" variant="danger" onClick={() => run("clear")}>
                      {ctx.t("clear")}
                    </Button>
                  }
                >
                  {/* A reached goal has nothing left to stop, so clearing it only dismisses the pill. */}
                  <Button data-action="goal-dismiss" size="small" onClick={() => run("clear")}>
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

function GoalGlyph(props: { status: Goal.Status }) {
  return (
    <svg
      data-slot="goal-glyph"
      data-status={props.status}
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" />
      <Switch>
        <Match when={props.status === "active"}>
          {/* The core sends out a ripple that fades as it spreads, then grows back. */}
          <circle data-slot="goal-ripple" cx="8" cy="8" r="2" fill="currentColor" />
          <circle data-slot="goal-core" cx="8" cy="8" r="2" fill="currentColor" />
        </Match>
        <Match when={props.status === "paused"}>
          <circle cx="8" cy="8" r="4" fill="currentColor" opacity="0.5" />
        </Match>
        <Match when={props.status === "complete"}>
          <path d="M5 8 7.5 11 11 5.5" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" />
        </Match>
      </Switch>
    </svg>
  )
}

export default setup
