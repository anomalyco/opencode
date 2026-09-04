export * as SessionProviderContext from "./provider-context.js"

import { Message } from "@opencode-ai/ai"
import { SessionProviderContext } from "@opencode-ai/schema/session-provider-context"
import { Schema } from "effect"
import { Hash } from "@opencode-ai/util/hash"
import type { SessionRunnerModel } from "./runner/model.js"

export type Provenance = SessionProviderContext.Provenance
export const Info = SessionProviderContext.Info
export type Info = SessionProviderContext.Info

const messages = Schema.toCodecJson(Schema.Array(Message))

/** No guessed endpoints. Dynamic URL builders cannot establish a durable deployment identity here. */
export function provenance(resolved: Pick<SessionRunnerModel.Resolved, "model" | "ref">): Provenance | undefined {
  const model = resolved.model
  const endpoint = model.route.endpoint
  if (!endpoint.baseURL || typeof endpoint.path !== "string") return undefined
  return {
    providerID: resolved.ref.providerID,
    provider: model.provider,
    modelID: model.id,
    route: model.route.id,
    protocol: model.route.protocol,
    endpoint: Hash.sha256(
      JSON.stringify([
        endpoint.baseURL,
        endpoint.path,
        Object.entries(endpoint.query ?? {}).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
      ]),
    ),
  }
}

export const compatible = (source: Provenance, target: Provenance | undefined) =>
  target !== undefined &&
  source.providerID === target.providerID &&
  source.provider === target.provider &&
  source.modelID === target.modelID &&
  source.route === target.route &&
  source.protocol === target.protocol &&
  source.endpoint === target.endpoint

/** Stores the canonical replacement, not a local summary or transport continuation.
 * Provider and attachment metadata can contain optional undefined entries. Use JSON's
 * omission semantics, while preserving canonical binary media as equivalent base64.
 */
export const encode = (provenance: Provenance, replacement: ReadonlyArray<Message>): Info => ({
  version: 1,
  provenance,
  messages: Schema.decodeSync(Schema.fromJsonString(Schema.Json))(
    JSON.stringify(
      replacement.map((message) => ({
        ...message,
        content: message.content.map((part) =>
          part.type === "media" && part.data instanceof Uint8Array
            ? { ...part, data: Buffer.from(part.data).toString("base64") }
            : part,
        ),
      })),
    ),
  ),
})

export const decode = (context: Info) => Schema.decodeUnknownSync(messages)(context.messages)
export const validate = (context: Info) => Schema.decodeUnknownEffect(messages)(context.messages)
