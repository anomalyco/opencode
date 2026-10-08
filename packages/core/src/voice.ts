export * as Voice from "./voice.js"

import {
  Media,
  Speech,
  SpeechEvent,
  Transcription,
  type AIError,
  type SpeechModel,
  type TranscriptionModel,
} from "@opencode/ai"
import { SpeechClient } from "@opencode/ai/speech-client"
import { TranscriptionClient } from "@opencode/ai/transcription-client"
import type { ConfigModel } from "@opencode/schema/config/model"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer, Schema, Stream } from "effect"
import { Config } from "./config.js"
import { speechClient, transcriptionClient } from "./effect/app-node-platform.js"
import { Integration } from "./integration.js"
import { Plugin } from "./plugin.js"
import { Provider } from "./provider.js"

export class UnavailableError extends Schema.TaggedError<UnavailableError>()("Voice.UnavailableError", {
  message: Schema.String,
  service: Schema.optional(Schema.String),
}) {}

/** How `audio` chunks decode. Raw PCM is interleaved little-endian 16-bit samples. */
export type Format =
  | { readonly type: "mp3" }
  | { readonly type: "pcm"; readonly sampleRate: number; readonly channels: number }

export type SpeechChunk =
  | { readonly type: "format"; readonly format: Format }
  | { readonly type: "audio"; readonly chunk: Uint8Array }

export interface Interface {
  readonly transcribe: (input: {
    readonly audio: Uint8Array
    readonly mediaType: string
  }) => Effect.Effect<string, UnavailableError>
  /** Fails before streaming when voice is not configured. The stream starts with one `format` chunk. */
  readonly speak: (input: {
    readonly text: string
  }) => Effect.Effect<Stream.Stream<SpeechChunk, UnavailableError>, UnavailableError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Voice") {}

type Facade = {
  readonly speech?: (modelID: string) => SpeechModel
  readonly transcription?: (modelID: string) => TranscriptionModel
}

type Settings = { readonly apiKey?: string; readonly baseURL?: string }

// Speech and transcription models are not in the model catalog, so each provider package maps to its facade directly.
const facades: Record<string, () => Promise<{ readonly configure: (settings: Settings) => Facade }>> = {
  "@opencode/ai/providers/openai": () => import("@opencode/ai/providers/openai"),
  "@opencode/ai/providers/google": () => import("@opencode/ai/providers/google"),
  "@opencode/ai/providers/xai": () => import("@opencode/ai/providers/xai"),
  "@opencode/ai/providers/elevenlabs": () => import("@opencode/ai/providers/elevenlabs"),
  "@opencode/ai/providers/deepgram": () => import("@opencode/ai/providers/deepgram"),
  "@opencode/ai/providers/assemblyai": () => import("@opencode/ai/providers/assemblyai"),
}

// Gemini speech is PCM only; every other supported provider streams MP3.
const pcm: Record<string, Format> = {
  "@opencode/ai/providers/google": { type: "pcm", sampleRate: 24000, channels: 1 },
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const providers = yield* Provider.Service
    const integrations = yield* Integration.Service
    const speech = yield* SpeechClient.Service
    const transcription = yield* TranscriptionClient.Service
    const plugins = yield* Plugin.Service

    const facade = Effect.fn("Voice.facade")(function* (selection: ConfigModel.Selection) {
      // Config providers register during plugin activation, which may still be running on a fresh Location.
      yield* plugins.awaitActivation
      const provider = yield* providers.get(selection.providerID)
      const connection = yield* integrations.connection.active(
        provider?.integrationID ?? Integration.ID.make(selection.providerID),
      )
      const credential = connection ? yield* integrations.connection.resolve(connection) : undefined
      const specifier = provider?.package || `@opencode/ai/providers/${selection.providerID}`
      const load = facades[specifier]
      if (!load)
        return yield* new UnavailableError({
          message: `Provider ${selection.providerID} has no speech or transcription support`,
          service: selection.providerID,
        })
      // OAuth logins target chat backends that do not serve audio endpoints; fall back to API-key environment variables.
      const settings: Settings =
        credential?.type === "oauth"
          ? {}
          : {
              apiKey: credential?.type === "key" ? credential.key : stringSetting(provider?.settings?.apiKey),
              baseURL: stringSetting(provider?.settings?.baseURL),
            }
      const { configure } = yield* Effect.promise(load)
      return { specifier, facade: configure(settings) }
    })

    const selected = Effect.fn("Voice.selected")(function* <Key extends "transcription" | "speech">(key: Key) {
      const voice = Config.latest(yield* config.entries(), "voice")
      const selection = voice?.[key]
      if (!selection)
        return yield* new UnavailableError({
          message: `Configure voice.${key}.model to use ${key === "speech" ? "text-to-speech" : "speech-to-text"}`,
        })
      return selection
    })

    const unavailable = (providerID: string) => (error: AIError) =>
      new UnavailableError({ message: describe(error), service: providerID })

    const transcribe: Interface["transcribe"] = Effect.fn("Voice.transcribe")(
      function* (input) {
        const selection = yield* selected("transcription")
        const loaded = yield* facade(selection.model)
        if (!loaded.facade.transcription)
          return yield* new UnavailableError({
            message: `Provider ${selection.model.providerID} does not support transcription`,
            service: selection.model.providerID,
          })
        const response = yield* Transcription.generate({
          model: loaded.facade.transcription(selection.model.model),
          audio: Media.bytes(input.audio, input.mediaType),
          language: selection.language,
        }).pipe(
          Effect.provideService(TranscriptionClient.Service, transcription),
          Effect.mapError(unavailable(selection.model.providerID)),
        )
        return response.text.trim()
      },
      Effect.catchTag("Integration.Authorization", () => Effect.fail(credentialsUnavailable)),
    )

    const speak: Interface["speak"] = Effect.fn("Voice.speak")(
      function* (input) {
        const selection = yield* selected("speech")
        const loaded = yield* facade(selection.model)
        if (!loaded.facade.speech)
          return yield* new UnavailableError({
            message: `Provider ${selection.model.providerID} does not support speech`,
            service: selection.model.providerID,
          })
        const format = pcm[loaded.specifier] ?? { type: "mp3" as const }
        const audio = Speech.stream({
          model: loaded.facade.speech(selection.model.model),
          text: input.text,
          voice: selection.voice,
          format: format.type,
          speed: selection.speed,
          language: selection.language,
          instructions: selection.instructions,
        }).pipe(
          Stream.provideService(SpeechClient.Service, speech),
          Stream.filter(SpeechEvent.is.audioDelta),
          Stream.map((event): SpeechChunk => ({ type: "audio", chunk: event.chunk })),
          Stream.mapError(unavailable(selection.model.providerID)),
        )
        return Stream.succeed<SpeechChunk>({ type: "format", format }).pipe(Stream.concat(audio))
      },
      Effect.catchTag("Integration.Authorization", () => Effect.fail(credentialsUnavailable)),
    )

    return Service.of({ transcribe, speak })
  }),
)

const credentialsUnavailable = new UnavailableError({ message: "Voice provider credentials are unavailable" })

// Unrecognized provider error bodies leave only "HTTP 403" in the message; the body usually says why.
function describe(error: AIError) {
  const body = error.reason.body?.trim()
  if (!body || body.includes(error.message)) return error.message
  return `${error.message}: ${body.slice(0, 500)}`
}

function stringSetting(value: unknown) {
  return typeof value === "string" && value !== "" ? value : undefined
}

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Config.node, Provider.node, Integration.node, Plugin.node, speechClient, transcriptionClient],
})
