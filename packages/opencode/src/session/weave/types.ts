import type { ModelMessage } from "ai"
import type { MessageV2 } from "@/session/message-v2"

export type ExecutionRole = "orchestrator" | "thread" | "operator"

export type ThreadDispatch = {
  threadID: string
  parentSessionID: string
  action: string
  delegatedScope?: string
  role?: ExecutionRole
  toolProfile?: string
  modelOverride?: string
}

export type Episode = {
  id: string
  sessionID: string
  threadID?: string
  summary: string
  status: "completed" | "failed" | "cancelled"
  sourceMessageIDs: string[]
  createdAt: number
}

export type SummaryNode = {
  id: string
  sessionID: string
  parentID?: string
  depth: number
  text: string
  sourceMessageIDs: string[]
  createdAt: number
}

export type ContextSnapshot = {
  sessionID: string
  role: ExecutionRole
  summaryNodeIDs: string[]
  recentMessageIDs: string[]
  fileRefs: string[]
  createdAt: number
}

export type MessageLink = {
  opencodeMessageID: string
  weaveMessageID: string
  linkedAt: number
}

export type BuildContextInput = {
  sessionID: string
  role: ExecutionRole
  messages: MessageV2.WithParts[]
  modelMessages: ModelMessage[]
}

export type BuildContextOutput = {
  modelMessages: ModelMessage[]
  snapshot: ContextSnapshot
}
