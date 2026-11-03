import type { SessionInfo } from "@opencode/client/promise"
import { sessionLabel } from "@/session/title"

/**
 * What a call is on: a session, or a new-session draft. A call on a draft creates the draft's session as it starts, as
 * on iOS, and moves onto it when it lands; `session` resolves to it, or undefined when it couldn't be created.
 */
export type VoiceView =
  | { type: "session"; session: SessionInfo }
  | { type: "draft"; draftID: string; directory: string; session: () => Promise<SessionInfo | undefined> }

/** The call's title: the session's label, or a new session's while on a draft. */
export function viewTitle(view: VoiceView) {
  return sessionLabel(view.type === "session" ? view.session : { title: undefined, parentID: undefined })
}

/** The directory a call's view works in. */
export function viewDirectory(view: VoiceView) {
  return view.type === "session" ? view.session.location.directory : view.directory
}
