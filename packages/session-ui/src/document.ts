import type { SessionID } from "@opencode/schema/session-id"
import type { FileDiffInfo, SessionMessageInfo, SessionStatus } from "@opencode/client/promise"

export type SessionDocument = {
  sessionID: SessionID
  messages: SessionMessageInfo[]
  status: SessionStatus
  diffs: FileDiffInfo[]
}
