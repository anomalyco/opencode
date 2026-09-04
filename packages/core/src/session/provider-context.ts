export * as SessionProviderContext from "./provider-context.js"

import { Message } from "@opencode-ai/ai"
import { SessionProviderContext } from "@opencode-ai/schema/session-provider-context"
import { Schema } from "effect"
import { createHash } from "node:crypto"
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
    endpoint: createHash("sha256")
      .update(
        JSON.stringify([
          endpoint.baseURL,
          endpoint.path,
          Object.entries(endpoint.query ?? {}).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
        ]),
      )
      .digest("hex"),
  }
}

export const compatible = (context: Info, target: Provenance | undefined) =>
  target !== undefined &&
  context.provenance.providerID === target.providerID &&
  context.provenance.provider === target.provider &&
  context.provenance.modelID === target.modelID &&
  context.provenance.route === target.route &&
  context.provenance.protocol === target.protocol &&
  context.provenance.endpoint === target.endpoint

/** Stores the canonical replacement, not a local summary or transport continuation.
 * AI's JSON codec normalizes binary media to its equivalent base64 string form.
 */
export const encode = (provenance: Provenance, replacement: ReadonlyArray<Message>): Info => ({
  version: 1,
  provenance,
  messages: Schema.encodeSync(messages)(replacement),
})

export const decode = (context: Info) => Schema.decodeUnknownSync(messages)(context.messages)
export const validate = (context: Info) => Schema.decodeUnknownEffect(messages)(context.messages)
