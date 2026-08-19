import { describe, expect, test } from "bun:test"
import { StreamLiveness } from "@/provider/stream-liveness"

const policy = {
  initial: 30,
  minimum: 10,
  maximum: 100,
  multiplier: 2,
  historySize: 2,
} satisfies StreamLiveness.Policy

describe("stream liveness deadline", () => {
  test("uses the cold-start deadline without observations", () => {
    expect(StreamLiveness.create(policy).deadline("anthropic:@ai-sdk/anthropic")).toBe(30)
  })

  test("doubles the rolling maximum and applies both bounds", () => {
    const detector = StreamLiveness.create(policy)
    detector.observe("provider:transport", 2)
    expect(detector.deadline("provider:transport")).toBe(10)
    detector.observe("provider:transport", 60)
    expect(detector.deadline("provider:transport")).toBe(100)
  })

  test("evicts observations outside the bounded history", () => {
    const detector = StreamLiveness.create(policy)
    detector.observe("provider:transport", 40)
    detector.observe("provider:transport", 20)
    detector.observe("provider:transport", 5)
    expect(detector.deadline("provider:transport")).toBe(40)
  })

  test("isolates provider and transport buckets", () => {
    const detector = StreamLiveness.create(policy)
    detector.observe("openai:@ai-sdk/openai", 40)
    expect(detector.deadline("anthropic:@ai-sdk/anthropic")).toBe(30)
  })
})

describe("stream liveness response body", () => {
  test("fails a post-header SSE body that never yields or closes", async () => {
    const detector = StreamLiveness.create({ ...policy, initial: 20 })
    const response = detector.wrap({
      bucket: "test:transport",
      controller: new AbortController(),
      response: new Response(new ReadableStream({ pull: () => new Promise(() => {}) }), {
        headers: { "content-type": "text/event-stream" },
      }),
    })

    await expect(response.text()).rejects.toHaveProperty("name", "ProviderResponseStreamTimeoutError")
  })

  test("uses request stream intent when the response omits its content type", async () => {
    const detector = StreamLiveness.create({ ...policy, initial: 10 })
    const response = detector.wrap({
      bucket: "test:transport",
      controller: new AbortController(),
      response: new Response(
        new ReadableStream({
          async pull(controller) {
            await Bun.sleep(30)
            controller.enqueue(new TextEncoder().encode("late"))
            controller.close()
          },
        }),
      ),
      stream: true,
    })

    await expect(response.text()).rejects.toHaveProperty("name", "ProviderResponseStreamTimeoutError")
  })

  test("raw heartbeat bytes reset the pending-read deadline", async () => {
    const detector = StreamLiveness.create({ ...policy, initial: 30 })
    const response = detector.wrap({
      bucket: "test:transport",
      controller: new AbortController(),
      response: new Response(
        new ReadableStream({
          start(controller) {
            setTimeout(() => controller.enqueue(new TextEncoder().encode(": heartbeat\n\n")), 10)
            setTimeout(() => controller.close(), 20)
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      ),
    })

    expect(await response.text()).toBe(": heartbeat\n\n")
  })

  test("empty chunks do not count as body progress", async () => {
    const detector = StreamLiveness.create({ ...policy, initial: 20 })
    let id: ReturnType<typeof setInterval> | undefined
    const response = detector.wrap({
      bucket: "test:transport",
      controller: new AbortController(),
      response: new Response(
        new ReadableStream({
          start(controller) {
            id = setInterval(() => controller.enqueue(new Uint8Array()), 5)
          },
          cancel() {
            clearInterval(id)
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      ),
    })

    await expect(response.text()).rejects.toHaveProperty("name", "ProviderResponseStreamTimeoutError")
  })

  test("commits one maximum-gap observation only on normal EOF", async () => {
    const readings = [0, 7, 7, 20]
    const detector = StreamLiveness.create(policy, () => readings.shift() ?? 20)
    const response = detector.wrap({
      bucket: "test:transport",
      controller: new AbortController(),
      response: new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([1]))
            controller.close()
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      ),
    })

    await response.arrayBuffer()
    expect(detector.deadline("test:transport")).toBe(26)
  })

  test("does not train history after timeout", async () => {
    const detector = StreamLiveness.create({ ...policy, initial: 20 })
    const response = detector.wrap({
      bucket: "test:transport",
      controller: new AbortController(),
      response: new Response(new ReadableStream({ pull: () => new Promise(() => {}) }), {
        headers: { "content-type": "text/event-stream" },
      }),
    })

    await expect(response.text()).rejects.toBeDefined()
    expect(detector.deadline("test:transport")).toBe(20)
  })

  test("does not train history after consumer cancellation", async () => {
    const detector = StreamLiveness.create({ ...policy, initial: 20 })
    const response = detector.wrap({
      bucket: "test:transport",
      controller: new AbortController(),
      response: new Response(new ReadableStream(), {
        headers: { "content-type": "text/event-stream" },
      }),
    })

    await response.body?.cancel()
    expect(detector.deadline("test:transport")).toBe(20)
  })

  test("leaves non-SSE and explicitly disabled responses unchanged", () => {
    const detector = StreamLiveness.create(policy)
    const json = new Response("{}")
    expect(
      detector.wrap({ response: json, bucket: "test:transport", controller: new AbortController() }),
    ).toBe(json)

    const sse = new Response("", { headers: { "content-type": "text/event-stream" } })
    expect(
      detector.wrap({
        response: sse,
        bucket: "test:transport",
        controller: new AbortController(),
        timeout: false,
      }),
    ).toBe(sse)
  })

  test("uses a positive fixed override instead of the adaptive deadline", async () => {
    const detector = StreamLiveness.create({ ...policy, initial: 100 })
    const response = detector.wrap({
      bucket: "test:transport",
      controller: new AbortController(),
      response: new Response(new ReadableStream({ pull: () => new Promise(() => {}) }), {
        headers: { "content-type": "text/event-stream" },
      }),
      timeout: 8,
    })

    await expect(response.text()).rejects.toMatchObject({
      name: "ProviderResponseStreamTimeoutError",
      ms: 8,
    })
  })
})
