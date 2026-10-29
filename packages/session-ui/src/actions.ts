import type { PromptAttachment } from "@opencode/client/promise"

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
      title?: string
      subtitle?: string
      icon: string
    }
  | {
      /** Plain text quoted from the session timeline, or from the named source, with an optional comment. */
      type: "quote"
      text: string
      comment?: string
      source?: { label: string; icon: string }
    }

/** An attachment delivered to the model as a path on the server instead of inline bytes. */
export type SessionUserAttachmentReference = {
  name: string
  mime: string
  path: string
}

export type SessionUserActions = {
  openAttachment?: (file: PromptAttachment) => void
  /** Opens the model picker, which a budget notice offers when a budget pauses the model in use. */
  chooseModel?: () => void
  revert?: (input: { sessionID: string; messageID: string }) => Promise<void> | void
  /** Starts a new session with the history before this message and its prompt in the composer. */
  fork?: (input: { sessionID: string; messageID: string }) => Promise<void> | void
  /**
   * An input the server has not delivered yet. Like the TUI, a pending steer can move to the queue or be deleted;
   * it shows as waiting only while `steering` behind delivered work or `stranded` by an execution that ended.
   */
  pending?: {
    status: (messageID: string) => "starting" | "steering" | "stranded" | "queued" | undefined
    queue: (input: { sessionID: string; messageID: string }) => Promise<void>
    remove: (input: { sessionID: string; messageID: string }) => Promise<void>
  }
}
