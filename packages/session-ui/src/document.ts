import type { FileDiffInfo, SessionMessageInfo, SessionStatus } from "@opencode-ai/client/promise"

export type SessionDocument = {
  sessionID: string
  messages: SessionMessageInfo[]
  status: SessionStatus
  diffs: FileDiffInfo[]
}
