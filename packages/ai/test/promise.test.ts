import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Layer } from "effect"
import { HttpClientRequest } from "effect/unstable/http"
import { AIError, LLMEvent, Media, SpeechEvent, TranscriptionEvent } from "../src/index.js"
import { RequestExecutor } from "../src/route.js"
import { AI } from "../src/promise.js"
import { AssemblyAI, OpenAI, Replicate, Runway } from "../src/providers.js"
import { handlerLayer, json } from "./lib/http.js"
import { sseEvents } from "./lib/sse.js"

const openai = OpenAI.configure({ apiKey: "test", baseURL: "https://openai.test/v1" })

const chatBody = sseEvents(
  { choices: [{ delta: { content: "Hello" } }] },
  { choices: [{ delta: { content: " world" } }] },
  { choices: [{ delta: {}, finish_reason: "stop" }] },
)

/**
 * Executor layer that answers chat completions with SSE text, image generations with one base64 PNG, Runway video
 * tasks with a queued submission that succeeds on the second poll, speech with raw audio or SSE audio deltas, OpenAI
 * transcription with JSON or SSE text deltas, and AssemblyAI transcripts that complete on the first poll.
 */
const executor = (seen: Array<string>) =>
  RequestExecutor.layer.pipe(
    Layer.provide(
      handlerLayer((input) =>
        Effect.gen(function* () {
          const web = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
          seen.push(web.url)
          if (web.url.endsWith("/images/generations"))
            return JSON.parse(input.text).stream === true
              ? input.respond(
                  sseEvents(
                    {
                      type: "image_generation.partial_image",
                      b64_json: "AQ==",
                      partial_image_index: 0,
                      output_format: "png",
                    },
                    { type: "image_generation.completed", b64_json: "AQID", output_format: "png" },
                  ),
                  { headers: { "content-type": "text/event-stream" } },
                )
              : input.respond(JSON.stringify({ data: [{ b64_json: "AQID" }], output_format: "png" }), {
                  headers: { "content-type": "application/json" },
                })
          if (web.url.startsWith("https://replicate.test"))
            return json(input, {
              id: "p_1",
              status: "succeeded",
              output: "https://replicate.test/a.webp",
              urls: { get: "https://replicate.test/p_1", cancel: "https://replicate.test/p_1/cancel" },
            })
          if (web.url.endsWith("/chat/completions"))
            return input.respond(chatBody, { headers: { "content-type": "text/event-stream" } })
          if (web.url.endsWith("/audio/speech"))
            return JSON.parse(input.text).stream_format === "sse"
              ? input.respond(
                  sseEvents(
                    { type: "speech.audio.delta", audio: "AQI=" },
                    { type: "speech.audio.delta", audio: "Aw==" },
                    { type: "speech.audio.done", usage: { input_tokens: 4, output_tokens: 8, total_tokens: 12 } },
                  ),
                  { headers: { "content-type": "text/event-stream" } },
                )
              : input.respond(Uint8Array.from([1, 2, 3]), { headers: { "content-type": "audio/pcm" } })
          if (web.url.endsWith("/audio/transcriptions"))
            return input.text.includes('name="stream"')
              ? input.respond(
                  sseEvents(
                    { type: "transcript.text.delta", delta: "Hello" },
                    { type: "transcript.text.delta", delta: " there." },
                    { type: "transcript.text.done", text: "Hello there." },
                  ),
                  { headers: { "content-type": "text/event-stream" } },
                )
              : input.respond(JSON.stringify({ text: "Hello there." }), {
                  headers: { "content-type": "application/json" },
                })
          if (web.url.endsWith("/v2/transcript"))
            return input.respond(JSON.stringify({ id: "tr_1", status: "queued" }), {
              headers: { "content-type": "application/json" },
            })
          if (web.url.endsWith("/v2/transcript/tr_1"))
            return input.respond(JSON.stringify({ id: "tr_1", status: "completed", text: "Hello there." }), {
              headers: { "content-type": "application/json" },
            })
          if (web.url.endsWith("/text_to_video"))
            return input.respond(JSON.stringify({ id: "task_1" }), { headers: { "content-type": "application/json" } })
          if (web.url.endsWith("/tasks/task_1")) {
            const polls = seen.filter((url) => url.endsWith("/tasks/task_1")).length
            return input.respond(
              JSON.stringify(
                polls === 1
                  ? { status: "RUNNING", progress: 0.5 }
                  : { status: "SUCCEEDED", output: ["https://runway.test/out.mp4"], cost: { credits: 5 } },
              ),
              { headers: { "content-type": "application/json" } },
            )
          }
          return input.respond(JSON.stringify({ error: { message: "not found" } }), {
            status: 404,
            headers: { "content-type": "application/json" },
          })
        }),
      ),
    ),
  )

