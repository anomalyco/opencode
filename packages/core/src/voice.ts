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

    // Integration lists the active credential first, then newer stored credentials, then non-empty env vars.
    const findConnection = (provider: string, methods: readonly string[] = ["key"]) =>
      integrations
        .get(Integration.ID.make(provider))
        .pipe(
          Effect.map((info) => info?.connections.find((item) => item.type === "env" || methods.includes(item.method))),
        )

    // Where an engine's sessions start: its provider with the server's key or, for GPT-Live without an OpenAI key,
    // OpenCode's hosted GPT-Live with the server's OpenCode Console connection, whose sign-in works as well as a key.
    const source = Effect.fnUntraced(function* (engine: (typeof Realtime.engines)[number]) {
      const connection = yield* findConnection(engine.provider)
      if (connection) return { provider: engine.provider, connection }
      if (engine.id !== "openai-live") return undefined
      const hosted = yield* findConnection(openCodeLive.provider, ["key", "oauth"])
      return hosted && { provider: openCodeLive.provider, connection: hosted }
    })

    const models = Effect.fn("Voice.models")(function* () {
      const list = yield* Effect.forEach(Realtime.engines, (engine) =>
        source(engine).pipe(
          Effect.map((found) => ({
            model: engine.model,
            provider: found?.provider ?? engine.provider,
            transports: engine.transports,
            available: found !== undefined,
          })),
        ),
      )
      const first = list.find((item) => item.available)?.model
      return first ? { models: list, default: first } : { models: list }
    })

    const session = Effect.fn("Voice.session")(function* (input: SessionInput) {
      const engine = Realtime.engine(input.model)
      if (!engine) return yield* new InvalidRequestError({ message: `Unsupported voice model: ${input.model}` })

      const found = yield* source(engine)
      const credential = found
        ? yield* integrations.connection
            .resolve(found.connection)
            .pipe(Effect.mapError((error) => new UnavailableError({ service: found.provider, message: error.message })))
        : undefined
      const access = found && credential && sessionAccess(found.provider, credential)
      if (found === undefined || access === undefined)
        return yield* new UnavailableError({
          service: engine.provider,
          message: engine.id === "openai-live" ? missingLiveKeyMessage : missingKeyMessage[engine.provider],
        })

      return yield* Realtime.connect({
        model: input.model,
        session: input.session,
        transport: input.transport,
        ...access,
      }).pipe(
        Effect.provideService(RequestExecutor.Service, executor),
        Effect.mapError(
          (error: AIError): Error =>
            error.reason._tag === "InvalidRequest" || error.reason._tag === "UnsupportedOperation"
              ? new InvalidRequestError({ message: error.message })
              : new UnavailableError({ message: error.message, service: found.provider }),
        ),
      )
    })

    return Service.of({ models, session })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Integration.node, requestExecutor],
})

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

const missingLiveKeyMessage =
  "GPT-Live needs an OpenAI API key (a stored key or OPENAI_API_KEY) or an OpenCode Console connection on the server. ChatGPT sign-in can't start voice sessions."

const missingKeyMessage = {
  openai:
    "Voice needs an OpenAI API key on the server (a stored key or OPENAI_API_KEY). ChatGPT sign-in can't start voice sessions.",
  xai: "Voice needs an xAI API key on the server (a stored key or XAI_API_KEY).",
  google:
    "Voice needs a Google API key on the server (a stored key, GEMINI_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY, or GOOGLE_API_KEY).",
} as const
