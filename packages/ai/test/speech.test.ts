import { describe, expect } from "bun:test"
import { Effect, Encoding, Layer, Stream } from "effect"
import { Speech, SpeechClient, SpeechEvent } from "../src/index.js"
import { Cartesia, Deepgram, ElevenLabs, Google, OpenAI } from "../src/providers.js"
import { it } from "./lib/effect.js"
import { dynamicResponse } from "./lib/http.js"
import { sseEvents } from "./lib/sse.js"

// Recorded tests in test/provider cover lowering and decoding; these cover what recordings cannot.

const layer = (handler: Parameters<typeof dynamicResponse>[0]) =>
  SpeechClient.layer.pipe(Layer.provideMerge(dynamicResponse(handler)))

const respond = (body: string | ReadableStream<Uint8Array>, contentType: string) =>
  layer((input) => Effect.succeed(input.respond(body, { headers: { "content-type": contentType } })))

const collect = <E, R>(stream: Stream.Stream<SpeechEvent, E, R>) =>
  stream.pipe(
    Stream.runCollect,
    Effect.map((events) => Array.from(events)),
  )

const openai = OpenAI.configure({ apiKey: "test", baseURL: "https://openai.test/v1" }).speech("gpt-4o-mini-tts")
const elevenlabs = ElevenLabs.configure({ apiKey: "test", baseURL: "https://elevenlabs.test" }).speech(
  "eleven_flash_v2_5",
)
const cartesia = Cartesia.configure({ apiKey: "test", baseURL: "https://cartesia.test" }).speech("sonic-3")
const google = Google.configure({ apiKey: "test", baseURL: "https://google.test/v1beta" }).speech(
  "gemini-2.5-flash-preview-tts",
)
const google38 = Google.configure({ apiKey: "test", baseURL: "https://google.test/v1beta" }).speech(
  "gemini-3.8-flash-tts",
)
const google38Lite = Google.configure({ apiKey: "test", baseURL: "https://google.test/v1beta" }).speech(
  "gemini-3.8-flash-lite-tts",
)
const deepgram = Deepgram.configure({ apiKey: "test", baseURL: "https://deepgram.test" }).speech("aura-2-thalia-en")
const voice = "JBFqnCBsd6RMkjVDRZzb"

