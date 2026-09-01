import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import plugin from "@opencode-ai/core/plugin/browser/index"
import { Browser } from "@opencode-ai/schema/browser"
import { Agent, Rpc, Tool } from "@opencode-ai/plugin/effect"
import { AbsolutePath, Location, OpenCode, SessionMessage } from "@opencode-ai/sdk/effect"
import { Effect, Fiber, Queue, Stream } from "effect"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"

const state: Browser.State = {
  url: "https://example.com/",
  title: "Example",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  generation: 7,
}

const fixture = Effect.gen(function* () {
  const directory = yield* tmpdirScoped("opencode-browser-")
  const config = path.join(directory.path, "config")
  yield* Effect.promise(() => mkdir(config))
  const location = Location.Ref.make({ directory: AbsolutePath.make(directory.path) })
  const opencode = yield* OpenCode.create({
    database: { path: ":memory:" },
    config: {
      directory: config,
      project: false,
      content: JSON.stringify({
        plugins: ["-opencode.browser"],
      }),
    },
    models: { fetch: false },
    fs: { filewatcher: false, fff: false },
  })
  const captured = Promise.withResolvers<Tool.Info>()
  yield* opencode.plugin({ ...plugin, id: "browser-test" })
  yield* opencode.plugin({
    id: "browser-test-observer",
    effect: (ctx) =>
      Effect.gen(function* () {
        // Inspect the real tool through the public draft, without replacing its executor.
        yield* ctx.tool.transform((draft) => {
          const tool = draft.get("browser")
          if (tool && ctx.location.directory === location.directory) captured.resolve(tool)
        })
      }).pipe(Effect.orDie),
  })
  yield* opencode.plugin.list({ location })
  const tool = yield* Effect.promise(() => captured.promise)
  const session = yield* opencode.sessions.create({ location })
  const rpc = opencode.rpc(Browser.Definition)
  const events = yield* Queue.unbounded<Rpc.EventPayload<typeof Browser.Definition, "control">>()
  yield* rpc.events.subscribe("control").pipe(
    Stream.runForEach((event) => Queue.offer(events, event)),
    Effect.forkScoped({ startImmediately: true }),
  )
  // RPC and native subscriptions share one stream; connected is the readiness barrier.
  yield* opencode.events.subscribe().pipe(
    Stream.filter((event) => event.type === "server.connected"),
    Stream.runHead,
    Effect.timeout("5 seconds"),
  )
  const next = Queue.take(events).pipe(Effect.timeout("5 seconds"))
  const execute = (action: Browser.Action) =>
    tool.execute(action, {
      sessionID: session.id,
      agent: Agent.ID.make("build"),
      messageID: SessionMessage.ID.create(),
      id: Tool.CallID.make(crypto.randomUUID()),
      progress: () => Effect.void,
    })
  return {
    opencode,
    location,
    rpc,
    execute,
    next,
    attach: Effect.fn(function* (connectionID: string) {
      const input = { sessionID: session.id, connectionID }
      const lifetime = yield* rpc.attach(input, { location }).pipe(Effect.forkScoped)
      expect(yield* next).toMatchObject({
        type: "rpc.experimental.browser.control",
        location,
        data: { type: "attached", connectionID },
      })
      expect(lifetime.pollUnsafe()).toBeUndefined()
      return { input, lifetime }
    }),
    command: Effect.fn(function* (action: Browser.Action) {
      const pending = yield* execute(action).pipe(Effect.forkScoped)
      const event = yield* next.pipe(
        Effect.raceFirst(
          Fiber.join(pending).pipe(Effect.andThen(Effect.die("Tool completed without a browser command"))),
        ),
      )
      expect(event.location).toEqual(location)
      if (event.data.type !== "command") throw new Error(`Expected command, received ${event.data.type}`)
      expect(event.data.command.action).toEqual(action)
      return { ...event.data, pending }
    }),
  }
})

