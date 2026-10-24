export * as AttachmentReference from "./attachment-reference.js"

import type { FileAttachment } from "./prompt.js"

const prefix = "opencode-attachment:"

/** A list-only reference. Single-message reads always return the original attachment. */
export function is(file: FileAttachment) {
  return file.source.type === "uri" && file.source.uri.startsWith(prefix)
}

export function make(sessionID: string, messageID: string, index: number) {
  return `${prefix}${sessionID}/${messageID}/${index}`
}

export function parse(file: FileAttachment) {
  if (file.source.type !== "uri" || !file.source.uri.startsWith(prefix)) return
  const match = /^opencode-attachment:(ses[^/]+)\/(msg_[^/]+)\/(\d+)$/.exec(file.source.uri)

  if (!match) throw new Error("Invalid attachment reference")

  return { sessionID: match[1]!, messageID: match[2]!, index: Number(match[3]) }
}
