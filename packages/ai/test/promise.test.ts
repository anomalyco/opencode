import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { HttpClientRequest } from "effect/unstable/http"
import { AIError, LLMEvent, Media } from "../src/index.js"
import { RequestExecutor } from "../src/route.js"
import { AI } from "../src/promise.js"
import { OpenAI } from "../src/providers.js"
import { handlerLayer } from "./lib/http.js"
import { sseEvents } from "./lib/sse.js"

const openai = OpenAI.configure({ apiKey: "test", baseURL: "https://openai.test/v1" })

const chatBody = sseEvents(
  { choices: [{ delta: { content: "Hello" } }] },
  { choices: [{ delta: { content: " world" } }] },
  { choices: [{ delta: {}, finish_reason: "stop" }] },
)

/** Executor layer that answers chat completions with SSE text and image generations with one base64 PNG. */
const executor = (seen: Array<string>) =>
  RequestExecutor.layer.pipe(
    Layer.provide(
      handlerLayer((input) =>
        Effect.gen(function* () {
          const web = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
          seen.push(web.url)
          if (web.url.endsWith("/images/generations"))
            return input.respond(JSON.stringify({ data: [{ b64_json: "AQID" }], output_format: "png" }), {
              headers: { "content-type": "application/json" },
            })
          if (web.url.endsWith("/chat/completions"))
            return input.respond(chatBody, { headers: { "content-type": "text/event-stream" } })
          return input.respond(JSON.stringify({ error: { message: "not found" } }), {
            status: 404,
            headers: { "content-type": "application/json" },
          })
        }),
      ),
    ),
  )

describe("AI promise client", () => {
  test("generates text, images, and streams over one managed runtime", async () => {
    const seen: Array<string> = []
    const ai = AI.make({ layer: executor(seen) })

    const text = await ai.llm.generate({ model: openai.chat("gpt-4o-mini"), prompt: "Say hello." })
    expect(text.text).toBe("Hello world")

    const image = await ai.image.generate({ model: openai("gpt-image-2"), prompt: "A lighthouse" })
    expect(image.image).toBeInstanceOf(Media.Asset)
    expect(image.image.mediaType).toBe("image/png")
    expect(await ai.run(image.image.bytes())).toEqual(Uint8Array.from([1, 2, 3]))

    const deltas: Array<string> = []
    for await (const event of ai.llm.stream({ model: openai.chat("gpt-4o-mini"), prompt: "Say hello." })) {
      if (LLMEvent.is.textDelta(event)) deltas.push(event.text)
    }
    expect(deltas).toEqual(["Hello", " world"])

    const imageEvents: Array<string> = []
    for await (const event of ai.image.stream({ model: openai("gpt-image-2"), prompt: "A lighthouse" })) {
      imageEvents.push(event.type)
    }
    expect(imageEvents).toEqual(["image", "finish"])

    expect(seen).toEqual([
      "https://openai.test/v1/chat/completions",
      "https://openai.test/v1/images/generations",
      "https://openai.test/v1/chat/completions",
      "https://openai.test/v1/images/generations",
    ])
    await ai.dispose()
  })

  test("rethrows AIError unchanged and honors abort signals", async () => {
    const ai = AI.make({ layer: executor([]) })

    const failure = await ai.llm
      .generate({ model: openai.responses("gpt-5"), prompt: "Hello" })
      .then(() => undefined)
      .catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(AIError)
    expect(failure instanceof AIError && failure.reason.http?.status).toBe(404)

    const controller = new AbortController()
    controller.abort()
    const aborted = await ai.llm
      .generate({ model: openai.chat("gpt-4o-mini"), prompt: "Hello" }, { signal: controller.signal })
      .then(() => "completed")
      .catch(() => "aborted")
    expect(aborted).toBe("aborted")

    await ai.dispose()
  })

  test("the default client is created lazily and can be disposed", async () => {
    expect(typeof AI.ai.llm.generate).toBe("function")
    expect(typeof AI.ai.image.generate).toBe("function")
    await AI.ai.dispose()
  })
})
