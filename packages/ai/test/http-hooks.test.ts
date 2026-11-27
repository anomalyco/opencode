import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { HttpClientResponse } from "effect/http"
import { AI, AIError, Media } from "../src/index.js"
import { RequestExecutor, type HttpMiddleware } from "../src/route.js"
import { AssemblyAI, OpenAI, XAI } from "../src/providers.js"
import { handlerLayer } from "./lib/http.js"

// Every Promise method that talks to a provider must send its requests through the caller's `http` middleware. The
// Promise client runs the Effect API under `RequestExecutor.withMiddleware`, so this covers the Effect side too.
// Adding a method to the client fails "lists every method" until it is listed here: as a provider call, with a way to
// call it, or as a local helper.

const openai = OpenAI.openai.with({ apiKey: "test", baseURL: "https://openai.test/v1" })
const openaiMedia = OpenAI.media({ apiKey: "test", baseURL: "https://openai.test/v1" })
const video = XAI.media({ apiKey: "test", baseURL: "https://xai.test/v1" }).video("grok-imagine-video-1.5")
const transcription = AssemblyAI.configure({ apiKey: "test", baseURL: "https://assemblyai.test" }).transcription(
  "universal-2",
)
const audio = Media.bytes(Uint8Array.from([0x49, 0x44, 0x33, 1, 2, 3]), "audio/mpeg")
const image = openaiMedia.image("gpt-image-2")
const chat = { model: openai.model("gpt-4o-mini", { api: "chat-completions" }), prompt: "Hello" }

type Client = ReturnType<typeof AI.make>
type Call = (ai: Client, http: HttpMiddleware) => Promise<unknown> | AsyncIterable<unknown>

const providerCalls: Record<string, Call> = {
  generate: (ai, http) => ai.generate(chat, { http }),
  stream: (ai, http) => ai.stream(chat, { http }),
  loop: (ai, http) => ai.loop(chat, { http }),
  compact: (ai, http) => ai.compact(ai.request({ model: openai.model("gpt-5"), prompt: "Hello" }), { http }),
  "image.generate": (ai, http) => ai.image.generate({ model: image, prompt: "A lighthouse" }, { http }),
  "image.stream": (ai, http) => ai.image.stream({ model: image, prompt: "A lighthouse" }, { http }),
  "image.start": (ai, http) => ai.image.start({ model: image, prompt: "A lighthouse" }, { http }),
  "image.status": (ai, http) => ai.image.status(image, "job", { http }),
  "image.result": (ai, http) => ai.image.result(image, "job", { http }),
  "image.cancel": (ai, http) => ai.image.cancel(image, "job", { http }),
  "decision.generate": (ai, http) =>
    ai.decision.generate(
      {
        model: openaiMedia.decision("gpt-6-luna"),
        input: "Is this a greeting? hello",
        questions: [{ name: "greeting", type: "choice", instructions: "Greeting?", choices: [{ value: true }] }],
      },
      { http },
    ),
  "embedding.generate": (ai, http) =>
    ai.embedding.generate({ model: openaiMedia.embedding("text-embedding-3-small"), values: ["hello"] }, { http }),
  "video.start": (ai, http) => ai.video.start({ model: video, prompt: "A balloon" }, { http }),
  "video.status": (ai, http) => ai.video.status(video, "job", { http }),
  "video.result": (ai, http) => ai.video.result(video, "job", { http }),
  "video.cancel": (ai, http) => ai.video.cancel(video, "job", { http }),
  "experimental.speech.generate": (ai, http) =>
    ai.experimental.speech.generate({ model: openaiMedia.speech("gpt-4o-mini-tts"), text: "Hello" }, { http }),
  "experimental.speech.stream": (ai, http) =>
    ai.experimental.speech.stream({ model: openaiMedia.speech("gpt-4o-mini-tts"), text: "Hello" }, { http }),
  "experimental.transcription.generate": (ai, http) =>
    ai.experimental.transcription.generate({ model: transcription, audio }, { http }),
  "experimental.transcription.stream": (ai, http) =>
    ai.experimental.transcription.stream({ model: transcription, audio }, { http }),
  "experimental.transcription.start": (ai, http) =>
    ai.experimental.transcription.start({ model: transcription, audio }, { http }),
  "experimental.transcription.resume": (ai, http) =>
    ai.experimental.transcription.resume(transcription, { transcriptID: "tr_1" }, { http }),
}

// No provider request of their own: request builders, local folds and asset helpers. Downloads use the asset's own
// `middleware` instead (see `Media.Asset`).
const local = [
  "run",
  "bytes",
  "base64",
  "materialize",
  "file",
  "write",
  "request",
  "collect",
  "canCompact",
  "image.request",
  "decision.request",
  "embedding.request",
  "video.request",
  "experimental.speech.request",
  "experimental.transcription.request",
  "dispose",
]

const methods = (value: object, prefix = ""): Array<string> =>
  Object.entries(value).flatMap(([key, entry]) => {
    if (typeof entry === "function") return [`${prefix}${key}`]
    if (typeof entry === "object" && entry !== null) return methods(entry, `${prefix}${key}.`)
    return []
  })

const settle = async (result: Promise<unknown> | AsyncIterable<unknown>) => {
  if (Symbol.asyncIterator in result) {
    for await (const _ of result) break
    return
  }
  await result
}

describe("http middleware", () => {
  test("lists every method", () => {
    const ai = AI.make()
    expect(methods(ai).toSorted()).toEqual([...Object.keys(providerCalls), ...local].toSorted())
  })

  for (const [name, call] of Object.entries(providerCalls))
    test(`${name} sends its requests through the caller's http`, async () => {
      const hooked: Array<string> = []
      const unhooked: Array<string> = []
      const ai = AI.make({
        layer: RequestExecutor.layer.pipe(
          Layer.provide(
            handlerLayer((input) =>
              Effect.sync(() => unhooked.push(input.request.url)).pipe(Effect.andThen(Effect.die("unhooked request"))),
            ),
          ),
        ),
      })
      // Answers 400 so the call stops at once: a transport failure would be retried.
      const http: HttpMiddleware = (request) =>
        Effect.sync(() => {
          hooked.push(request.url)
          return HttpClientResponse.fromWeb(request, new Response("{}", { status: 400 }))
        })
      const error = await settle(call(ai, http)).then(
        () => undefined,
        (error: unknown) => error,
      )
      await ai.dispose()
      expect(unhooked).toEqual([])
      // A route that can't do the operation (no queued image route ships, xAI can't cancel) fails before any request.
      if (error instanceof AIError && error.reason._tag === "UnsupportedOperation") return
      expect(hooked.length).toBeGreaterThan(0)
    })
})
