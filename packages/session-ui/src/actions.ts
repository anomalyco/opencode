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
}