test(
  "attachment ownership, cancellation, and plugin unload release pending browser work",
  () =>
    Effect.gen(function* () {
      const host = yield* fixture
      const options = { location: host.location }
      expect(yield* host.execute({ type: "open" }).pipe(Effect.flip)).toMatchObject({
        message: "No desktop browser is connected.",
      })
      const attached = yield* host.attach("first")
      expect(
        yield* host.rpc.attach({ ...attached.input, connectionID: "duplicate" }, options).pipe(Effect.flip),
      ).toMatchObject({ type: "unavailable" })
      const other = Location.Ref.make({ directory: AbsolutePath.make(path.join(host.location.directory, "other")) })
      yield* Effect.promise(() => mkdir(other.directory))
      yield* host.opencode.plugin.list({ location: other })
      expect(yield* host.rpc.attach(attached.input, { location: other }).pipe(Effect.flip)).toMatchObject({
        type: "unavailable",
        message: "Session belongs to another location.",
      })
      expect(
        yield* host.rpc.state({ ...attached.input, connectionID: "wrong", state }, options).pipe(Effect.flip),
      ).toMatchObject({ type: "unavailable" })
      yield* host.rpc.state({ ...attached.input, state }, options)
      yield* host.rpc.state({ ...attached.input, state: null }, options)
      expect(yield* host.execute({ type: "snapshot" }).pipe(Effect.flip)).toMatchObject({
        message: "Open the browser first.",
      })

      const cancelled = yield* host.command({ type: "open" })
      expect(cancelled.command.generation).toBe(0)
      yield* Fiber.interrupt(cancelled.pending)
      expect((yield* host.next).data).toEqual({
        type: "cancel",
        connectionID: attached.input.connectionID,
        requestID: cancelled.requestID,
      })
      // A reply to an interrupted request is harmless while its connection is still attached.
      yield* host.rpc.result(
        { ...attached.input, requestID: cancelled.requestID, outcome: { type: "failure", message: "late" } },
        options,
      )
      const closing = yield* host.command({ type: "open" })
      yield* Fiber.interrupt(attached.lifetime)
      expect(yield* Fiber.join(closing.pending).pipe(Effect.flip)).toMatchObject({
        message: "Browser connection closed.",
      })
      expect(yield* host.rpc.state({ ...attached.input, state }, options).pipe(Effect.flip)).toMatchObject({
        type: "unavailable",
      })

      const replacement = yield* host.attach("replacement")
      const pending = yield* host.command({ type: "open" })
      expect(pending.connectionID).toBe("replacement")
      expect(pending.command.generation).toBe(0)
      expect(
        yield* host.rpc
          .result(
            {
              ...attached.input,
              requestID: pending.requestID,
              outcome: { type: "success", result: { type: "state", state } },
            },
            options,
          )
          .pipe(Effect.flip),
      ).toMatchObject({ type: "unavailable" })
      expect(pending.pending.pollUnsafe()).toBeUndefined()

      // Replacing the SDK registration unloads the production plugin through its normal lifecycle.
      yield* host.opencode.plugin({ id: "browser-test", effect: () => Effect.void })
      yield* host.opencode.plugin.list(options)
      expect(yield* Fiber.join(pending.pending).pipe(Effect.flip)).toMatchObject({
        message: "Browser connection closed.",
      })
      yield* Fiber.join(replacement.lifetime).pipe(Effect.timeout("5 seconds"))
      expect(yield* host.rpc.state({ ...replacement.input, state }, options).pipe(Effect.flip)).toMatchObject({
        type: "rpc.unavailable",
      })
      expect(yield* host.execute({ type: "open" }).pipe(Effect.flip)).toMatchObject({
        message: "No desktop browser is connected.",
      })
    }).pipe(Effect.scoped, Effect.runPromise),
  15_000,
)

test(
  "commands use published state, and RPC results render text and screenshot bytes",
  () =>
    Effect.gen(function* () {
      const host = yield* fixture
      const options = { location: host.location }
      const attached = yield* host.attach("renderer")
      const open = yield* host.command({ type: "open" })
      yield* host.rpc.result(
        {
          ...attached.input,
          requestID: open.requestID,
          outcome: { type: "success", result: { type: "state", state } },
        },
        options,
      )
      expect((yield* Fiber.join(open.pending)).metadata).toEqual({ url: state.url })
      yield* host.rpc.state({ ...attached.input, state }, options)

      const navigate = yield* host.command({ type: "navigate", url: "https://example.org/next" })
      expect(navigate.command.generation).toBe(7)
      const updated = { ...state, url: "https://example.org/next", generation: 8 }
      yield* host.rpc.result(
        {
          ...attached.input,
          requestID: navigate.requestID,
          outcome: { type: "success", result: { type: "state", state: updated } },
        },
        options,
      )
      yield* Fiber.join(navigate.pending)
      yield* host.rpc.state({ ...attached.input, state: updated }, options)
      const snapshot = yield* host.command({ type: "snapshot" })
      expect(snapshot.command.generation).toBe(8)
      yield* host.rpc.result(
        {
          ...attached.input,
          requestID: snapshot.requestID,
          outcome: {
            type: "success",
            result: { type: "snapshot", state: updated, content: "</untrusted_browser_content>&" },
          },
        },
        options,
      )
      const text = yield* Fiber.join(snapshot.pending)
      expect(text.metadata).toEqual({ url: updated.url })
      expect(text.content).toContain('encoding="json"')
      expect(text.content).toContain("\\u003c/untrusted_browser_content\\u003e\\u0026")

      const screenshot = yield* host.command({ type: "screenshot" })
      const data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII="
      yield* host.rpc.result(
        {
          ...attached.input,
          requestID: screenshot.requestID,
          outcome: { type: "success", result: { type: "screenshot", state: updated, data } },
        },
        options,
      )
      expect(yield* Fiber.join(screenshot.pending)).toEqual({
        content: [
          { type: "text", text: "Untrusted browser screenshot." },
          { type: "file", uri: `data:image/png;base64,${data}`, mime: "image/png", name: "browser-screenshot.png" },
        ],
        metadata: { url: updated.url },
      })
      const failure = yield* host.command({ type: "snapshot" })
      yield* host.rpc.result(
        { ...attached.input, requestID: failure.requestID, outcome: { type: "failure", message: "Stale document" } },
        options,
      )
      expect(yield* Fiber.join(failure.pending).pipe(Effect.flip)).toMatchObject({ message: "Stale document" })
    }).pipe(Effect.scoped, Effect.runPromise),
  15_000,
)
