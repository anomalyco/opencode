import { type Model } from "@opencode-ai/llm"
import { Effect } from "effect"
import { AttachmentStore } from "../../attachment-store"
import { ModelV2 } from "../../model"
import { SessionMessage } from "../message"
import { SessionSchema } from "../schema"
import type { MaterializedAttachment, NativeAttachment } from "./to-llm-message"

interface Candidate {
  readonly file: NonNullable<SessionMessage.User["files"]>[number]
  readonly current: boolean
}

export interface Materialization {
  readonly attachments: ReadonlyMap<string, MaterializedAttachment>
  readonly native: ReadonlyArray<AttachmentStore.Resolved>
}

const readMedia = (attachment: AttachmentStore.Resolved) =>
  Effect.tryPromise({
    try: async () => {
      const data = new Uint8Array(attachment.size)
      const progress = { offset: 0 }
      for await (const chunk of Bun.file(attachment.path).stream()) {
        if (progress.offset + chunk.byteLength > data.byteLength) throw new Error("Attachment size changed")
        data.set(chunk, progress.offset)
        progress.offset += chunk.byteLength
      }
      if (progress.offset !== data.byteLength) throw new Error("Attachment size changed")
      return data
    },
    catch: () => undefined,
  }).pipe(Effect.catch(() => Effect.succeed(undefined)))

const nativeMedia = (
  candidate: Candidate,
  attachment: AttachmentStore.Resolved,
  model: Model,
  inputCapabilities: ModelV2.Capabilities["input"],
): Effect.Effect<NativeAttachment | undefined> => {
  const mime = attachment.mime.toLowerCase()
  if (!candidate.current || attachment.nativeMediaDelivered) return Effect.succeed(undefined)
  if (candidate.file.mime.toLowerCase() !== mime) return Effect.succeed(undefined)
  const admission = model.route.media({ mime, bytes: attachment.size })
  if (!admission || !inputCapabilities.includes(admission.capability)) return Effect.succeed(undefined)
  return readMedia(attachment).pipe(
    Effect.map((data) => (data ? { type: "media" as const, path: attachment.path, mime, data } : undefined)),
  )
}

const resolveCandidate = Effect.fn("SessionRunner.resolveAttachment")(function* (input: {
  readonly store: AttachmentStore.Interface
  readonly sessionID: SessionSchema.ID
  readonly model: Model
  readonly inputCapabilities: ModelV2.Capabilities["input"]
  readonly candidate: Candidate
}) {
  const attachmentID = AttachmentStore.attachmentID(input.candidate.file.uri)
  if (!attachmentID) return yield* new AttachmentStore.ReferenceError({ sessionID: input.sessionID })
  const attachment = yield* input.store.resolve({ sessionID: input.sessionID, attachmentID })
  const native = yield* nativeMedia(input.candidate, attachment, input.model, input.inputCapabilities)
  return {
    uri: input.candidate.file.uri,
    materialized: native ?? { type: "path" as const, path: attachment.path },
    native: native ? attachment : undefined,
  }
})

export const materializeAttachments = Effect.fn("SessionRunner.materializeAttachments")(function* (input: {
  readonly store: AttachmentStore.Interface
  readonly sessionID: SessionSchema.ID
  readonly model: Model
  readonly inputCapabilities: ModelV2.Capabilities["input"]
  readonly context: readonly SessionMessage.Message[]
}) {
  const lastAssistant = input.context.findLastIndex((message) => message.type === "assistant")
  const candidates = input.context.flatMap((message, index): Candidate[] =>
    message.type === "user"
      ? (message.files ?? [])
          .filter((file) => AttachmentStore.isManagedURI(file.uri))
          .map((file) => ({ file, current: index > lastAssistant }))
      : [],
  )
  const unique = Array.from(new Map(candidates.map((candidate) => [candidate.file.uri, candidate])).values())
  const resolved = yield* Effect.forEach(unique, (candidate) =>
    resolveCandidate({
      store: input.store,
      sessionID: input.sessionID,
      model: input.model,
      inputCapabilities: input.inputCapabilities,
      candidate,
    }),
  )
  return {
    attachments: new Map(resolved.map((item) => [item.uri, item.materialized])),
    native: resolved.flatMap((item) => (item.native ? [item.native] : [])),
  } satisfies Materialization
})
