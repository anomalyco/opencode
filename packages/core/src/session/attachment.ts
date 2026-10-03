export * as SessionAttachment from "./attachment.js"

import type { Model } from "@opencode/schema/model"
import type { SessionError } from "@opencode/schema/session-error"
import { SessionMessage } from "./message.js"
import { isMediaFile } from "./runner/to-llm-message.js"

/** The Session error type for a provider rejecting an attachment, such as a corrupt PDF. */
export const REJECTED = "provider.media-rejected"

/** An attachment that may be excluded, with what a person needs to recognize it. */
export interface Candidate extends SessionMessage.AttachmentRef {
  readonly mime: string
  readonly name?: string
}

/**
 * The attachments that may have caused a rejection by `model`: those the model has not yet accepted. A request the
 * provider accepted, shown by an assistant message with output or usage, contained every attachment before that
 * message, so only attachments in it (its tool results) or after it remain suspects. Without such a message every
 * attachment in `messages` is a suspect. Already-excluded attachments are left out.
 */
export const candidates = (messages: ReadonlyArray<SessionMessage.Info>, model: Model.Ref | undefined) => {
  const accepted = messages.findLastIndex(
    (message) =>
      message.type === "assistant" &&
      model !== undefined &&
      message.model.providerID === model.providerID &&
      message.model.id === model.id &&
      (message.content.length > 0 || message.tokens !== undefined),
  )
  return messages
    .slice(Math.max(0, accepted))
    .flatMap(attachments)
    .filter((entry) => !entry.excluded)
    .map((entry) => entry.candidate)
}

/** Refs in `refs` that do not name a media attachment in `messages`. */
export const unknown = (
  messages: ReadonlyArray<SessionMessage.Info>,
  refs: ReadonlyArray<SessionMessage.AttachmentRef>,
) => {
  const known = new Set(messages.flatMap(attachments).map((entry) => key(entry.candidate)))
  return refs.filter((ref) => !known.has(key(ref)))
}

/** Names the suspects in a rejection error so the user can see what may be excluded. */
export const describe = (error: SessionError.Error, suspects: ReadonlyArray<Candidate>): SessionError.Error => {
  if (error.type !== REJECTED || suspects.length === 0) return error
  return {
    ...error,
    message: `${error.message}\nAttachments the model has not accepted yet: ${suspects.map(label).join(", ")}`,
  }
}

export const label = (candidate: Pick<Candidate, "mime" | "name">) =>
  candidate.name === undefined ? candidate.mime : `${candidate.name} (${candidate.mime})`

const key = (ref: SessionMessage.AttachmentRef) => `${ref.messageID}/${ref.callID ?? ""}/${ref.index}`

const attachments = (
  message: SessionMessage.Info,
): ReadonlyArray<{ readonly excluded: boolean; readonly candidate: Candidate }> => {
  if (message.type === "user")
    return (message.files ?? []).flatMap((file, index) =>
      isMediaFile(file.mime)
        ? [
            {
              excluded: message.excludedFiles?.includes(index) === true,
              candidate: {
                messageID: message.id,
                index,
                mime: file.mime,
                name: file.name ?? (file.source.type === "uri" ? file.source.uri : undefined),
              },
            },
          ]
        : [],
    )
  if (message.type !== "assistant") return []
  return message.content.flatMap((part) => {
    if (part.type !== "tool" || (part.state.status !== "completed" && part.state.status !== "error")) return []
    return (part.state.content ?? []).flatMap((item, index) =>
      item.type === "file"
        ? [
            {
              excluded: part.excludedContent?.includes(index) === true,
              candidate: {
                messageID: message.id,
                callID: part.id,
                index,
                mime: item.mime,
                name: item.name,
              },
            },
          ]
        : [],
    )
  })
}
