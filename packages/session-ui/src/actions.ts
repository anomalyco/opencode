import type { PromptFileAttachment } from "@opencode/client/promise"

export type SessionUserComment =
  | {
      type?: "file"
      path: string
      comment: string
      selection?: {
        startLine: number
        endLine: number
      }
    }
  | {
      /** A comment on something other than file lines, such as an element picked in a page. */
      type: "note"
      comment: string
      label: string
      icon: string
    }

/** An attachment delivered to the model as a path on the server instead of inline bytes. */
export type SessionUserAttachmentReference = {
  name: string
  mime: string
  path: string
}

export type SessionUserActions = {
  openAttachment?: (file: PromptFileAttachment) => void
  revert?: (input: { sessionID: string; messageID: string }) => Promise<void> | void
  /**
   * An input the server has not delivered yet. Like the TUI, a pending steer can move to the queue or be deleted;
   * it shows as waiting only while `steering` behind delivered work or `stranded` by an execution that ended.
   */
  pending?: {
    status: (messageID: string) => "starting" | "steering" | "stranded" | "queued" | undefined
    queue: (input: { sessionID: string; messageID: string }) => Promise<void>
    remove: (input: { sessionID: string; messageID: string }) => Promise<void>
  }
  /** Pins a message so it stays reachable without scrolling. Pins are kept per session. */
  pin?: (input: { sessionID: string; messageID: string }) => void
  /** Removes a pinned message. */
  unpin?: (input: { sessionID: string; messageID: string }) => void
  /** Whether a message is pinned. Reading this inside a reactive scope tracks changes. */
  isPinned?: (input: { sessionID: string; messageID: string }) => boolean
  /** Pinned message IDs for a session, newest first. Reading this inside a reactive scope tracks changes. */
  pinnedMessages?: (sessionID: string) => readonly string[]
}