describe("AI promise client", () => {
  test("generates text, images, and streams over one managed runtime, and queues images", async () => {
    const seen: Array<string> = []
    const ai = AI.make({ layer: executor(seen) })

    const request = ai.llm.request({ model: openai.chat("gpt-4o-mini"), prompt: "Say hello." })
    const text = await ai.llm.generate(request)
    expect(text.text).toBe("Hello world")
    expect((await ai.llm.generate({ model: openai.chat("gpt-4o-mini"), prompt: "Say hello." })).text).toBe(
      "Hello world",
    )

    const image = await ai.image.generate({ model: openai.image("gpt-image-2"), prompt: "A lighthouse" })
    expect(image.image).toBeInstanceOf(Media.Asset)
    expect(image.image.mediaType).toBe("image/png")
    expect(await ai.run(image.image.bytes())).toEqual(Uint8Array.from([1, 2, 3]))
    const requested = await ai.image.generate(
      ai.image.request({ model: openai.image("gpt-image-2"), prompt: "A lighthouse" }),
    )
    expect(requested.image.mediaType).toBe("image/png")

    const deltas: Array<string> = []
    for await (const event of ai.llm.stream(request)) {
      if (LLMEvent.is.textDelta(event)) deltas.push(event.text)
    }
    expect(deltas).toEqual(["Hello", " world"])
    const directDeltas: Array<string> = []
    for await (const event of ai.llm.stream({ model: openai.chat("gpt-4o-mini"), prompt: "Say hello." })) {
      if (LLMEvent.is.textDelta(event)) directDeltas.push(event.text)
    }
    expect(directDeltas).toEqual(deltas)

    const imageEvents: Array<string> = []
    for await (const event of ai.image.stream({ model: openai.image("gpt-image-2"), prompt: "A lighthouse" })) {
      imageEvents.push(event.type)
    }
    expect(imageEvents).toEqual(["image-partial", "image", "finish"])

    expect(seen).toEqual([
      "https://openai.test/v1/chat/completions",
      "https://openai.test/v1/chat/completions",
      "https://openai.test/v1/images/generations",
      "https://openai.test/v1/images/generations",
      "https://openai.test/v1/chat/completions",
      "https://openai.test/v1/chat/completions",
      "https://openai.test/v1/images/generations",
    ])

    const generation = await ai.image.start({
      model: Replicate.configure({ apiKey: "test", baseURL: "https://replicate.test" }).image("owner/model"),
      prompt: "A lighthouse",
    })
    expect((await generation.await()).image.source).toMatchObject({ url: "https://replicate.test/a.webp" })
    await ai.dispose()
  })

  test("starts, awaits, and resumes video generations over the same runtime", async () => {
    const seen: Array<string> = []
    const ai = AI.make({ layer: executor(seen) })
    const model = Runway.configure({ apiKey: "test", baseURL: "https://runway.test/v1" }).video("gen4.5")

    const generation = await ai.video.start({ model, prompt: "A kite" })
    expect(generation.id).toBe("task_1")
    expect(generation.status).toBe("queued")
    expect(generation.token).toEqual({ taskID: "task_1" })

    const refreshed = await generation.refresh()
    expect(refreshed.status).toBe("running")
    expect(refreshed.progress).toBe(0.5)

    const response = await refreshed.await({ poll: { interval: 10 } })
    expect(response.video).toBeInstanceOf(Media.Asset)
    expect(response.video.source).toMatchObject({ type: "url", url: "https://runway.test/out.mp4" })
    expect(response.usage).toEqual({ type: "credits", credits: 5 })

    const resumed = await ai.video.resume(model, JSON.parse(JSON.stringify(generation.token)))
    expect(resumed.status).toBe("completed")
    expect((await resumed.await()).videos).toHaveLength(1)

    const events: Array<string> = []
    for await (const event of ai.video.stream({ model, prompt: "A kite" }, { poll: { interval: 10 } })) {
      events.push(event.type)
    }
    expect(events).toEqual(["video", "finish"])

    expect(seen[0]).toBe("https://runway.test/v1/text_to_video")
    expect(seen.filter((url) => url.endsWith("/tasks/task_1")).length).toBeGreaterThanOrEqual(5)
    await ai.dispose()
  })

  test("observes a started generation's events and fetches its result", async () => {
    const ai = AI.make({ layer: executor([]) })
    const model = Runway.configure({ apiKey: "test", baseURL: "https://runway.test/v1" }).video("gen4.5")
    const generation = await ai.video.start({ model, prompt: "A kite" })

    const events: Array<string> = []
    for await (const event of generation.events({ poll: { interval: 10 } })) events.push(event.type)
    expect(events).toEqual(["generation-progress", "generation-finished"])
    expect(generation.status).toBe("queued")
    expect((await generation.result()).video.source).toMatchObject({ url: "https://runway.test/out.mp4" })
    await ai.dispose()
  })

  test("reads, writes, and decodes assets without leaving promises", async () => {
    const ai = AI.make({ layer: executor([]) })
    const dir = await mkdtemp(join(tmpdir(), "ai-promise-"))
    try {
      const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
      await Bun.write(join(dir, "source.bin"), png)

      const asset = await ai.file(join(dir, "source.bin"))
      expect(asset.mediaType).toBe("image/png")
      await ai.write(asset, join(dir, "copy.png"))
      expect(await ai.bytes(await ai.file(join(dir, "copy.png")))).toEqual(png)
    } finally {
      await rm(dir, { recursive: true })
      await ai.dispose()
    }
  })

  test("generates, streams, and starts transcriptions over the same runtime", async () => {
    const ai = AI.make({ layer: executor([]) })
    const audio = Media.url("https://audio.test/hello.mp3")
    const bytes = Media.bytes(Uint8Array.from([0x49, 0x44, 0x33]), "audio/mpeg")

    expect(
      (await ai.transcription.generate({ model: openai.transcription("gpt-4o-mini-transcribe"), audio: bytes })).text,
    ).toBe("Hello there.")

    const deltas: Array<string> = []
    for await (const event of ai.transcription.stream({
      model: openai.transcription("gpt-4o-mini-transcribe"),
      audio: bytes,
    }))
      if (TranscriptionEvent.is.textDelta(event)) deltas.push(event.delta)
    expect(deltas).toEqual(["Hello", " there."])

    const model = AssemblyAI.configure({ apiKey: "test", baseURL: "https://assemblyai.test" }).transcription(
      "universal-2",
    )
    const generation = await ai.transcription.start({ model, audio })
    expect(generation.token).toEqual({ transcriptID: "tr_1" })
    expect((await generation.await({ poll: { interval: 10 } })).text).toBe("Hello there.")
    await ai.dispose()
  })

  test("generates and streams speech over the same runtime", async () => {
    const ai = AI.make({ layer: executor([]) })
    const model = openai.speech("gpt-4o-mini-tts")

    const response = await ai.speech.generate({ model, text: "Hello", voice: "coral", format: "pcm" })
    expect(await ai.run(response.audio.bytes())).toEqual(Uint8Array.from([1, 2, 3]))

    const events: Array<SpeechEvent> = []
    for await (const event of ai.speech.stream({ model, text: "Hello", voice: "coral" })) events.push(event)
    expect(events.map((event) => event.type)).toEqual(["audio-delta", "audio-delta", "finish"])
    const finish = events.find(SpeechEvent.is.finish)
    expect(await ai.run(finish!.audio.bytes())).toEqual(Uint8Array.from([1, 2, 3]))
    await ai.dispose()
  })

  test("rethrows AIError unchanged and honors abort signals", async () => {
    const ai = AI.make({ layer: executor([]) })

    const failure = await ai.llm
      .generate(ai.llm.request({ model: openai.responses("gpt-5"), prompt: "Hello" }))
      .then(() => undefined)
      .catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(AIError)
    expect(failure instanceof AIError && failure.reason.http?.status).toBe(404)

    const invalidLLM = await ai.llm
      // @ts-expect-error Invalid input must reject with AIError instead of throwing synchronously.
      .generate({ model: openai.responses("gpt-5"), messages: [{ role: "bogus" }] })
      .catch((error: unknown) => error)
    expect(invalidLLM instanceof AIError && invalidLLM.reason._tag).toBe("InvalidRequest")

    const invalid = await ai.image
      .generate({ model: openai.image("gpt-image-2"), prompt: "A lighthouse", n: 1.5 })
      .catch((error: unknown) => error)
    expect(invalid instanceof AIError && invalid.reason._tag).toBe("InvalidRequest")

    const controller = new AbortController()
    controller.abort()
    const aborted = await ai.llm
      .generate(ai.llm.request({ model: openai.chat("gpt-4o-mini"), prompt: "Hello" }), { signal: controller.signal })
      .then(() => "completed")
      .catch(() => "aborted")
    expect(aborted).toBe("aborted")

    await ai.dispose()
  })

  test("the default client is created lazily and can be disposed", async () => {
    expect(typeof AI.ai.llm.generate).toBe("function")
    expect(typeof AI.ai.image.generate).toBe("function")
    expect(typeof AI.ai.video.start).toBe("function")
    expect(typeof AI.ai.speech.generate).toBe("function")
    await AI.ai.dispose()
  })
})
