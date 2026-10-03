import { expect, test } from "bun:test"
import { ClientError } from "@opencode/client"
import { Effect, Fiber } from "effect"
import { TestClock } from "effect/testing"
import { bootstrap } from "../src/bootstrap"

test("bootstrap recovers a different managed endpoint and its credentials", async () => {
  using old = Bun.serve({ port: 0, fetch: () => Response.json({}) })
  const requests: string[] = []
  using next = Bun.serve({
    port: 0,
    fetch(request) {
      requests.push(new URL(request.url).pathname)
      expect(request.headers.get("authorization")).toBe("Basic " + btoa("opencode:successor"))
      return Response.json({ location: { directory: "/successor" } })
    },
  })
  const endpoint = {
    url: next.url.toString(),
    auth: { type: "basic" as const, username: "opencode", password: "successor" },
  }
  await old.stop(true)
  let reconnects = 0
  const result = await Effect.runPromise(
    bootstrap(
      {
        endpoint: { url: old.url.toString() },
        service: {
          reconnect: async (signal) => {
            expect(signal.aborted).toBe(false)
            reconnects++
            return endpoint
          },
        },
      },
      "/requested",
    ),
  )
  expect(reconnects).toBe(1)
  expect(result.endpoint).toEqual(endpoint)
  expect(result.location.directory).toBe("/successor")
  // The client returned to the TUI must use the new connection, too.
  await result.api.file.list()
  expect(requests).toEqual(["/api/fs/list", "/api/fs/list"])
})

test("bootstrap keeps the healthy fast path and semantic location fallback", async () => {
  for (const fallback of [false, true]) {
    const requests: string[] = []
    using server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        requests.push(url.pathname)
        if (url.pathname === "/api/location") return Response.json({ directory: "/fallback" })
        expect(url.searchParams.get("location[directory]")).toBe("/requested")
        return fallback ? new Response(null, { status: 403 }) : Response.json({ location: { directory: "/requested" } })
      },
    })
    let reconnects = 0
    const result = await Effect.runPromise(
      bootstrap(
        {
          endpoint: { url: server.url.toString() },
          service: {
            reconnect: async () => {
              reconnects++
              throw new Error("Unexpected reconnect")
            },
          },
        },
        "/requested",
      ),
    )
    expect(reconnects).toBe(0)
    expect(result.location.directory).toBe(fallback ? "/fallback" : "/requested")
    expect(requests).toEqual(fallback ? ["/api/fs/list", "/api/location"] : ["/api/fs/list"])
  }
})

test("bootstrap does not reconnect on HTTP or malformed response failures", async () => {
  for (const mode of ["http", "malformed"]) {
    using server = Bun.serve({
      port: 0,
      fetch: () =>
        mode === "http"
          ? new Response(null, { status: 403 })
          : new Response("not json", { headers: { "content-type": "application/json" } }),
    })
    let reconnects = 0
    const error = await Effect.runPromise(
      bootstrap(
        {
          endpoint: { url: server.url.toString() },
          service: {
            reconnect: async () => {
              reconnects++
              throw new Error("Unexpected reconnect")
            },
          },
        },
        "/requested",
      ).pipe(Effect.flip),
    )
    expect(error).toBeInstanceOf(ClientError)
    expect(reconnects).toBe(0)
  }
})

test("bootstrap retries only once and preserves a reconnect failure", async () => {
  using old = Bun.serve({ port: 0, fetch: () => Response.json({}) })
  const endpoint = { url: old.url.toString() }
  await old.stop(true)
  for (const fails of [false, true]) {
    let reconnects = 0
    const failure = new Error("Background service failed to start")
    const error = await Effect.runPromise(
      bootstrap(
        {
          endpoint,
          service: {
            reconnect: async () => {
              reconnects++
              if (fails) throw failure
              return endpoint
            },
          },
        },
        "/requested",
      ).pipe(Effect.flip),
    )
    expect(reconnects).toBe(1)
    if (fails) expect(error).toBe(failure)
    if (!fails) expect(error).toBeInstanceOf(ClientError)
  }
})

test("bootstrap leaves explicit and standalone connection failures explicit", async () => {
  using old = Bun.serve({ port: 0, fetch: () => Response.json({}) })
  const endpoint = { url: old.url.toString() }
  await old.stop(true)
  const error = await Effect.runPromise(bootstrap({ endpoint }, "/requested").pipe(Effect.flip))
  expect(error).toBeInstanceOf(ClientError)
})

test("bootstrap cancellation aborts the managed reconnect", async () => {
  using old = Bun.serve({ port: 0, fetch: () => Response.json({}) })
  const endpoint = { url: old.url.toString() }
  await old.stop(true)
  const entered = Promise.withResolvers<AbortSignal>()
  const controller = new AbortController()
  const pending = Effect.runPromise(
    bootstrap(
      {
        endpoint,
        service: {
          reconnect: (signal) => {
            entered.resolve(signal)
            return new Promise(() => {})
          },
        },
      },
      "/requested",
    ),
    { signal: controller.signal },
  ).catch((error: unknown) => error)
  const signal = await entered.promise
  controller.abort()
  await pending
  expect(signal.aborted).toBe(true)
})

test("bootstrap deadline aborts a stuck managed reconnect", async () => {
  using old = Bun.serve({ port: 0, fetch: () => Response.json({}) })
  const endpoint = { url: old.url.toString() }
  await old.stop(true)
  const entered = Promise.withResolvers<AbortSignal>()
  await Effect.runPromise(
    Effect.gen(function* () {
      const pending = yield* bootstrap(
        {
          endpoint,
          service: {
            reconnect: (signal) => {
              entered.resolve(signal)
              return new Promise(() => {})
            },
          },
        },
        "/requested",
      ).pipe(Effect.forkChild)
      const signal = yield* Effect.promise(() => entered.promise)
      yield* TestClock.adjust("2 minutes")
      const error = yield* Fiber.join(pending).pipe(Effect.flip)
      expect(error).toBeInstanceOf(Error)
      expect(String(error)).toContain("Timed out connecting to the server during TUI startup")
      expect(signal.aborted).toBe(true)
    }).pipe(Effect.provide(TestClock.layer({}))),
  )
})
