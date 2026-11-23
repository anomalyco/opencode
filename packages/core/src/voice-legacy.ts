export * as VoiceLegacy from "./voice-legacy.js"

// Exists only for clients built before voice models were in the model list (iOS, Android, older desktop builds).
// Keeps their model lookup and credential search as they were. Delete this file with the deprecated /voice/models
// and /voice/session endpoints.

import {
  Realtime,
  type RealtimeEngine,
  type RealtimeSession,
  type RealtimeTransportInput,
  type RealtimeTransportType,
} from "@opencode/ai/experimental"
import { Effect } from "effect"
import { Integration } from "./integration.js"
import { ModelsDev } from "./models-dev.js"
import { Voice } from "./voice.js"

export interface ModelInfo {
  readonly model: string
  readonly provider: string
  readonly transports: readonly RealtimeTransportType[]
  readonly available: boolean
}

export interface SessionInput {
  readonly model: string
  readonly session?: RealtimeSession
  readonly transport: RealtimeTransportInput
}

// Integration lists the active credential first, then newer stored credentials, then non-empty env vars.
const findConnection = Effect.fnUntraced(function* (provider: string, methods: readonly string[] = ["key"]) {
  const integrations = yield* Integration.Service
  const info = yield* integrations.get(Integration.ID.make(provider))
  return info?.connections.find((item) => item.type === "env" || methods.includes(item.method))
})

// Where an engine's sessions start: its provider with the server's key or, for GPT-Live without an OpenAI key,
// OpenCode's hosted GPT-Live with the server's OpenCode Console connection, whose sign-in works as well as a key.
const source = Effect.fnUntraced(function* (engine: RealtimeEngine) {
  const connection = yield* findConnection(engine.provider)
  if (connection) return { provider: engine.provider, connection }
  if (engine.id !== "openai-live") return undefined
  const hosted = yield* findConnection("opencode", ["key", "oauth"])
  return hosted && { provider: "opencode", connection: hosted }
})

// Each engine's models.dev voice models from the provider that would start them, newest first.
const offered = Effect.fnUntraced(function* () {
  const catalog = yield* (yield* ModelsDev.Service).get()
  const lists = yield* Effect.forEach(Realtime.engines, (engine) =>
    source(engine).pipe(
      Effect.map((found) => {
        const provider = found?.provider ?? engine.provider
        return (catalog.find((item) => item.info.id === provider)?.models ?? [])
          .filter((model) => model.realtime?.protocol === engine.id)
          .toSorted((a, b) => b.time.released - a.time.released)
          .map((model) => {
            const info: ModelInfo = {
              model: model.id,
              provider,
              transports: engine.transports,
              available: found !== undefined,
            }
            return { engine, found, info }
          })
      }),
    ),
  )
  return lists.flat()
})

export const models = Effect.fn("VoiceLegacy.models")(function* () {
  const list = (yield* offered()).map((item) => item.info)
  const first = list.find((item) => item.available)?.model
  return first ? { models: list, default: first } : { models: list }
})

export const session = Effect.fn("VoiceLegacy.session")(function* (input: SessionInput) {
  const voice = yield* Voice.Service
  const integrations = yield* Integration.Service
  const list = yield* offered()
  const offer = list.find((item) => item.info.model === input.model)
  if (!offer)
    return yield* new Voice.InvalidRequestError({
      message: `Unsupported voice model: ${input.model}. This server lists ${list.map((item) => item.info.model).join(", ") || "none"}.`,
    })

  const engine = offer.engine
  const found = offer.found
  const credential = found
    ? yield* integrations.connection
        .resolve(found.connection)
        .pipe(
          Effect.mapError((error) => new Voice.UnavailableError({ service: found.provider, message: error.message })),
        )
    : undefined
  const access = found && credential && Voice.sessionAccess(found.provider, credential)
  if (found === undefined || access === undefined)
    return yield* new Voice.UnavailableError({
      service: engine.provider,
      message: engine.id === "openai-live" ? missingLiveKeyMessage : missingKeyMessage[engine.provider],
    })

  return yield* voice.start({
    engine,
    provider: found.provider,
    model: input.model,
    access,
    session: input.session,
    transport: input.transport,
  })
})

const missingLiveKeyMessage =
  "GPT-Live needs an OpenAI API key (a stored key or OPENAI_API_KEY) or an OpenCode Console connection on the server. ChatGPT sign-in can't start voice sessions."

const missingKeyMessage = {
  openai:
    "Voice needs an OpenAI API key on the server (a stored key or OPENAI_API_KEY). ChatGPT sign-in can't start voice sessions.",
  xai: "Voice needs an xAI API key on the server (a stored key or XAI_API_KEY).",
  google:
    "Voice needs a Google API key on the server (a stored key, GEMINI_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY, or GOOGLE_API_KEY).",
} as const
