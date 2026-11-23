export * as Voice from "./voice.js"

import { type AIError } from "@opencode/ai/effect"
import {
  Realtime,
  type RealtimeSession,
  type RealtimeTransport,
  type RealtimeTransportInput,
  type RealtimeTransportType,
} from "@opencode/ai/experimental"
import { RequestExecutor } from "@opencode/ai/route"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer, Redacted, Schema } from "effect"
import { Credential } from "./credential.js"
import { requestExecutor } from "./effect/app-node-platform.js"
import { Integration } from "./integration.js"
import { Model } from "./model.js"
import { Provider } from "./provider.js"

export interface ModelInfo {
  readonly model: string
  readonly provider: string
  readonly transports: readonly RealtimeTransportType[]
  readonly available: boolean
}

export interface Models {
  readonly models: readonly ModelInfo[]
  readonly default?: string
}

export interface SessionInput {
  readonly model: string
  /** The model's provider. Old clients send only the model ID. */
  readonly provider?: string
  readonly session?: RealtimeSession
  readonly transport: RealtimeTransportInput
}

export class InvalidRequestError extends Schema.TaggedError<InvalidRequestError>()("Voice.InvalidRequestError", {
  message: Schema.String,
}) {}

export class UnavailableError extends Schema.TaggedError<UnavailableError>()("Voice.UnavailableError", {
  message: Schema.String,
  service: Schema.optional(Schema.String),
}) {}

export type Error = InvalidRequestError | UnavailableError

export interface Interface {
  readonly models: () => Effect.Effect<Models>
  readonly session: (input: SessionInput) => Effect.Effect<RealtimeTransport, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Voice") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const executor = yield* RequestExecutor.Service
    const integrations = yield* Integration.Service
    const providers = yield* Provider.Service
    const catalog = yield* Model.Service

    // The connected providers' realtime models with a voice protocol this server speaks, newest first.
    const listed = Effect.fnUntraced(function* () {
      const models = yield* catalog.available(["realtime"])
      return models.filter((model) => engineOf(model) !== undefined)
    })

    const models = Effect.fn("Voice.models")(function* () {
      const all = yield* listed()
      const list: ModelInfo[] = []
      for (const model of all) {
        if (list.some((item) => item.model === model.id)) continue
        const picked = pick(all, model.id)
        list.push({
          model: picked.id,
          provider: picked.providerID,
          transports: picked.realtime?.transports ?? [],
          available: true,
        })
      }
      // GPT-Live is the default, as it was before voice models came from the catalog.
      const live = all.find((model) => model.realtime?.protocol === "openai-live")
      const first = live?.id ?? list[0]?.model
      return first ? { models: list, default: first } : { models: list }
    })

    const session = Effect.fn("Voice.session")(function* (input: SessionInput) {
      const all = yield* listed()
      const model = input.provider
        ? all.find((item) => item.providerID === input.provider && item.id === input.model)
        : pick(all, input.model)
      const engine = model && engineOf(model)
      if (!model || !engine) return yield* new UnavailableError({ service: input.provider, message: missingKeyMessage })

      // The same credential a chat model of this provider uses: its active connection, else a configured key.
      const provider = yield* providers.get(model.providerID)
      const connection = yield* integrations.connection.active(
        provider?.integrationID ?? Integration.ID.make(model.providerID),
      )
      const resolved = connection
        ? yield* integrations.connection
            .resolve(connection)
            .pipe(Effect.mapError((error) => new UnavailableError({ service: model.providerID, message: error.message })))
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

    return Service.of({ models, session })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Integration.node, Provider.node, Model.node, requestExecutor],
})

const engineOf = (model: Model.Info) => Realtime.engines.find((engine) => engine.id === model.realtime?.protocol)

/** For a bare model ID, which old clients send: the model from its protocol's own provider, else OpenCode's. */
const pick = (models: readonly Model.Info[], id: string) => {
  const matching = models.filter((model) => model.id === id)
  const own = matching.find((model) => engineOf(model)?.provider === model.providerID)
  return own ?? matching[0]
}

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

const missingKeyMessage =
  "Voice needs an API key on the server for the model's provider (OpenAI, xAI or Google), or an OpenCode Console connection for GPT-Live. ChatGPT and SuperGrok sign-ins can't start voice sessions."
