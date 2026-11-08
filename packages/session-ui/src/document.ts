import type { FileDiffInfo, SessionMessageInfo, SessionStatus } from "@Mackery6969/client/promise"

export type SessionDocument = {
  sessionID: string
  messages: SessionMessageInfo[]
  status: SessionStatus
  diffs: FileDiffInfo[]
}
