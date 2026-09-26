import { Effect } from "effect"
import type { ModelMessage } from "ai"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import type { Session } from "./session"
import type { SessionID } from "./schema"

const CRYPTO_KEYS = ["reasoningEncryptedContent", "encrypted_content", "encryptedContent", "itemId"] as const

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const stripBox = (value: unknown) => {
  if (!isRecord(value)) return false
  let changed = false
  for (const key of CRYPTO_KEYS) {
    if (key in value) {
      delete value[key]
      changed = true
    }
  }
  if (isRecord(value.openai)) {
    if (stripBox(value.openai)) changed = true
    if (Object.keys(value.openai).length === 0) delete value.openai
  }
  return changed
}

export function stripRequest(messages: ModelMessage[]) {
  for (const message of messages) {
    if (message.role !== "assistant") continue
    if (!Array.isArray(message.content)) continue
    for (const part of message.content) {
      if (!part || typeof part !== "object") continue
      if (!("type" in part) || part.type !== "reasoning") continue
      const rec = part as unknown as Record<string, unknown>
      if (typeof rec.id === "string" && rec.id.startsWith("rs_")) delete rec.id
      stripBox(rec)
      stripBox(rec.providerOptions)
      stripBox(rec.providerMetadata)
      if (isRecord(rec.providerOptions) && Object.keys(rec.providerOptions).length === 0) delete rec.providerOptions
      if (isRecord(rec.providerMetadata) && Object.keys(rec.providerMetadata).length === 0) delete rec.providerMetadata
    }
  }
}

export function stripPart(part: SessionV1.ReasoningPart) {
  const metadata = part.metadata
  if (!isRecord(metadata) || !isRecord(metadata.openai)) return part
  const openai = { ...metadata.openai }
  if (!("reasoningEncryptedContent" in openai) && !("itemId" in openai)) return part
  delete openai.reasoningEncryptedContent
  delete openai.itemId
  const next = { ...metadata }
  if (Object.keys(openai).length === 0) delete next.openai
  else next.openai = openai
  return {
    ...part,
    metadata: Object.keys(next).length === 0 ? undefined : next,
  }
}

export const persist = (session: Session.Interface, sessionID: SessionID) =>
  Effect.gen(function* () {
    const msgs = yield* session.messages({ sessionID })
    for (const msg of msgs) {
      for (const part of msg.parts) {
        if (part.type !== "reasoning") continue
        const next = stripPart(part)
        if (next === part) continue
        yield* session.updatePart(next)
      }
    }
  })

export * as SessionStaleReasoning from "./stale-reasoning"
