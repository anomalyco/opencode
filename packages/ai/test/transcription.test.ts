import { describe, expect } from "bun:test"
import { Effect, Fiber, Layer, Stream } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { HttpClientRequest } from "effect/unstable/http"
import { Media, Transcription, TranscriptionClient } from "../src/index.js"
import { AssemblyAI, Deepgram, Google, OpenAI } from "../src/providers.js"
import { it } from "./lib/effect.js"
import { dynamicResponse, json, observe, type Call } from "./lib/http.js"

const layer = (handler: Parameters<typeof dynamicResponse>[0]) =>
  TranscriptionClient.layer.pipe(Layer.provideMerge(dynamicResponse(handler)))

const audio = Media.bytes(Uint8Array.from([0x49, 0x44, 0x33, 1, 2, 3]), "audio/mpeg")
const openai = OpenAI.configure({ apiKey: "test", baseURL: "https://openai.test/v1" })
const deepgram = Deepgram.configure({ apiKey: "test", baseURL: "https://deepgram.test" }).transcription("nova-3")
const google = Google.configure({ apiKey: "test", baseURL: "https://google.test/v1beta" }).transcription(
  "gemini-3.5-transcribe",
)
const assemblyai = AssemblyAI.configure({ apiKey: "aai-key", baseURL: "https://assemblyai.test" }).transcription(
  "universal-3-5-pro",
)

