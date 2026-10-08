import { describe, expect } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import { Speech, SpeechClient, SpeechEvent } from "../../src/index.js"
import { XAI } from "../../src/providers.js"
import { it } from "../lib/effect.js"
import { dynamicResponse, type Call, type Handler, observe } from "../lib/http.js"

const layer = (handler: Handler) => SpeechClient.layer.pipe(Layer.provideMerge(dynamicResponse(handler)))

const xai = XAI.configure({ apiKey: "test", baseURL: "https://api.xai.test/v1" })
const model = xai.speech("grok-tts")

const respondAudio = (calls: Array<Call>, body: Uint8Array | ReadableStream<Uint8Array>, contentType: string) =>
  layer((input) =>
    observe(calls, input).pipe(Effect.map(() => input.respond(body, { headers: { "content-type": contentType } }))),
  )

describe("xAI Speech", () => {
  it.effect("lowers common fields into the TTS body and describes the requested container", () => {
    const calls: Array<Call> = []
    return Effect.gen(function* () {
      const wav = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45])
      const response = yield* Speech.generate({
        model,
        text: "Hello from OpenCode.",
        voice: { id: "nlbqfwie" },
        speed: 1.2,
        language: "en",
        format: "wav",
        providerOptions: { sampleRate: 44100, text_normalization: true },
        http: { body: { replace: { OpenCode: "Open Code" } } },
      }).pipe(Effect.provide(respondAudio(calls, wav, "audio/wav")))

      expect(calls.map((call) => [call.method, call.url, call.headers.get("authorization")])).toEqual([
        ["POST", "https://api.xai.test/v1/tts", "Bearer test"],
      ])
      expect(JSON.parse(calls[0].body)).toEqual({
        text: "Hello from OpenCode.",
        voice_id: "nlbqfwie",
        language: "en",
        output_format: { codec: "wav", sample_rate: 44100 },
        speed: 1.2,
        text_normalization: true,
        replace: { OpenCode: "Open Code" },
      })
      expect(response.audio.mediaType).toBe("audio/wav")
      expect(response.audio.info).toEqual({ format: "wav", sampleRate: 44100 })
      expect(yield* response.audio.bytes()).toEqual(wav)
      expect(response.usage).toBeUndefined()
    })
  })

  it.effect("defaults to auto-detected language and 24 kHz MP3", () => {
    const calls: Array<Call> = []
    return Effect.gen(function* () {
      const response = yield* Speech.generate({ model, text: "Hi" }).pipe(
        Effect.provide(respondAudio(calls, Uint8Array.from([0x49, 0x44, 0x33, 4]), "audio/mpeg")),
      )

      expect(JSON.parse(calls[0].body)).toEqual({ text: "Hi", language: "auto", output_format: { codec: "mp3" } })
      expect(response.audio.mediaType).toBe("audio/mpeg")
      expect(response.audio.info).toEqual({ format: "mp3", sampleRate: 24000 })
    })
  })

  it.effect("streams raw body chunks as audio deltas and describes headerless PCM", () => {
    const calls: Array<Call> = []
    return Effect.gen(function* () {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(Uint8Array.from([1, 2]))
          controller.enqueue(Uint8Array.from([3, 4, 5]))
          controller.close()
        },
      })
      const events = Array.from(
        yield* Stream.runCollect(Speech.stream({ model, text: "Hi", voice: "eve", format: "pcm" })).pipe(
          Effect.provide(respondAudio(calls, body, "audio/pcm")),
        ),
      )

      expect(JSON.parse(calls[0].body)).toEqual({
        text: "Hi",
        voice_id: "eve",
        language: "auto",
        output_format: { codec: "pcm" },
      })
      expect(events.map((event) => event.type)).toEqual(["audio-delta", "audio-delta", "finish"])
      expect(events.filter(SpeechEvent.is.audioDelta).map((event) => Array.from(event.chunk))).toEqual([
        [1, 2],
        [3, 4, 5],
      ])
      const finish = events.find(SpeechEvent.is.finish)
      expect(finish?.audio.mediaType).toBe("audio/pcm")
      expect(finish?.audio.info).toEqual({ format: "pcm", encoding: "pcm_s16le", sampleRate: 24000, channels: 1 })
      expect(yield* finish!.audio.bytes()).toEqual(Uint8Array.from([1, 2, 3, 4, 5]))
    })
  })

  it.effect("describes telephony codecs at the requested sample rate", () =>
    Effect.gen(function* () {
      const response = yield* Speech.generate({
        model,
        text: "Hi",
        format: "mulaw",
        providerOptions: { sampleRate: 8000 },
      }).pipe(Effect.provide(respondAudio([], Uint8Array.from([0xff, 0x7f]), "audio/basic")))

      expect(response.audio.mediaType).toBe("audio/mulaw")
      expect(response.audio.info).toEqual({ format: "pcm", encoding: "pcm_mulaw", sampleRate: 8000, channels: 1 })
    }),
  )

  it.effect("rejects what xAI cannot lower before sending anything", () =>
    Effect.gen(function* () {
      const errors = yield* Effect.all(
        [
          Speech.generate({ model, text: "Hi", instructions: "Warm." }),
          Speech.generate({ model, text: "Hi", timestamps: true }),
          Stream.runCollect(Speech.stream({ model, text: "Hi", format: "opus" })),
        ].map((effect) => Effect.flip(effect)),
      )

      expect(errors.map((error) => [error.reason._tag, "operation" in error.reason && error.reason.operation])).toEqual(
        [
          ["UnsupportedOperation", "media.instructions"],
          ["UnsupportedOperation", "media.timestamps"],
          ["UnsupportedOperation", "media.format"],
        ],
      )
      expect(errors[2].reason).toMatchObject({ provider: "xai", route: "xai-speech" })
    }).pipe(Effect.provide(layer(() => Effect.die("an unsupported request reached the network")))),
  )

  it.effect("fails typed when the provider returns no audio", () =>
    Effect.gen(function* () {
      const error = yield* Speech.generate({ model, text: "Hi" }).pipe(
        Effect.provide(respondAudio([], new Uint8Array(), "audio/mpeg")),
        Effect.flip,
      )

      expect(error.reason).toMatchObject({ _tag: "InvalidProviderOutput", route: "xai-speech" })
      expect(error.reason.http?.status).toBe(200)
    }),
  )
})
