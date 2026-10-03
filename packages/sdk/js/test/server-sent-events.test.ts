import { expect, test } from "bun:test"
import { createSseClient } from "../src/v2/gen/core/serverSentEvents.gen"

test("observes reader cancellation errors when an SSE request is aborted", async () => {
  const abort = new AbortController()
  const result = createSseClient({
    fetch: async () =>
      new Response(
        new ReadableStream({
          start: (controller) =>
            abort.signal.addEventListener("abort", () =>
              controller.error(new DOMException("The operation was aborted", "AbortError")),
            ),
        }),
        { headers: { "content-type": "text/event-stream" } },
      ),
    method: "GET",
    signal: abort.signal,
    sseMaxRetryAttempts: 1,
    url: "http://localhost/events",
  })

  const next = result.stream.next()
  // Let the generator park in reader.read() before erroring the body stream.
  await Bun.sleep(10)
  abort.abort()
  expect(await next).toEqual({ done: true, value: undefined })
  // Give any unobserved cancellation rejection time to reach Bun's test runner.
  await Bun.sleep(10)
})
