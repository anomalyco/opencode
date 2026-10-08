import { describe, expect } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import { HttpClientRequest } from "effect/unstable/http"
import { Media, Transcription, TranscriptionClient } from "../../src/index.js"
import { XAI } from "../../src/providers.js"
import { it } from "../lib/effect.js"
import { dynamicResponse, json, type Handler } from "../lib/http.js"

const layer = (handler: Handler) => TranscriptionClient.layer.pipe(Layer.provideMerge(dynamicResponse(handler)))

const model = XAI.configure({ apiKey: "test", baseURL: "https://api.xai.test/v1" }).transcription(
  "grok-voice-transcribe-2.0",
)
const audio = Media.bytes(Uint8Array.from([0x49, 0x44, 0x33, 1, 2, 3]), "audio/mpeg")

interface Upload {
  readonly url: string
  readonly authorization: string | null
  readonly form: FormData
}

/** Reply with `body` and keep every request's parsed multipart form. */
const respondTranscript = (uploads: Array<Upload>, body: unknown) =>
  layer((input) =>
    Effect.gen(function* () {
      const web = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
      const form = yield* Effect.promise(() => web.formData())
      uploads.push({ url: web.url, authorization: web.headers.get("authorization"), form })
      return json(input, body)
    }),
  )

describe("xAI Transcription", () => {
  it.effect("uploads inline audio as multipart with file last and splits diarized words into speaker turns", () => {
    const uploads: Array<Upload> = []
    return Effect.gen(function* () {
      const request = Transcription.request({
        model,
        audio,
        language: "en",
        diarize: true,
        timestamps: "word",
        providerOptions: { format: true, keyterm: ["OpenCode", "Grok"], filler_words: false },
        http: { body: { vad_threshold: 0.3, model: "ignored" } },
      })
      const response = yield* Transcription.generate(request)
      const events = Array.from(yield* Stream.runCollect(Transcription.stream(request)))

      const upload = uploads[0]
      expect([upload.url, upload.authorization]).toEqual(["https://api.xai.test/v1/stt", "Bearer test"])
      expect(Array.from(upload.form.keys())).toEqual([
        "model",
        "language",
        "diarize",
        "format",
        "keyterm",
        "keyterm",
        "filler_words",
        "vad_threshold",
        "file",
      ])
      expect(upload.form.get("model")).toBe("grok-voice-transcribe-2.0")
      expect(upload.form.get("language")).toBe("en")
      expect(upload.form.get("diarize")).toBe("true")
      expect(upload.form.get("format")).toBe("true")
      expect(upload.form.getAll("keyterm")).toEqual(["OpenCode", "Grok"])
      expect(upload.form.get("filler_words")).toBe("false")
      expect(upload.form.get("vad_threshold")).toBe("0.3")
      const file = upload.form.get("file")
      if (!(file instanceof File)) throw new Error("Expected a file upload")
      expect([file.name, file.type]).toEqual(["audio.mp3", "audio/mpeg"])
      expect(new Uint8Array(yield* Effect.promise(() => file.arrayBuffer()))).toEqual(yield* audio.bytes())

      expect(response.text).toBe("Did it ship? Yes.")
      expect(response.words).toEqual([
        { text: "Did", startSeconds: 0.2, endSeconds: 0.4, speaker: "0", confidence: 0.9 },
        { text: "it", startSeconds: 0.4, endSeconds: 0.5, speaker: "0", confidence: undefined },
        { text: "ship?", startSeconds: 0.5, endSeconds: 0.9, speaker: "0", confidence: undefined },
        { text: "Yes.", startSeconds: 1.2, endSeconds: 1.6, speaker: "1", confidence: 0.8 },
      ])
      expect(response.segments).toEqual([
        { text: "Did it ship?", startSeconds: 0.2, endSeconds: 0.9, speaker: "0" },
        { text: "Yes.", startSeconds: 1.2, endSeconds: 1.6, speaker: "1" },
      ])
      expect(response).toMatchObject({
        language: "en",
        durationSeconds: 1.75,
        usage: { type: "seconds", seconds: 1.75 },
      })
      expect(events.map((event) => event.type)).toEqual(["finish"])
    }).pipe(
      Effect.provide(
        respondTranscript(uploads, {
          text: "Did it ship? Yes.",
          language: "EN",
          duration: 1.75,
          words: [
            { text: "Did", start: 0.2, end: 0.4, confidence: 0.9, speaker: 0 },
            { text: "it", start: 0.4, end: 0.5, speaker: 0 },
            { text: "ship?", start: 0.5, end: 0.9, speaker: 0 },
            { text: "Yes.", start: 1.2, end: 1.6, confidence: 0.8, speaker: 1 },
          ],
        }),
      ),
    )
  })

  it.effect("sends remote audio by URL and describes headerless PCM uploads", () => {
    const uploads: Array<Upload> = []
    return Effect.gen(function* () {
      const remote = yield* Transcription.generate({
        model,
        audio: Media.url("https://cdn.test/call.mp3", { mediaType: "audio/mpeg" }),
        timestamps: "segment",
      })
      const pcm = yield* Transcription.generate({
        model,
        audio: Media.bytes(Uint8Array.from([0, 1, 0, 1]), "audio/pcm", {
          info: { format: "pcm", encoding: "pcm_s16le", sampleRate: 16000, channels: 1 },
        }),
      })

      expect(Array.from(uploads[0].form.entries())).toEqual([
        ["model", "grok-voice-transcribe-2.0"],
        ["diarize", "true"],
        ["url", "https://cdn.test/call.mp3"],
      ])
      expect(Array.from(uploads[1].form.keys())).toEqual(["model", "audio_format", "sample_rate", "file"])
      expect(uploads[1].form.get("audio_format")).toBe("pcm")
      expect(uploads[1].form.get("sample_rate")).toBe("16000")
      expect(remote.segments).toBeUndefined()
      expect(pcm).toMatchObject({ text: "Hi", words: undefined, segments: undefined })
    }).pipe(Effect.provide(respondTranscript(uploads, { text: "Hi", language: "en", duration: 0.5 })))
  })

  it.effect("rejects what xAI cannot lower before sending anything", () =>
    Effect.gen(function* () {
      const errors = yield* Effect.all(
        [
          Transcription.generate({ model, audio, prompt: "OpenCode" }),
          Transcription.generate({ model, audio, speakers: 2 }),
          Transcription.start({ model, audio }),
          Transcription.generate({ model, audio: Media.ref("file_1", { provider: "xai", mediaType: "audio/mpeg" }) }),
        ].map((effect) => Effect.flip(effect)),
      )

      expect(errors.map((error) => [error.reason._tag, "operation" in error.reason && error.reason.operation])).toEqual(
        [
          ["UnsupportedOperation", "media.prompt"],
          ["UnsupportedOperation", "media.speakers"],
          ["UnsupportedOperation", "transcription.start"],
          ["InvalidRequest", false],
        ],
      )
      expect(errors[0].reason).toMatchObject({ provider: "xai", route: "xai-transcription" })
    }).pipe(Effect.provide(layer(() => Effect.die("an unsupported request reached the network")))),
  )

  it.effect("keeps the raw body when the transcript cannot be decoded", () => {
    const uploads: Array<Upload> = []
    return Effect.gen(function* () {
      const error = yield* Transcription.generate({ model, audio }).pipe(Effect.flip)

      expect(error.reason).toMatchObject({ _tag: "InvalidProviderOutput", body: JSON.stringify({ words: [] }) })
      expect(error.reason.http?.status).toBe(200)
    }).pipe(Effect.provide(respondTranscript(uploads, { words: [] })))
  })
})
