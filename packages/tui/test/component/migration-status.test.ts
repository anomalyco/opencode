import { OpenCode } from "@opencode/client"
import { describe, expect, test } from "bun:test"
import { pollMigrationStatus, type MigrationProgress } from "../../src/component/migration-status"
import { createApi, createFetch, type FetchHandler } from "../fixture/tui-client"

const completed = { status: "completed" } as const
const timing = { interval: 0, retryTimeout: 2_000 }
const ignoreProgress = () => {}

describe("migration status polling", () => {
  test("retries a startup 503 and finishes when the server is ready", async () => {
    const requests: string[] = []
    await using server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        requests.push(new URL(request.url).pathname)
        if (requests.length === 1) {
          return Response.json({ code: "service_starting" }, { status: 503, headers: { "retry-after": "1" } })
        }
        return Response.json(completed)
      },
    })
    const api = OpenCode.make({ baseUrl: server.url.href })
    const progress: (MigrationProgress | undefined)[] = []

    await expect(
      pollMigrationStatus(
        api.experimental.migration.v1.status,
        (next) => progress.push(next),
        new AbortController().signal,
        timing,
      ),
    ).resolves.toEqual(completed)
    expect(requests).toEqual(["/api/experimental/migration/v1", "/api/experimental/migration/v1"])
    expect(progress).toEqual([])
  })

  test("keeps polling after a dropped connection and reports migration progress", async () => {
    let disconnected = false
    const server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        data(socket) {
          disconnected = true
          socket.terminate()
        },
      },
    })
    const running = { label: "Migrating sessions", numerator: 1, denominator: 2 }
    let attempts = 0
    const api = statusClient((_url, request) => {
      attempts++
      if (attempts === 1) return fetch(`http://127.0.0.1:${server.port}`, { signal: request.signal })
      if (attempts === 2) return Response.json({ status: "running", progress: running })
      return Response.json(completed)
    })
    const progress: (MigrationProgress | undefined)[] = []

    try {
      await expect(
        pollMigrationStatus(
          api.experimental.migration.v1.status,
          (next) => progress.push(next),
          new AbortController().signal,
          timing,
        ),
      ).resolves.toEqual(completed)
      expect(disconnected).toBe(true)
      expect(attempts).toBe(3)
      expect(progress).toEqual([running])
    } finally {
      server.stop(true)
    }
  })

  test("expires the retry deadline even when a retry request is still in flight", async () => {
    let attempts = 0
    const api = statusClient((_url, request) => {
      attempts++
      if (attempts === 1) return Response.json({ code: "service_starting" }, { status: 503 })
      return new Promise<Response>((_, reject) => {
        request.signal.addEventListener("abort", () => reject(request.signal.reason), { once: true })
      })
    })

    await expect(
      pollMigrationStatus(api.experimental.migration.v1.status, ignoreProgress, new AbortController().signal, {
        ...timing,
        retryTimeout: 150,
      }),
    ).rejects.toMatchObject({ name: "TimeoutError" })
    expect(attempts).toBe(2)
  })

  test("cancels the initial wait before sending a request", async () => {
    let attempts = 0
    const api = statusClient(() => {
      attempts++
      return Response.json(completed)
    })
    const abort = new AbortController()
    const polling = pollMigrationStatus(api.experimental.migration.v1.status, ignoreProgress, abort.signal, timing)

    abort.abort()
    await expect(polling).rejects.toMatchObject({ name: "AbortError" })
    expect(attempts).toBe(0)
  })

  test("cancels an in-flight request without retrying it", async () => {
    const requested = Promise.withResolvers<AbortSignal>()
    let attempts = 0
    const api = statusClient((_url, request) => {
      attempts++
      requested.resolve(request.signal)
      return new Promise<Response>((_, reject) => {
        request.signal.addEventListener("abort", () => reject(request.signal.reason), { once: true })
      })
    })
    const abort = new AbortController()
    const polling = pollMigrationStatus(api.experimental.migration.v1.status, ignoreProgress, abort.signal, timing)

    const signal = await requested.promise
    abort.abort()
    await expect(polling).rejects.toMatchObject({ name: "AbortError" })
    expect(signal.aborted).toBe(true)
    expect(attempts).toBe(1)
  })

  test("returns a reported migration failure without retrying", async () => {
    const failure = { status: "error", error: "Could not migrate session history" } as const
    let attempts = 0
    const api = statusClient(() => {
      attempts++
      return Response.json(failure)
    })

    await expect(
      pollMigrationStatus(api.experimental.migration.v1.status, ignoreProgress, new AbortController().signal, timing),
    ).resolves.toEqual(failure)
    expect(attempts).toBe(1)
  })

  test("does not retry an authentication failure", async () => {
    let attempts = 0
    const api = statusClient(() => {
      attempts++
      return Response.json({ message: "Unauthorized" }, { status: 401 })
    })

    await expect(
      pollMigrationStatus(api.experimental.migration.v1.status, ignoreProgress, new AbortController().signal, timing),
    ).rejects.toThrow("Unauthorized")
    expect(attempts).toBe(1)
  })
})

function statusClient(fetch: FetchHandler) {
  return createApi(createFetch(fetch).fetch)
}
