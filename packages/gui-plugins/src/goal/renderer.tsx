import { ComposerPill, type ComposerPillProps, type Plugin } from "@opencode/plugin/gui"
import { SessionGoal } from "@opencode/schema/session-goal"
import { Button } from "@opencode/ui/button"
import { showToast } from "@opencode/ui/toast"
import { Show } from "solid-js"
import type Goal from "./index"

const status = {
  active: { label: "title", icon: "outline-steer", tone: undefined },
  paused: { label: "paused", icon: "circle-exclamation", tone: "warning" },
  complete: { label: "met", icon: "circle-check", tone: "success" },
} as const

/**
 * The session's `/goal` above its composer: the status as a pill, and a popover headed by the objective with the
 * actions that apply. The server's goal plugin keeps the goal in the session's metadata; a bare `/goal` shows the last
 * reason.
 */
const setup: Plugin.Setup<typeof Goal> = (ctx) => {
  // A goal copied from the parent belongs to the parent, so only the session's own goal shows.
  const goal = (input: ComposerPillProps) => {
    const session = input.session.server.data.session.get(input.session.id)

    return session && SessionGoal.fromMetadata(session.id, session.metadata)
  }

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
