import type { Data } from "@opencode/client/solid"
import { createEffect, on } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import type { ServerApi } from "@/runtime/server/api"
import { showToast } from "@/shell/notifications/toast"

/**
 * The goal indicator's view model. Durable state comes from the client's goal read
 * model; every action is one `session.goal.update` call, and the read model
 * re-reads once it settles so the dock never renders a guess.
 */
export function createSessionGoalModel(input: {
  sessionID: () => string | undefined
  connected: () => boolean
  data: Data
  api: ServerApi
}) {
  const language = useLanguage()

  createEffect(
    on([input.sessionID, input.connected], ([sessionID, connected]) => {
      if (!sessionID || !connected) return
      void input.data.session.goal.sync(sessionID).catch(() => undefined)
    }),
  )

  const update = (action: "pause" | "resume" | "clear" | "edit", objective?: string) => {
    const sessionID = input.sessionID()

    if (!sessionID) return
    return input.api.session.goal
      .update({ sessionID, action, objective })
      .catch((error: unknown) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: error instanceof Error ? error.message : String(error),
        })
      })
      .finally(() => {
        input.data.session.goal.invalidate(sessionID)
        void input.data.session.goal.sync(sessionID).catch(() => undefined)
      })
  }

  return {
    state: () => {
      const sessionID = input.sessionID()

      return sessionID ? input.data.session.goal.list(sessionID) : undefined
    },
    /**
     * The last turn ended because the user interrupted it, so a goal that is still active
     * will silently resume on the next message. Any later turn boundary clears this.
     */
    interrupted: () => {
      const sessionID = input.sessionID()

      if (!sessionID) return false
      const idle = input.data.session.message.list(sessionID).filter((item) => item.type === "idle").at(-1)

      return idle?.type === "idle" && idle.outcome === "interrupted"
    },
    pause: () => update("pause"),
    resume: () => update("resume"),
    edit: (objective: string) => update("edit", objective),
    clear: () => update("clear"),
  }
}

export type SessionGoalModel = ReturnType<typeof createSessionGoalModel>
