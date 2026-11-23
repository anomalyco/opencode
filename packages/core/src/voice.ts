export * as Voice from "./voice.js"

import { type AIError } from "@opencode/ai/effect"
import {
  Realtime,
  type RealtimeSession,
  type RealtimeTransport,
  type RealtimeTransportInput,
} from "@opencode/ai/experimental"
import { RequestExecutor } from "@opencode/ai/route"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer, Redacted, Schema } from "effect"
import { Credential } from "./credential.js"
import { requestExecutor } from "./effect/app-node-platform.js"
import { Integration } from "./integration.js"
import { Model } from "./model.js"
import { ModelResolver } from "./model-resolver.js"
import { Provider } from "./provider.js"

export interface ConnectInput {
  readonly model: Model.Ref
  readonly session?: RealtimeSession
  readonly transport: RealtimeTransportInput
}

export class InvalidRequestError extends Schema.TaggedError<InvalidRequestError>()("Voice.InvalidRequestError", {
  message: Schema.String,
  field: Schema.optional(Schema.String),
}) {}

export class UnavailableError extends Schema.TaggedError<UnavailableError>()("Voice.UnavailableError", {
  message: Schema.String,
  service: Schema.optional(Schema.String),
}) {}

export class ModelNotFoundError extends Schema.TaggedError<ModelNotFoundError>()("Voice.ModelNotFoundError", {
  providerID: Schema.String,
  modelID: Schema.String,
  message: Schema.String,
}) {}

export class UnsupportedModelError extends Schema.TaggedError<UnsupportedModelError>()("Voice.UnsupportedModelError", {
  providerID: Schema.String,
  modelID: Schema.String,
  message: Schema.String,
}) {}

export type Error = InvalidRequestError | UnavailableError | ModelNotFoundError | UnsupportedModelError

export interface Interface {
  readonly connect: (input: ConnectInput) => Effect.Effect<RealtimeTransport, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Voice") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const executor = yield* RequestExecutor.Service
    const integrations = yield* Integration.Service
    const providers = yield* Provider.Service
    const catalog = yield* Model.Service

    const connect = Effect.fn("Voice.connect")(function* (input: ConnectInput) {
      const ref = input.model
      const listed = yield* catalog.available(["realtime"])
      const found = listed.find((item) => item.providerID === ref.providerID && item.id === ref.id)
      const engine = found && engineOf(found)
      if (!found || !engine) {
        // A ref no voice model has: another type's model (422) or no model at all (404), as generate answers.
        const other = (yield* catalog.available(["chat", "image", "video", "decision"])).find(
          (item) => item.providerID === ref.providerID && item.id === ref.id,
        )
        if (other)
          return yield* new UnsupportedModelError({
            providerID: ref.providerID,
            modelID: ref.id,
            message: `${ref.providerID}/${ref.id} is a ${other.type ?? "chat"} model, not a realtime model`,
          })
        return yield* new ModelNotFoundError({
          providerID: ref.providerID,
          modelID: ref.id,
          message: `Model not found: ${ref.providerID}/${ref.id}`,
        })
      }
      const model = yield* ModelResolver.withVariant(found, ref.variant).pipe(
        Effect.mapError((error) => new InvalidRequestError({ message: error.message, field: "model.variant" })),
      )

      // The same credential a chat model of this provider uses: its active connection, else a configured key.
      const provider = yield* providers.get(model.providerID)
      const connection = yield* integrations.connection.active(
        provider?.integrationID ?? Integration.ID.make(model.providerID),
      )
      const resolved = connection
        ? yield* integrations.connection
            .resolve(connection)
            .pipe(
              Effect.mapError((error) => new UnavailableError({ service: model.providerID, message: error.message })),
            )
        : undefined
      const configured = provider?.settings?.apiKey
      const credential =
        resolved ??
        (typeof configured === "string" && configured !== ""
          ? Credential.Key.make({ type: "key", key: configured })
          : undefined)
      const access = credential && sessionAccess(model.providerID, credential)
      if (access === undefined)
        return yield* new UnavailableError({ service: model.providerID, message: missingKeyMessage })

      return yield* Realtime.connect({
        engine,
        model: model.modelID,
        session: input.session,
        transport: input.transport,
        ...access,
      }).pipe(
        Effect.provideService(RequestExecutor.Service, executor),
        Effect.mapError(
          (error: AIError): Error =>
            error.reason._tag === "InvalidRequest" || error.reason._tag === "UnsupportedOperation"
              ? new InvalidRequestError({ message: error.message })
              : new UnavailableError({ message: error.message, service: model.providerID }),
        ),
      )
    })

    return Service.of({ connect })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Integration.node, Provider.node, Model.node, requestExecutor],
})

/** The voice protocol this server speaks for a realtime model, if any. */
export const engineOf = (model: Model.Info) => Realtime.engines.find((engine) => engine.id === model.realtime?.protocol)

/** OpenCode hosts GPT-Live on its OpenAI account, billed to the workspace whose credential starts a session. */
const openCodeLive = { provider: "opencode", baseURL: "https://opencode.ai/inference/openai/v1" } as const

/**
 * What a credential starts a session with: a provider's API key on its own API, or an OpenCode Console API key or
 * account sign-in on OpenCode's hosted GPT-Live, for the workspace the sign-in chose.
 */
const sessionAccess = (provider: string, credential: Credential.Value) => {
  if (provider !== openCodeLive.provider)
    return credential.type === "key" ? { apiKey: Redacted.make(credential.key) } : undefined
  if (credential.type === "external") return undefined
  const orgID = credential.metadata?.orgID
  return {
    apiKey: Redacted.make(credential.type === "oauth" ? credential.access : credential.key),
    baseURL: openCodeLive.baseURL,
    ...(typeof orgID === "string" ? { headers: { "x-opencode-org-id": orgID } } : {}),
  }
}

export const missingKeyMessage =
  "Voice needs an API key on the server for the model's provider (OpenAI, xAI or Google), or an OpenCode Console connection for GPT-Live. ChatGPT and SuperGrok sign-ins can't start voice sessions."
