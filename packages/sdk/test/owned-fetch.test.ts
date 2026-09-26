import { expect, test } from "bun:test"
import { Effect } from "effect"
import { HttpEffect, HttpServerResponse } from "effect/unstable/http"
import { OwnedFetch } from "../src/internal/fetch"

test("completed embedded requests are released while the host stays open", async () => {
  const requests: WeakRef<Request>[] = []
  const handler = HttpEffect.toWebHandler(Effect.succeed(HttpServerResponse.empty()))
  const tracked = OwnedFetch.make(
    async (request) => {
      requests.push(new WeakRef(request))
      return handler(request)
    },
    async () => {},
  )

  for (let index = 0; index < 120; index++) {
    const response = await tracked.fetch(`http://localhost/${index}`)
    await response.arrayBuffer()
  }

  for (let round = 0; round < 12; round++) {
    Bun.gc(true)
    await Bun.sleep(10)
  }
  // The active async stack may keep the last few requests alive for one turn.
  expect(requests.filter((ref) => ref.deref() !== undefined).length).toBeLessThanOrEqual(3)
  await tracked.close()
})

test("failed embedded requests are released while the host stays open", async () => {
  const requests: WeakRef<Request>[] = []
  const transport = OwnedFetch.make(
    async (request) => {
      requests.push(new WeakRef(request))
      throw new Error("handler failed")
    },
    async () => {},
  )

  for (let index = 0; index < 120; index++) {
    expect(await transport.fetch(`http://localhost/${index}`).catch((cause) => cause)).toMatchObject({
      message: "handler failed",
    })
  }
  for (let round = 0; round < 12; round++) {
    Bun.gc(true)
    await Bun.sleep(10)
  }
  expect(requests.filter((ref) => ref.deref() !== undefined).length).toBeLessThanOrEqual(3)
  await transport.close()
})

test("caller cancellation still reaches an in-flight embedded request", async () => {
  const caller = new AbortController()
  const started = Promise.withResolvers<Request>()
  const transport = OwnedFetch.make(
    (request) => {
      started.resolve(request)
      return new Promise((resolve) =>
        request.signal.addEventListener("abort", () => resolve(new Response()), { once: true }),
      )
    },
    async () => {},
  )

  const pending = transport.fetch("http://localhost/caller", { signal: caller.signal })
  const request = await started.promise
  const reason = new Error("caller cancelled")
  caller.abort(reason)

  expect(await pending.catch((cause) => cause)).toBe(reason)
  expect(request.signal.reason).toBe(reason)
  await transport.close()
})

test("host shutdown aborts in-flight requests before disposing the handler", async () => {
  const started = Promise.withResolvers<Request>()
  let disposed = false
  const transport = OwnedFetch.make(
    (request) => {
      started.resolve(request)
      return new Promise((resolve) =>
        request.signal.addEventListener("abort", () => resolve(new Response()), { once: true }),
      )
    },
    async () => {
      disposed = true
    },
  )

  const pending = transport.fetch("http://localhost/shutdown")
  const request = await started.promise
  const closing = transport.close()
  const failure = await pending.catch((cause) => cause)

  expect(failure).toBeInstanceOf(Error)
  expect(failure.message).toBe("OpenCode host is closed")
  expect(request.signal.reason).toBe(failure)
  await closing
  expect(disposed).toBe(true)
  expect(await transport.fetch("http://localhost/closed").catch((cause) => cause)).toBe(failure)
})

test("host shutdown cancels an open response body before disposing the handler", async () => {
  const cancelled = Promise.withResolvers<unknown>()
  let disposed = false
  const transport = OwnedFetch.make(
    async () =>
      new Response(
        new ReadableStream({
          cancel(reason) {
            cancelled.resolve(reason)
          },
        }),
      ),
    async () => {
      disposed = true
    },
  )

  const response = await transport.fetch("http://localhost/stream")
  const reading = response.body!.getReader().read()
  const closing = transport.close()
  const reason = await cancelled.promise

  expect(reason).toBeInstanceOf(Error)
  expect((reason as Error).message).toBe("OpenCode host is closed")
  expect(await reading.catch((cause) => cause)).toBe(reason)
  await closing
  expect(disposed).toBe(true)
})
