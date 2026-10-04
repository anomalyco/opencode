import type { SessionMessage } from "@opencode/schema/session-message"
import type { Session } from "@opencode/schema/session"
import { createContext, useContext } from "solid-js"
import type { ModelInfo } from "@opencode/client"
import type { SessionInbox } from "@opencode/schema/session-inbox"
import type { useConfig } from "../../config"
import type { ThinkingMode } from "../../context/thinking"
import type { createTimelineAnchors } from "./anchors"
import type { GroupKind } from "./grouping/session"

export type PendingAction = "steer" | "queue" | "cancel"

export const context = createContext<{
  /** Content width: terminal width minus vertical tabs, sidebar, and padding. */
  width: number
  /**
   * Shared reactive terminal size. Transcript-row components must read this
   * instead of calling useTerminalDimensions(), which registers one renderer
   * resize listener per mounted component and grows with transcript length.
   */
  terminal: { width: number; height: number }
  sessionID: Session.ID
  anchors: ReturnType<typeof createTimelineAnchors>
  /** Saved disclosure, falling back to the verbosity default for the group kind. */
  groupExpanded: (groupID: string, kind: GroupKind) => boolean
  setGroupExpanded: (groupID: string, expanded: boolean) => void
  thinkingMode: () => ThinkingMode
  markdownMode: () => "source" | "rendered"
  groupExploration: () => boolean
  diffWrapMode: () => "word" | "none"
  models: () => ModelInfo[]
  messageIndex: (messageID: SessionMessage.ID) => number | undefined
  /** True when the session has no idle markers, so turn footers end at the next prompt. */
  legacyTurns: () => boolean
  config: ReturnType<typeof useConfig>["data"]
  mutatePending: (action: PendingAction, inboxID: SessionMessage.ID) => Promise<boolean>
  pendingDelivery: (inboxID: SessionMessage.ID) => SessionInbox.Delivery | undefined
}>()

export function use() {
  const ctx = useContext(context)
  if (!ctx) throw new Error("useContext must be used within a Session component")
  return ctx
}
