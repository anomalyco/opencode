import { describe, expect } from "bun:test"
import { Effect, Fiber, Layer, Stream } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { HttpClientRequest } from "effect/unstable/http"
import { Media, Transcription, TranscriptionClient, type TranscriptionEvent } from "../src/index.js"
import { AssemblyAI, Deepgram, ElevenLabs, Google, OpenAI } from "../src/providers.js"
import { it } from "./lib/effect.js"
import { dynamicResponse, json, observe, type Call } from "./lib/http.js"
import { sseEvents } from "./lib/sse.js"

const layer = (handler: Parameters<typeof dynamicResponse>[0]) =>
  TranscriptionClient.layer.pipe(Layer.provideMerge(dynamicResponse(handler)))

const audio = Media.bytes(Uint8Array.from([0x49, 0x44, 0x33, 1, 2, 3]), "audio/mpeg")
const openai = OpenAI.configure({ apiKey: "test", baseURL: "https://openai.test/v1" })
const deepgram = Deepgram.configure({ apiKey: "test", baseURL: "https://deepgram.test" }).transcription("nova-3")
const google = Google.configure({ apiKey: "test", baseURL: "https://google.test/v1beta" }).transcription(
  "gemini-3.5-transcribe",
)
/**
 * Multipart fields of a recorded request, with repeated names collected in order. The boundary comes from the body:
 * each conversion of a FormData request to a web request picks a fresh one, so the recorded headers may not match.
 */
const formFields = (call: Call) =>
  Effect.promise(() =>
    new Response(call.body, {
      headers: { "content-type": `multipart/form-data; boundary=${call.body.slice(2, call.body.indexOf("\r\n"))}` },
    }).formData(),
  ).pipe(
    Effect.map((form) =>
      Object.fromEntries([...new Set(form.keys())].map((key) => [key, form.getAll(key).map((value) => String(value))])),
    ),
  )

