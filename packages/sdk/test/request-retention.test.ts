import { expect } from "bun:test"
import { fullGC, heapStats } from "bun:jsc"
import { Effect, Layer } from "effect"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { testEffect } from "../../core/test/lib/effect"
import { OpenCode } from "../src/effect"
import { OwnedFetch } from "../src/internal/fetch"

const it = testEffect(Layer.empty)

it.live("releases completed embedded requests while the host stays open", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const client = yield* OpenCode.create({
      app: { version: "request-retention-test" },
      config: { directory: directory.path, project: false, content: "{}" },
      events: { persist: true },
      models: { fetch: false },
      fs: { filewatcher: false },
    })

    fullGC()
    const before = heapStats().objectTypeCounts.Request ?? 0
    for (let index = 0; index < 200; index++) {
      expect((yield* client.server.info()).version).toBe("request-retention-test")
    }

    // Completed response cleanup crosses an event-loop turn in the embedded transport.
    yield* Effect.promise(() => Bun.sleep(100))
    fullGC()
    expect((heapStats().objectTypeCounts.Request ?? 0) - before).toBeLessThan(20)
  }),
)

it.live("releases failed embedded requests while the host and caller signal stay open", () =>
  Effect.promise(async () => {
    const caller = new AbortController()
    const requests: WeakRef<Request>[] = []
    const transport = OwnedFetch.make(
      async (request) => {
        requests.push(new WeakRef(request))
        request.signal.addEventListener("abort", () => void request.url)
        throw new Error("handler failed")
      },
      async () => {},
    )

    for (let index = 0; index < 120; index++) {
      expect(
        await transport
          .fetch(`http://opencode.local/${index}`, { signal: caller.signal })
          .catch((cause: unknown) => cause),
      ).toMatchObject({
        message: "handler failed",
      })
    }

    await Bun.sleep(50)
    fullGC()
    expect(caller.signal.aborted).toBe(false)
    expect(requests.filter((ref) => ref.deref() !== undefined).length).toBeLessThanOrEqual(3)
    await transport.close()
  }),
)

it.live("keeps caller abort and host shutdown wired to active requests", () =>
  Effect.promise(async () => {
    const seen: unknown[] = []
    let disposed = false
    const transport = OwnedFetch.make(
      async (request) => {
        await new Promise<void>((resolve) => {
          request.signal.addEventListener(
            "abort",
            () => {
              seen.push(request.signal.reason)
              resolve()
            },
            { once: true },
          )
        })
        return new Response("aborted")
      },
      async () => {
        disposed = true
      },
    )
    const controller = new AbortController()
    const first = transport.fetch("http://opencode.local/", { signal: controller.signal })
    controller.abort("caller")
    expect(await first.catch((error: unknown) => error)).toBe("caller")

    const second = transport.fetch("http://opencode.local/")
    const closed = transport.close()
    const failure = await second.catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    expect(failure).toMatchObject({ message: "OpenCode host is closed" })
    await closed
    expect(disposed).toBe(true)
    expect(seen).toEqual(["caller", failure])
  }),
)

it.live("cancels an open response body on host shutdown before disposing the handler", () =>
  Effect.promise(async () => {
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

    const response = await transport.fetch("http://opencode.local/stream")
    const reading = response.body!.getReader().read()
    const closing = transport.close()
    const reason = await cancelled.promise

    expect(reason).toBeInstanceOf(Error)
    expect(reason).toMatchObject({ message: "OpenCode host is closed" })
    expect(await reading.catch((cause: unknown) => cause)).toBe(reason)
    await closing
    expect(disposed).toBe(true)
  }),
)
