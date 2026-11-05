import type { Accessor } from "solid-js"
import type { SessionUserActions } from "@opencode/session-ui/actions"

type PendingActions = NonNullable<SessionUserActions["pending"]>

/** The timeline's own session, which a kept timeline holds while another session is routed. */
export type TimelineActionsView = {
  sessionID: Accessor<string | undefined>
  isChild: Accessor<boolean>
}

/** Pending input actions, for any session. */
export type TimelinePendingActions = Omit<PendingActions, "status"> & {
  status: (sessionID: string, messageID: string) => ReturnType<PendingActions["status"]>
}

/** A timeline's message actions. A child session's timeline only opens attachments. */
export function createTimelineActions(
  view: TimelineActionsView,
  actions: Required<Pick<SessionUserActions, "revert" | "fork" | "chooseModel" | "openAttachment">> & {
    pending: TimelinePendingActions
  },
): SessionUserActions {
  const pending: PendingActions = {
    status: (messageID) => {
      const id = view.sessionID()

      return id ? actions.pending.status(id, messageID) : undefined
    },
    queue: actions.pending.queue,
    remove: actions.pending.remove,
  }

  return {
    get revert() {
      return view.isChild() ? undefined : actions.revert
    },
    get fork() {
      return view.isChild() ? undefined : actions.fork
    },
    get pending() {
      return view.isChild() ? undefined : pending
    },
    get chooseModel() {
      return view.isChild() ? undefined : actions.chooseModel
    },
    openAttachment: actions.openAttachment,
  }
}