describe("Speech", () => {
  it.effect("preserves Google's WAV output instead of describing it as raw PCM", () =>
    Effect.gen(function* () {
      const bytes = new TextEncoder().encode("RIFF....WAVEfmt ")
      const response = yield* Speech.generate({ model: google38, text: "Hi" }).pipe(
        Effect.provide(
          respond(
            JSON.stringify({
              candidates: [
                { content: { parts: [{ inlineData: { mimeType: "audio/wav", data: Encoding.encodeBase64(bytes) } }] } },
              ],
            }),
            "application/json",
          ),
        ),
      )
      expect(response.audio.mediaType).toBe("audio/wav")
      expect(response.audio.info?.format).toBe("wav")
      expect(response.audio.info?.encoding).toBeUndefined()
      expect(yield* response.audio.bytes()).toEqual(bytes)
    }),
  )

  it.effect("describes OpenAI audio in the format the request body actually asked for", () =>
    Effect.gen(function* () {
      const [pcm, wav] = yield* Effect.all([
        Speech.generate({ model: openai, text: "Hi", format: "mp3", providerOptions: { response_format: "pcm" } }),
        Speech.generate({ model: openai, text: "Hi", http: { body: { response_format: "wav" } } }),
      ]).pipe(Effect.provide(respond("\u0001\u0002", "application/octet-stream")))
      expect(pcm.audio.mediaType).toBe("audio/pcm")
      expect(pcm.audio.info).toEqual({ format: "pcm", encoding: "pcm_s16le", sampleRate: 24000, channels: 1 })
      expect(wav.audio.mediaType).toBe("audio/wav")
      expect(wav.audio.info?.format).toBe("wav")
    }),
  )

  it.effect("describes Deepgram raw encodings in their default WAV container", () =>
    Effect.gen(function* () {
      const response = yield* Speech.generate({ model: deepgram, text: "Hi", providerOptions: { encoding: "mulaw" } })
      expect(response.audio.mediaType).toBe("audio/wav")
      expect(response.audio.info?.format).toBe("wav")
    }).pipe(Effect.provide(respond("RIFF....WAVEfmt ", "audio/wav"))),
  )

  it.effect("always gives headerless Deepgram PCM a sample rate", () =>
    Effect.gen(function* () {
      const [requested, defaulted] = yield* Effect.all([
        Speech.generate({
          model: deepgram,
          text: "Hi",
          providerOptions: { encoding: "mulaw", container: "none", sampleRate: 16000 },
        }),
        Speech.generate({ model: deepgram, text: "Hi", providerOptions: { encoding: "alaw", container: "none" } }),
      ]).pipe(Effect.provide(respond("\u0001\u0002", "audio/basic")))
      expect(requested.audio.info).toEqual({ format: "pcm", encoding: "pcm_mulaw", sampleRate: 16000, channels: 1 })
      expect(defaulted.audio.info).toEqual({ format: "pcm", encoding: "pcm_alaw", sampleRate: 8000, channels: 1 })
    }),
  )

  it.effect("rejects raw PCM for Gemini 3.8 unary requests before sending", () =>
    Effect.gen(function* () {
      const errors = yield* Effect.all(
        [google38, google38Lite].map((model) =>
          Speech.generate({ model, text: "Hi", format: "pcm" }).pipe(Effect.flip),
        ),
      ).pipe(Effect.provide(layer(() => Effect.die("An unsupported request reached the network"))))
      expect(errors.map((error) => error.reason._tag)).toEqual(["UnsupportedOperation", "UnsupportedOperation"])
    }),
  )

  it.effect("rejects what a provider cannot produce before sending anything", () =>
    Effect.gen(function* () {
      const errors = yield* Effect.all(
        [
          Speech.generate({ model: openai, text: "Hi", timestamps: true }),
          Speech.generate({ model: openai, text: "Hi", format: "ogg" }),
          Speech.generate({ model: google, text: "Hi", format: "mp3" }),
          Speech.generate({ model: google, text: "Hi", instructions: "Warm." }),
          collect(Speech.stream({ model: elevenlabs, text: "Hi", voice, format: "wav" })),
          collect(Speech.stream({ model: cartesia, text: "Hi", voice, format: "mp3" })),
          Speech.generate({ model: deepgram, text: "Hi", voice: "thalia" }),
        ].map((effect) => Effect.flip(effect)),
      )
      expect(errors.map((error) => [error.reason._tag, "operation" in error.reason && error.reason.operation])).toEqual(
        [
          ["UnsupportedOperation", "media.timestamps"],
          ["UnsupportedOperation", "media.format"],
          ["UnsupportedOperation", "media.format"],
          ["UnsupportedOperation", "media.instructions"],
          ["UnsupportedOperation", "media.format"],
          ["UnsupportedOperation", "media.format"],
          ["UnsupportedOperation", "media.voice"],
        ],
      )
      expect(errors[1].reason).toMatchObject({ provider: "openai", route: "openai-speech" })
      expect(errors[2].reason).toMatchObject({ provider: "google", route: "google-speech" })
    }).pipe(Effect.provide(layer(() => Effect.die("an unsupported request reached the network")))),
  )

  it.effect("treats timestamps: false as not asking for timestamps on routes that cannot return them", () =>
    Effect.gen(function* () {
      const bytes = Uint8Array.from([1, 2, 3])
      const gemini = JSON.stringify({
        candidates: [
          { content: { parts: [{ inlineData: { mimeType: "audio/L16;codec=pcm;rate=24000", data: "AQID" } }] } },
        ],
      })
      const responses = yield* Effect.all([
        Speech.generate({ model: openai, text: "Hi", timestamps: false }).pipe(
          Effect.provide(respond(new Blob([bytes]).stream(), "audio/mpeg")),
        ),
        Speech.generate({ model: google, text: "Hi", timestamps: false }).pipe(
          Effect.provide(respond(gemini, "application/json")),
        ),
        Speech.generate({ model: deepgram, text: "Hi", timestamps: false }).pipe(
          Effect.provide(respond(new Blob([bytes]).stream(), "audio/mpeg")),
        ),
      ])
      for (const response of responses) expect(yield* response.audio.bytes()).toEqual(bytes)

      const errors = yield* Effect.all(
        [openai, google, deepgram].map((model) =>
          Speech.generate({ model, text: "Hi", timestamps: true }).pipe(Effect.flip),
        ),
      ).pipe(Effect.provide(layer(() => Effect.die("an unsupported request reached the network"))))
      expect(errors.map((error) => [error.reason._tag, "operation" in error.reason && error.reason.operation])).toEqual(
        [
          ["UnsupportedOperation", "media.timestamps"],
          ["UnsupportedOperation", "media.timestamps"],
          ["UnsupportedOperation", "media.timestamps"],
        ],
      )
    }),
  )

  it.effect("classifies stream failures and keeps the provider payload and HTTP context", () =>
    Effect.gen(function* () {
      const badFrame = JSON.stringify({ type: "speech.audio.delta", audio: "not base64!" })
      const cartesiaError = { type: "error", done: true, status_code: 400, title: "Invalid model", message: "Nope" }
      const blocked = JSON.stringify({ promptFeedback: { blockReason: "PROHIBITED_CONTENT" } })
      const [truncated, invalid, provider, policy] = yield* Effect.all(
        [
          collect(Speech.stream({ model: openai, text: "Hi" })).pipe(
            Effect.provide(respond(sseEvents({ type: "speech.audio.delta", audio: "AQI=" }), "text/event-stream")),
          ),
          collect(Speech.stream({ model: openai, text: "Hi" })).pipe(
            Effect.provide(respond(sseEvents(badFrame), "text/event-stream")),
          ),
          collect(Speech.stream({ model: cartesia, text: "Hi", voice })).pipe(
            Effect.provide(respond(sseEvents(cartesiaError), "text/event-stream")),
          ),
          Speech.generate({ model: google, text: "Hi" }).pipe(Effect.provide(respond(blocked, "application/json"))),
        ].map((effect) => Effect.flip(effect)),
      )

      expect(truncated.reason).toMatchObject({ _tag: "InvalidProviderOutput", classification: "incomplete-stream" })
      expect(truncated.reason.http?.status).toBe(200)
      expect(invalid.reason).toMatchObject({ _tag: "InvalidProviderOutput", body: badFrame })
      expect(invalid.reason.http?.status).toBe(200)
      expect(provider.reason).toMatchObject({ _tag: "InvalidRequest", body: JSON.stringify(cartesiaError) })
      expect(provider.message).toBe("Cartesia stream failed (Invalid model): Nope")
      expect(policy.reason).toMatchObject({ _tag: "ContentPolicy", body: blocked })
    }),
  )

  it.effect("parses ElevenLabs timestamped records split across network chunks", () =>
    Effect.gen(function* () {
      const record = (bytes: ReadonlyArray<number>, character: string, start: number) =>
        JSON.stringify({
          audio_base64: Encoding.encodeBase64(Uint8Array.from(bytes)),
          alignment: {
            characters: [character],
            character_start_times_seconds: [start],
            character_end_times_seconds: [start + 0.1],
          },
        })
      const first = record([1, 2], "H", 0)
      const second = record([3], "i", 0.1)
      const encoder = new TextEncoder()
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(`${first}\n${second.slice(0, 10)}`))
          controller.enqueue(encoder.encode(`${second.slice(10)}\n`))
          controller.close()
        },
      })

      const events = yield* collect(Speech.stream({ model: elevenlabs, text: "Hi", voice, timestamps: true })).pipe(
        Effect.provide(respond(body, "application/json")),
      )

      expect(events.map((event) => event.type)).toEqual([
        "audio-delta",
        "timestamps",
        "audio-delta",
        "timestamps",
        "finish",
      ])
      expect(events.filter(SpeechEvent.is.timestamps).flatMap((event) => event.items)).toEqual([
        { text: "H", startSeconds: 0, endSeconds: 0.1 },
        { text: "i", startSeconds: 0.1, endSeconds: 0.2 },
      ])
      const finish = events.find(SpeechEvent.is.finish)
      expect(yield* finish!.audio.bytes()).toEqual(Uint8Array.from([1, 2, 3]))
    }),
  )
})
