import { expect } from "bun:test"
import { Deferred, Effect, Layer, Option } from "effect"
import { testEffect } from "../../core/test/lib/effect"
import { Updater } from "../src/services/updater"

const it = testEffect(Layer.empty)

it.live("installs and restarts after the final Session settles", () =>
  Effect.gen(function* () {
    const fixture = yield* Effect.acquireRelease(Effect.sync(makeServer), (server) => Effect.sync(() => server.stop()))
    const installed = yield* Deferred.make<string>()
    const restarted = yield* Deferred.make<void>()
    yield* Updater.monitorServer({
      url: fixture.url,
      password: "test",
      managed: true,
      inspect: () => Effect.succeed({ action: "upgrade", target: { package: "@opencode-ai/cli", version: "1.1.0" } }),
      install: (target) => Deferred.succeed(installed, target.version).pipe(Effect.as(true)),
      restart: () => Deferred.succeed(restarted, undefined).pipe(Effect.asVoid),
      notify: () => Effect.void,
    }).pipe(Effect.forkScoped)
    yield* wait(fixture.activeRead, () => "Updater did not check active Sessions")
    yield* wait(fixture.eventOpened, () => "Updater did not open the server event stream")
    expect(Option.isNone(yield* Deferred.poll(installed))).toBe(true)

    fixture.settle()
    yield* wait(fixture.waited, () => "Updater did not receive the settlement event")
    expect(
      yield* Effect.raceFirst(
        Deferred.await(installed),
        Effect.sleep("1 second").pipe(Effect.andThen(Effect.fail(new Error("Updater did not install the update")))),
      ),
    ).toBe("1.1.0")
    yield* Effect.raceFirst(
      Deferred.await(restarted),
      Effect.sleep("1 second").pipe(Effect.andThen(Effect.fail(new Error("Updater did not restart the server")))),
    )
  }),
)

const wait = (promise: Promise<unknown>, message: () => string) =>
  Effect.tryPromise(() => Promise.race([promise, Bun.sleep(1_000).then(() => Promise.reject(new Error(message())))]))

function makeServer() {
  const encoder = new TextEncoder()
  const activeRead = Promise.withResolvers<void>()
  const eventOpened = Promise.withResolvers<void>()
  const waited = Promise.withResolvers<void>()
  let active = true
  let events: ReadableStreamDefaultController<Uint8Array> | undefined
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/api/session/active") {
        activeRead.resolve()
        return Response.json({ data: active ? { ses_test: { type: "running" } } : {} })
      }
      if (url.pathname === "/api/session/ses_test/wait" && request.method === "POST") {
        waited.resolve()
        return new Response(null, { status: 204 })
      }
      if (url.pathname === "/api/experimental/persistent-pty/handoff" && request.method === "POST") {
        return Response.json({ handoff: null })
      }
      if (url.pathname === "/api/event") {
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              events = controller
              eventOpened.resolve()
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        )
      }
      return new Response("Not found", { status: 404 })
    },
  })

  return {
    url: server.url.origin,
    activeRead: activeRead.promise,
    eventOpened: eventOpened.promise,
    waited: waited.promise,
    settle() {
      active = false
      events?.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({
            id: "evt_settled",
            created: Date.now(),
            type: "session.execution.succeeded",
            durable: { aggregateID: "ses_test", seq: 0, version: 1 },
            data: { sessionID: "ses_test" },
          })}\n\n`,
        ),
      )
      events?.close()
      events = undefined
    },
    stop() {
      server.stop(true)
    },
  }
}