describe("Transcription", () => {
  it.effect("rejects what a route cannot honor before sending anything", () =>
    Effect.gen(function* () {
      const errors = yield* Effect.all(
        [
          Transcription.generate({ model: openai.transcription("gpt-4o-mini-transcribe"), audio, diarize: true }),
          Transcription.generate({ model: openai.transcription("gpt-4o-mini-transcribe"), audio, timestamps: "word" }),
          Transcription.generate({ model: openai.transcription("gpt-4o-transcribe-diarize"), audio, prompt: "Names" }),
          Transcription.generate({ model: deepgram, audio, prompt: "OpenCode" }),
          Transcription.generate({ model: google, audio, speakers: 2 }),
          Transcription.start({ model: deepgram, audio }),
          Transcription.generate({ model: deepgram, audio, http: { body: { callback: "https://hook.test" } } }),
          Transcription.generate({
            model: openai.transcription("gpt-transcribe"),
            audio: Media.url("https://a.test/x.mp3"),
          }),
          Transcription.start({
            model: assemblyai,
            audio: Media.ref("file_1", { provider: "openai", mediaType: "audio/mpeg" }),
          }),
          Transcription.generate({
            model: openai.transcription("gpt-transcribe"),
            audio: Media.bytes(Uint8Array.from([1, 2, 3]), "audio/x-unknown"),
          }),
          Transcription.generate({
            model: Google.configure({ apiKey: "test" }).transcription("gemini-3.6-flash"),
            audio,
          }),
        ].map((effect) => Effect.flip(effect)),
      )
      expect(errors.map((error) => [error.reason._tag, "operation" in error.reason && error.reason.operation])).toEqual(
        [
          ["UnsupportedOperation", "media.diarize"],
          ["UnsupportedOperation", "media.timestamps"],
          ["UnsupportedOperation", "media.prompt"],
          ["UnsupportedOperation", "media.prompt"],
          ["UnsupportedOperation", "media.speakers"],
          ["UnsupportedOperation", "transcription.start"],
          ["InvalidRequest", false],
          ["InvalidRequest", false],
          ["InvalidRequest", false],
          ["InvalidRequest", false],
          ["UnsupportedOperation", "transcription.model"],
        ],
      )
    }).pipe(Effect.provide(layer(() => Effect.die("an unsupported request reached the network")))),
  )

  it.effect("ignores unknown OpenAI stream events and fails on an error event with the frame", () =>
    Effect.gen(function* () {
      const sse = (...frames: ReadonlyArray<string>) => frames.map((frame) => `data: ${frame}\n\n`).join("")
      const failure = `{"type":"error","error":{"type":"server_error","code":"server_error","message":"The server had an error"}}`
      const bodies = [
        sse(
          `{"type":"transcript.text.delta","delta":"Hi"}`,
          `{"type":"transcript.text.future","payload":1}`,
          `{"type":"transcript.text.done","text":"Hi"}`,
          "[DONE]",
        ),
        sse(`{"type":"transcript.text.delta","delta":"Hi"}`, failure),
      ]
      const model = openai.transcription("gpt-4o-mini-transcribe")
      const program = Effect.gen(function* () {
        const events = Array.from(yield* Stream.runCollect(Transcription.stream({ model, audio })))
        const error = yield* Stream.runCollect(Transcription.stream({ model, audio })).pipe(Effect.flip)
        return { events, error }
      })
      const { events, error } = yield* program.pipe(
        Effect.provide(
          layer((input) =>
            Effect.sync(() =>
              input.respond(bodies.shift() ?? "", { headers: { "content-type": "text/event-stream" } }),
            ),
          ),
        ),
      )

      expect(events.map((event) => event.type)).toEqual(["text-delta", "finish"])
      expect(error.reason).toMatchObject({ _tag: "ProviderInternal", body: failure })
      expect(error.message).toContain("The server had an error")
    }),
  )

  it.effect("streams whisper-1 as a single finish from a plain request", () =>
    Effect.gen(function* () {
      const bodies: Array<string> = []
      const events = Array.from(
        yield* Stream.runCollect(Transcription.stream({ model: openai.transcription("whisper-1"), audio })).pipe(
          Effect.provide(
            layer((input) =>
              Effect.sync(() => {
                bodies.push(input.text)
                return input.respond(
                  JSON.stringify({ text: "Hello there.", usage: { type: "duration", seconds: 2 } }),
                  { headers: { "content-type": "application/json" } },
                )
              }),
            ),
          ),
        ),
      )

      expect(bodies[0]).not.toContain('name="stream"')
      expect(events).toEqual([
        expect.objectContaining({ type: "finish", text: "Hello there.", usage: { type: "seconds", seconds: 2 } }),
      ])
    }),
  )

  it.effect(
    "uploads inline audio to AssemblyAI, resumes polling from a persisted token, and surfaces failed transcripts",
    () =>
      Effect.gen(function* () {
        const calls: Array<{
          readonly method: string
          readonly url: string
          readonly auth: string | null
          readonly body: string
        }> = []
        const json = (value: unknown) => ({
          body: JSON.stringify(value),
          init: { headers: { "content-type": "application/json" } },
        })
        const polls = () => calls.filter((call) => call.url.endsWith("/tr_1")).length
        const failed = JSON.stringify({ id: "tr_2", status: "error", error: "Audio file could not be decoded" })
        const program = Effect.gen(function* () {
          const started = yield* Transcription.start({ model: assemblyai, audio, diarize: true, speakers: 2 })
          expect(started.status).toBe("queued")
          const resumed = yield* Transcription.resume(assemblyai, JSON.parse(JSON.stringify(started.token)))
          const response = yield* resumed.await({ poll: { interval: "1 second" } })
          const failure = yield* Transcription.resume(assemblyai, { transcriptID: "tr_2" }).pipe(
            Effect.flatMap((generation) => generation.await()),
            Effect.flip,
          )
          return { response, failure }
        }).pipe(
          Effect.provide(
            layer((input) =>
              Effect.gen(function* () {
                const web = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
                calls.push({
                  method: web.method,
                  url: web.url,
                  auth: web.headers.get("authorization"),
                  body: input.text,
                })
                if (web.url.endsWith("/tr_2"))
                  return input.respond(failed, { headers: { "content-type": "application/json" } })
                const reply = web.url.endsWith("/v2/upload")
                  ? json({ upload_url: "https://cdn.assemblyai.test/upload/1" })
                  : web.method === "POST"
                    ? json({ id: "tr_1", status: "queued" })
                    : polls() < 3
                      ? json({ id: "tr_1", status: "processing" })
                      : json({
                          id: "tr_1",
                          status: "completed",
                          text: "Hello there.",
                          words: [
                            { text: "Hello", start: 250, end: 700, confidence: 0.9, speaker: "A" },
                            { text: "there.", start: 700, end: 1250, confidence: 0.8, speaker: "B" },
                          ],
                          utterances: [
                            { text: "Hello", start: 250, end: 700, speaker: "A" },
                            { text: "there.", start: 700, end: 1250, speaker: "B" },
                          ],
                          language_code: "en_us",
                          audio_duration: 2,
                        })
                return input.respond(reply.body, reply.init)
              }),
            ),
          ),
        )

        const fiber = yield* Effect.forkChild(program)
        yield* TestClock.adjust("5 seconds")
        const { response, failure } = yield* Fiber.join(fiber)

        expect(calls.slice(0, 2).map((call) => [call.method, call.url, call.auth])).toEqual([
          ["POST", "https://assemblyai.test/v2/upload", "aai-key"],
          ["POST", "https://assemblyai.test/v2/transcript", "aai-key"],
        ])
        expect(JSON.parse(calls[1].body)).toEqual({
          audio_url: "https://cdn.assemblyai.test/upload/1",
          speech_models: ["universal-3-5-pro"],
          language_detection: true,
          speaker_labels: true,
          speakers_expected: 2,
        })
        expect(calls[2].url).toBe("https://assemblyai.test/v2/transcript/tr_1")
        expect(response.segments).toEqual([
          { text: "Hello", startSeconds: 0.25, endSeconds: 0.7, speaker: "A" },
          { text: "there.", startSeconds: 0.7, endSeconds: 1.25, speaker: "B" },
        ])
        expect(response.words?.[1]).toEqual({
          text: "there.",
          startSeconds: 0.7,
          endSeconds: 1.25,
          speaker: "B",
          confidence: 0.8,
        })
        expect(response).toMatchObject({
          text: "Hello there.",
          language: "en_us",
          usage: { type: "seconds", seconds: 2 },
        })
        expect(failure.reason).toMatchObject({ _tag: "ProviderInternal", body: failed })
      }),
  )

  it.effect("enables AssemblyAI speaker labels when only an expected speaker count is given", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      yield* Transcription.start({ model: assemblyai, audio: Media.url("https://a.test/call.mp3"), speakers: 2 }).pipe(
        Effect.provide(
          layer((input) => observe(calls, input).pipe(Effect.as(json(input, { id: "tr_1", status: "queued" })))),
        ),
      )
      expect(calls.map((call) => JSON.parse(call.body))).toEqual([
        {
          audio_url: "https://a.test/call.mp3",
          speech_models: ["universal-3-5-pro"],
          language_detection: true,
          speaker_labels: true,
          speakers_expected: 2,
        },
      ])
    }),
  )

  it.effect("rejects reading an AssemblyAI result before the transcript finishes", () =>
    Effect.gen(function* () {
      const generation = yield* Transcription.resume(assemblyai, { transcriptID: "tr_1" })
      const error = yield* generation.result().pipe(Effect.flip)
      expect(error.reason._tag).toBe("InvalidRequest")
      expect(error.message).toBe("AssemblyAI generation tr_1 has not finished; await it before reading the result")
      expect(error.reason.body).toBe(JSON.stringify({ id: "tr_1", status: "processing" }))
      expect(error.reason.http?.status).toBe(200)
    }).pipe(
      Effect.provide(
        layer((input) =>
          Effect.succeed(
            input.respond(JSON.stringify({ id: "tr_1", status: "processing" }), {
              headers: { "content-type": "application/json" },
            }),
          ),
        ),
      ),
    ),
  )
})
