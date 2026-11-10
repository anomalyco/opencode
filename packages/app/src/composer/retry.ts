import { checksum } from "@opencode/util/encode"
import type { SessionMessage } from "@opencode/schema/session-message"
import type { ComposerDelivery, ComposerSelection } from "./adapter"
import { buildPromptRequest } from "./request"
import type { ContextItem, Prompt } from "./schema"

/** The admission ID of a prompt whose send failed, kept to resend exactly the payload it carried. */
export type ComposerRetry = { readonly id: SessionMessage.ID; readonly fingerprint: string }

export type ComposerRetryPayload = {
  readonly mode: "normal" | "shell"
  readonly delivery: ComposerDelivery
  readonly selection: ComposerSelection
  readonly prompt: Prompt
  readonly context: readonly (ContextItem & { key: string })[]
}

/**
 * The server keeps the first payload admitted under an ID and ignores a retried one, so a failed prompt's ID may only
 * be reused for the same request. This names that request: what the server receives, not how the draft stores it.
 */
export function retryFingerprint(payload: ComposerRetryPayload) {
  const request = buildPromptRequest({
    prompt: payload.prompt,
    context: [...payload.context],
    // A blob ID names an image's bytes; its URL changes whenever a reload resolves the draft again.
    images: payload.prompt.flatMap((part) =>
      part.type === "image"
        ? [
            {
              type: part.type,
              id: part.id,
              filename: part.filename,
              sourcePath: part.sourcePath,
              mime: part.mime,
              dataUrl: part.blob.id,
            },
          ]
        : [],
    ),
    text: payload.prompt.map((part) => ("content" in part ? part.content : "")).join(""),
    sessionDirectory: "",
  })

  const raw = JSON.stringify([
    payload.mode,
    payload.delivery,
    payload.selection.agent,
    payload.selection.model.providerID,
    payload.selection.model.modelID,
    payload.selection.variant ?? null,
    request,
  ])

  return `${raw.length}:${checksum(raw)}`
}

/** The ID a send uses: the failed prompt's own when it resends that very payload, otherwise a fresh one. */
export function claimRetry(retry: ComposerRetry | undefined, payload: ComposerRetryPayload, fresh: SessionMessage.ID) {
  if (!retry) return fresh

  return retry.fingerprint === retryFingerprint(payload) ? retry.id : fresh
}