const assemblyai = AssemblyAI.configure({ apiKey: "aai-key", baseURL: "https://assemblyai.test" }).transcription(
  "universal-3-5-pro",
)
const elevenlabs = ElevenLabs.configure({ apiKey: "test", baseURL: "https://elevenlabs.test" }).transcription(
  "scribe_v2",
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

  it.effect("streams diarized segments and finishes with the accumulated segments", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      const body = sseEvents(
        { type: "transcript.text.segment", id: "seg_0", text: " Hello", start: 0.25, end: 0.7, speaker: "A" },
        { type: "transcript.text.segment", id: "seg_1", text: " there.", start: 0.7, end: 1.25, speaker: "B" },
        { type: "transcript.text.done", text: "Hello there.", usage: { type: "duration", seconds: 2 } },
      )
      const events = Array.from(
        yield* Stream.runCollect(
          Transcription.stream({ model: openai.transcription("gpt-4o-transcribe-diarize"), audio, diarize: true }),
        ).pipe(
          Effect.provide(
            layer((input) =>
              observe(calls, input).pipe(
                Effect.as(input.respond(body, { headers: { "content-type": "text/event-stream" } })),
              ),
            ),
          ),
        ),
      )

      const form = yield* formFields(calls[0])
      expect(form).toMatchObject({
        model: ["gpt-4o-transcribe-diarize"],
        response_format: ["diarized_json"],
        chunking_strategy: ["auto"],
        stream: ["true"],
      })
      const segments = [
        { text: "Hello", startSeconds: 0.25, endSeconds: 0.7, speaker: "A" },
        { text: "there.", startSeconds: 0.7, endSeconds: 1.25, speaker: "B" },
      ]
      expect(events).toEqual([
        { type: "segment", segment: segments[0] },
        { type: "segment", segment: segments[1] },
        expect.objectContaining({
          type: "finish",
          text: "Hello there.",
          segments,
          usage: { type: "seconds", seconds: 2 },
        }),
      ])
    }),
  )

  it.effect("requests whisper-1 segment timestamps as verbose_json", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      const response = yield* Transcription.generate({
        model: openai.transcription("whisper-1"),
        audio,
        timestamps: "segment",
      }).pipe(
        Effect.provide(
          layer((input) =>
            observe(calls, input).pipe(
              Effect.as(
                json(input, {
                  text: "Hello there.",
                  language: "English",
                  duration: 1.25,
                  segments: [
                    { id: 0, text: " Hello", start: 0.25, end: 0.7 },
                    { id: 1, text: " there.", start: 0.7, end: 1.25 },
                  ],
                  usage: { type: "duration", seconds: 2 },
                }),
              ),
            ),
          ),
        ),
      )

      const form = yield* formFields(calls[0])
      expect(form).toMatchObject({
        model: ["whisper-1"],
        response_format: ["verbose_json"],
        "timestamp_granularities[]": ["segment"],
      })
      expect(form.stream).toBeUndefined()
      expect(response).toMatchObject({
        text: "Hello there.",
        segments: [
          { text: "Hello", startSeconds: 0.25, endSeconds: 0.7 },
          { text: "there.", startSeconds: 0.7, endSeconds: 1.25 },
        ],
        language: "english",
        durationSeconds: 1.25,
        usage: { type: "seconds", seconds: 2 },
      })
    }),
  )

  it.effect("fails an OpenAI stream that ends without transcript.text.done as incomplete", () =>
    Effect.gen(function* () {
      const events: Array<TranscriptionEvent> = []
      const error = yield* Transcription.stream({ model: openai.transcription("gpt-4o-mini-transcribe"), audio }).pipe(
        Stream.runForEach((event) => Effect.sync(() => events.push(event))),
        Effect.flip,
        Effect.provide(
          layer((input) =>
            Effect.succeed(
              input.respond(sseEvents({ type: "transcript.text.delta", delta: "Hel" }), {
                headers: { "content-type": "text/event-stream" },
              }),
            ),
          ),
        ),
      )

      expect(events).toEqual([{ type: "text-delta", delta: "Hel" }])
      expect(error.reason).toMatchObject({ _tag: "InvalidProviderOutput", classification: "incomplete-stream" })
      expect(error.reason.http?.status).toBe(200)
    }),
  )

  it.effect("sends a Deepgram URL source as a JSON body and repeats array query parameters", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      const response = yield* Transcription.generate({
        model: deepgram,
        audio: Media.url("https://a.test/call.mp3", { mediaType: "audio/mpeg" }),
        language: "en",
        providerOptions: { keyterm: ["OpenCode", "Effect"] },
      }).pipe(
        Effect.provide(
          layer((input) =>
            observe(calls, input).pipe(
              Effect.as(
                json(input, {
                  metadata: { request_id: "dg_1", duration: 2 },
                  results: { channels: [{ alternatives: [{ transcript: "Hello there." }] }] },
                }),
              ),
            ),
          ),
        ),
      )

      expect(calls).toHaveLength(1)
      const url = new URL(calls[0].url)
      expect(url.origin + url.pathname).toBe("https://deepgram.test/v1/listen")
      expect([...url.searchParams]).toEqual([
        ["model", "nova-3"],
        ["smart_format", "true"],
        ["language", "en"],
        ["keyterm", "OpenCode"],
        ["keyterm", "Effect"],
      ])
      expect(calls[0].headers.get("content-type")).toBe("application/json")
      expect(JSON.parse(calls[0].body)).toEqual({ url: "https://a.test/call.mp3" })
      expect(response).toMatchObject({
        text: "Hello there.",
        usage: { type: "seconds", seconds: 2 },
        providerMetadata: { deepgram: { requestId: "dg_1" } },
      })
    }),
  )

  it.effect("transcribes an AssemblyAI URL source without uploading it first", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      const response = yield* Transcription.generate({
        model: assemblyai,
        audio: Media.url("https://a.test/call.mp3", { mediaType: "audio/mpeg" }),
      }).pipe(
        Effect.provide(
          layer((input) =>
            Effect.gen(function* () {
              const { call } = yield* observe(calls, input)
              if (call.method === "POST") return json(input, { id: "tr_1", status: "queued" })
              return json(input, { id: "tr_1", status: "completed", text: "Hello there.", audio_duration: 2 })
            }),
          ),
        ),
      )

      expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
        "POST https://assemblyai.test/v2/transcript",
        "GET https://assemblyai.test/v2/transcript/tr_1",
        "GET https://assemblyai.test/v2/transcript/tr_1",
      ])
      expect(JSON.parse(calls[0].body)).toEqual({
        audio_url: "https://a.test/call.mp3",
        speech_models: ["universal-3-5-pro"],
        language_detection: true,
      })
      expect(response).toMatchObject({ text: "Hello there.", usage: { type: "seconds", seconds: 2 } })
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

  it.effect("rejects ElevenLabs prompts, webhooks, per-channel transcripts, and untimed diarization", () =>
    Effect.gen(function* () {
      const errors = yield* Effect.all(
        [
          Transcription.generate({ model: elevenlabs, audio, prompt: "OpenCode" }),
          Transcription.generate({ model: elevenlabs, audio, providerOptions: { webhook: true } }),
          Transcription.generate({ model: elevenlabs, audio, http: { body: { use_multi_channel: true } } }),
          Transcription.generate({
            model: elevenlabs,
            audio,
            diarize: true,
            providerOptions: { timestamps_granularity: "none" },
          }),
          Transcription.generate({
            model: elevenlabs,
            audio: Media.ref("file_1", { provider: "elevenlabs", mediaType: "audio/mpeg" }),
          }),
        ].map((effect) => Effect.flip(effect)),
      )
      expect(errors.map((error) => [error.reason._tag, "operation" in error.reason && error.reason.operation])).toEqual(
        [
          ["UnsupportedOperation", "media.prompt"],
          ["UnsupportedOperation", "transcription.webhook"],
          ["UnsupportedOperation", "transcription.multichannel"],
          ["UnsupportedOperation", "media.timestamps"],
          ["InvalidRequest", false],
        ],
      )
    }).pipe(Effect.provide(layer(() => Effect.die("an unsupported request reached the network")))),
  )

  it.effect("sends ElevenLabs URL audio as source_url and groups diarized words into speaker turns", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      const token = (text: string, type: string, start: number, end: number, speaker_id?: string) => ({
        text,
        type,
        start,
        end,
        speaker_id,
        logprob: 0,
      })
      const response = yield* Transcription.generate({
        model: elevenlabs,
        audio: Media.url("https://a.test/call.mp3"),
        language: "en",
        speakers: 2,
        providerOptions: { keyterms: ["OpenCode", "Scribe"], tag_audio_events: true, diarize: false },
      }).pipe(
        Effect.provide(
          layer((input) =>
            observe(calls, input).pipe(
              Effect.as(
                json(input, {
                  language_code: "ENG",
                  text: "Ready? (laughs) Yes. Go",
                  words: [
                    token("Ready?", "word", 0, 0.5, "speaker_0"),
                    token(" ", "spacing", 0.5, 0.6, "speaker_0"),
                    token("(laughs)", "audio_event", 0.6, 1, "speaker_0"),
                    token(" ", "spacing", 1, 1.1, "speaker_0"),
                    token("Yes.", "word", 1.2, 1.5, "speaker_1"),
                    token(" ", "spacing", 1.5, 1.6, "speaker_1"),
                    token("Go", "word", 1.6, 1.9, "speaker_0"),
                  ],
                  transcription_id: "tr_1",
                  audio_duration_secs: 2,
                }),
              ),
            ),
          ),
        ),
      )

      // `observe` re-encodes the FormData with a new boundary, so read the boundary from the sent body.
      const boundary = /^--(\S+)/.exec(calls[0].body)?.[1]
      const form = yield* Effect.promise(() =>
        new Response(calls[0].body, {
          headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
        }).formData(),
      )
      expect(calls[0].url).toBe("https://elevenlabs.test/v1/speech-to-text")
      expect(calls[0].headers.get("xi-api-key")).toBe("test")
      expect(Array.from(form.entries())).toEqual([
        ["model_id", "scribe_v2"],
        ["source_url", "https://a.test/call.mp3"],
        ["language_code", "en"],
        ["diarize", "true"],
        ["num_speakers", "2"],
        ["keyterms", "OpenCode"],
        ["keyterms", "Scribe"],
        ["tag_audio_events", "true"],
      ])
      expect(response.segments).toEqual([
        { text: "Ready?", startSeconds: 0, endSeconds: 0.5, speaker: "speaker_0" },
        { text: "Yes.", startSeconds: 1.2, endSeconds: 1.5, speaker: "speaker_1" },
        { text: "Go", startSeconds: 1.6, endSeconds: 1.9, speaker: "speaker_0" },
      ])
      expect(response.words?.map((word) => [word.text, word.speaker, word.confidence])).toEqual([
        ["Ready?", "speaker_0", 1],
        ["Yes.", "speaker_1", 1],
        ["Go", "speaker_0", 1],
      ])
      expect(response.language).toBe("eng")
      expect(response.usage).toEqual({ type: "seconds", seconds: 2 })
      expect(response.providerMetadata).toEqual({ elevenlabs: { transcriptionId: "tr_1" } })
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

  it.effect("surfaces Gemini transcripts that ended without STOP instead of returning them as complete", () =>
    Effect.gen(function* () {
      const document = (finishReason?: string) =>
        JSON.stringify({
          candidates: [{ content: { parts: [{ audioTranscription: { text: "Hello" } }] }, finishReason }],
        })
      const withheld = JSON.stringify({ candidates: [{ finishReason: "SAFETY" }] })
      const generate = (body: string) =>
        Transcription.generate({ model: google, audio }).pipe(
          Effect.provide(
            layer((input) => Effect.succeed(input.respond(body, { headers: { "content-type": "application/json" } }))),
          ),
        )

      const truncated = yield* generate(document()).pipe(Effect.flip)
      const partial = yield* generate(document("MAX_TOKENS"))
      const policy = yield* generate(withheld).pipe(Effect.flip)

      expect(truncated.reason).toMatchObject({ _tag: "InvalidProviderOutput", classification: "incomplete-stream" })
      expect(partial.text).toBe("Hello")
      expect(partial.notices).toEqual([
        {
          type: "other",
          message: "Google Transcription finished with MAX_TOKENS",
          providerMetadata: { google: { finishReason: "MAX_TOKENS" } },
        },
      ])
      expect(policy.reason).toMatchObject({ _tag: "ContentPolicy", body: withheld })
    }),
  )
})
