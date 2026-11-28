import { describe, expect } from "bun:test"
import { McpEvent } from "@opencode/schema/mcp-event"
import { ConfigMCP } from "@opencode/schema/config/mcp"
import { Mcp } from "@opencode/core/mcp/index"
import { State } from "@opencode/core/state"
import { Deferred, Effect, Fiber, Layer, Schema } from "effect"
import { TestClock } from "effect/testing"
import { testEffect } from "../lib/effect"
import { serve, type Fixture } from "./fixture/http"
import { integration, remote, until, world } from "./harness"

const it = testEffect(Layer.empty)

/** Holds every request `matches` picks until the test releases them. */
const hold = (server: Fixture, matches: (request: Request, body: Record<string, unknown> | undefined) => boolean) =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined))
    server.intercept(async (request, body) => {
      if (!matches(request, body)) return undefined
      await Effect.runPromise(Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(release))))
      return undefined
    })
    return { started: Deferred.await(started), release: Deferred.succeed(release, undefined) }
  })

const handshake = (_: Request, body: Record<string, unknown> | undefined) =>
  body?.method === "server/discover" || body?.method === "initialize"
const local = (fields: Partial<ConfigMCP.Local> = {}): typeof ConfigMCP.Server.Type => ({
  type: "local",
  command: ["unused"],
  disabled: true,
  ...fields,
})

describe("MCP config", () => {
  it.live("reconnects only servers whose config changed, and keeps runtime adds and removes across reloads", () =>
    Effect.gen(function* () {
      const server = yield* serve({ era: "modern" })
      const fixture = remote(server.url)
      const place = yield* (yield* world).open({ servers: { fixture, gone: local() } })
      yield* place.settled("fixture")
      yield* place.mcp.add("extra", local({ command: ["runtime"] }))
      yield* place.mcp.remove("gone")
      const names = place.mcp.servers().pipe(Effect.map((servers) => servers.map((item) => String(item.name))))

      yield* place.configure({ username: "unrelated", servers: { fixture, gone: local(), added: local() } })
      expect(yield* until("the added server", names, (list) => list.includes("added"))).toEqual([
        "added",
        "extra",
        "fixture",
      ])
      expect(server.seen.lists).toBe(1)

      yield* place.configure({ servers: { fixture: remote(server.url, { codemode: false }), added: local() } })
      yield* until(
        "the reconnect",
        Effect.sync(() => server.seen.lists),
        (lists) => lists === 2,
      )
      expect((yield* place.mcp.tools()).every((tool) => tool.codemode === false)).toBe(true)

      yield* place.configure({ servers: { added: local() } })
      expect(yield* until("the removal", names, (list) => !list.includes("fixture"))).toEqual(["added", "extra"])
    }),
  )

  it.live("fills configured servers' timeouts from the defaults, and leaves runtime servers as given", () =>
    Effect.gen(function* () {
      const place = yield* (yield* world).open({
        timeout: { startup: 10, catalog: 20 },
        servers: { configured: local({ timeout: { catalog: 40 } }) },
      })
      const runtime = { type: "local" as const, command: ["runtime"], disabled: true, timeout: { execution: 60 } }
      yield* place.mcp.add("runtime", runtime)
      yield* place.mcp.reload()
      const seen = yield* place.mcp.transform((editor) => {
        expect(editor.get("configured")?.timeout).toEqual({ startup: 10, catalog: 40 })
        expect(editor.get("runtime")).toEqual(runtime)
      })
      yield* seen.dispose
    }),
  )

  it.live("applies transforms in place, isolates their edits, and restores what they replaced when disposed", () =>
    Effect.gen(function* () {
      const server = yield* serve({ era: "modern" })
      const place = yield* (yield* world).open({})
      const status = (name: string) => place.status(name).pipe(Effect.map((value) => value?.status))

      const config = remote(server.url, { headers: { Authorization: "original" } })
      yield* place.mcp.add("dynamic", config)
      expect(yield* status("dynamic")).toBe("connected")
      const edited = yield* place.mcp.transform((editor) =>
        editor.update("dynamic", (item) => {
          if (item.type === "remote" && item.headers) item.headers.Authorization = "transformed"
          item.codemode = false
        }),
      )
      expect(config.headers?.Authorization).toBe("original")
      expect((yield* place.mcp.tools()).every((tool) => tool.codemode === false)).toBe(true)

      const disabled = yield* place.mcp.transform((editor) =>
        editor.update("dynamic", (item) => (item.disabled = true)),
      )
      expect(yield* status("dynamic")).toBe("disabled")
      expect(yield* place.mcp.tools()).toEqual([])
      const removed = yield* place.mcp.transform((editor) => editor.remove("dynamic"))
      expect(yield* status("dynamic")).toBeUndefined()

      yield* removed.dispose
      yield* disabled.dispose
      expect(yield* status("dynamic")).toBe("connected")
      yield* edited.dispose
      expect((yield* place.mcp.tools()).every((tool) => tool.codemode !== false)).toBe(true)
      yield* place.mcp.transform((editor) => {
        const item = editor.get("dynamic")
        expect(item?.type === "remote" && item.headers?.Authorization).toBe("original")
      })
    }),
  )

  it.live("connects only the final configuration of a batch of transforms", () =>
    Effect.gen(function* () {
      const server = yield* serve({ era: "modern" })
      const place = yield* (yield* world).open({})
      yield* State.batch(
        Effect.gen(function* () {
          yield* place.mcp.transform((editor) => editor.set("dynamic", remote(server.url)))
          expect(yield* place.status("dynamic")).toBeUndefined()
          yield* place.mcp.transform((editor) => editor.update("dynamic", (item) => (item.disabled = true)))
        }),
      )
      expect(yield* place.status("dynamic")).toEqual({ status: "disabled" })
      expect(server.seen.discovers).toBe(0)
    }),
  )

  it.live("keeps servers a policy denies out of every list until it is lifted", () =>
    Effect.gen(function* () {
      const server = yield* serve({ era: "modern" })
      const servers = { fixture: remote(server.url) }
      const place = yield* (yield* world).open({ servers })
      yield* place.settled("fixture")
      yield* place.configure({ servers, policies: [{ action: "mcp.use", resource: "*", effect: "deny" }] })
      yield* until("the policy", place.mcp.servers(), (list) => list.length === 0)
      expect([yield* place.mcp.tools(), yield* place.mcp.prompts(), yield* place.mcp.instructions()]).toEqual([
        [],
        [],
        [],
      ])
      expect(yield* place.mcp.resourceCatalog()).toEqual({ resources: [], templates: [] })
      expect(yield* place.mcp.callTool({ server: "fixture", name: "echo" }).pipe(Effect.flip)).toBeInstanceOf(
        Mcp.NotFoundError,
      )
      expect(yield* place.mcp.connect("fixture").pipe(Effect.flip)).toBeInstanceOf(Mcp.NotFoundError)
      // A runtime add is governed too.
      yield* place.mcp.add("fixture", remote(server.url))
      expect(yield* place.mcp.servers()).toEqual([])
      expect(server.seen.calls).toEqual([])

      yield* place.configure({ servers })
      yield* until("the policy to lift", place.status("fixture"), (status) => status?.status === "connected")
      yield* place.mcp.callTool({ server: "fixture", name: "echo" })
    }),
  )
})

describe("MCP lifecycle races", () => {
  it.live("finishes a connect whose caller is interrupted during the handshake", () =>
    Effect.gen(function* () {
      const server = yield* serve({ era: "modern" })
      const gate = yield* hold(server, handshake)
      const place = yield* (yield* world).open({ servers: { fixture: remote(server.url, { disabled: true }) } })
      const connecting = yield* place.mcp.connect("fixture").pipe(Effect.forkChild({ startImmediately: true }))
      yield* gate.started
      yield* Fiber.interrupt(connecting)
      yield* gate.release
      yield* until("the connect", place.status("fixture"), (status) => status?.status === "connected")
    }),
  )

  it.live("finishes a disconnect whose caller is interrupted while the session ends", () =>
    Effect.gen(function* () {
      const server = yield* serve({ era: "legacy" })
      const place = yield* (yield* world).open({ servers: { fixture: remote(server.url) } })
      yield* place.settled("fixture")
      const gate = yield* hold(server, (request) => request.method === "DELETE")
      const disconnecting = yield* place.mcp.disconnect("fixture").pipe(Effect.forkChild({ startImmediately: true }))
      yield* gate.started
      yield* Fiber.interrupt(disconnecting)
      yield* gate.release
      yield* until("the disconnect", place.status("fixture"), (status) => status?.status === "disabled")
      expect(yield* place.mcp.tools()).toEqual([])
    }),
  )

  for (const operation of ["connect", "disconnect"] as const)
    it.live(`keeps a ${operation} made during startup over the startup queued before it`, () =>
      Effect.gen(function* () {
        const server = yield* serve({ era: "modern" })
        const places = yield* world
        const entered = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined))
        // Holding the disabled server's status pauses startup after every server exists, before the other's connect is
        // queued.
        const stop = yield* places.bus.listen((event) =>
          event.type === McpEvent.StatusChanged.type &&
          Schema.decodeUnknownSync(McpEvent.StatusChanged.data)(event.data).server === "gate"
            ? Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)))
            : Effect.void,
        )
        const place = yield* places.open({ unconfigured: true })
        const starting = yield* place.mcp
          .transform((editor) => {
            editor.set("gate", local())
            editor.set("fixture", remote(server.url))
          })
          .pipe(Effect.forkChild({ startImmediately: true }))
        yield* Deferred.await(entered)
        // Whoever waits for the startup is released by the operation, not by the end of the startup window.
        const waiting = yield* place.mcp.awaitStartup().pipe(Effect.forkChild({ startImmediately: true }))
        yield* place.mcp[operation]("fixture")
        yield* Effect.promise(() => Bun.sleep(10))
        expect(waiting.pollUnsafe()).toBeDefined()
        yield* Deferred.succeed(release, undefined)
        yield* Fiber.join(starting)
        yield* stop
        // Waits for the queued startup, which holds or awaits the server's lock.
        yield* place.mcp.disconnect("fixture")
        expect(server.seen.discovers).toBe(operation === "connect" ? 1 : 0)
        expect(yield* place.status("fixture")).toEqual({ status: "disabled" })
      }),
    )

  it.live("keeps a replacement's config while a later transform waits for it", () =>
    Effect.gen(function* () {
      const server = yield* serve({ era: "modern" })
      const gate = yield* hold(server, handshake)
      const place = yield* (yield* world).open({ servers: { fixture: remote(server.url, { disabled: true }) } })
      const enabling = yield* place.mcp
        .transform((editor) => editor.update("fixture", (item) => (item.disabled = false)))
        .pipe(Effect.forkChild({ startImmediately: true }))
      yield* gate.started
      const accepted = yield* Deferred.make<void>()
      const disabling = yield* State.batch(
        place.mcp
          .transform((editor) => editor.update("fixture", (item) => (item.disabled = true)))
          .pipe(Effect.andThen(Deferred.succeed(accepted, undefined))),
      ).pipe(Effect.forkChild({ startImmediately: true }))
      yield* Deferred.await(accepted)
      expect(yield* place.status("fixture")).toEqual({ status: "pending" })
      yield* gate.release
      yield* Fiber.join(enabling)
      yield* Fiber.join(disabling)
      expect(yield* place.status("fixture")).toEqual({ status: "disabled" })
      expect(server.seen.discovers).toBe(1)
    }),
  )

  it.live("publishes nothing for a Location once it shuts down", () =>
    Effect.gen(function* () {
      const server = yield* serve({ era: "modern" })
      const places = yield* world
      const place = yield* places.open({ servers: { fixture: remote(server.url) } })
      yield* place.settled("fixture")
      const published: string[] = []
      const stop = yield* places.bus.listen((event) =>
        Effect.sync(() => {
          if (event.location?.directory === place.directory && event.type.startsWith("mcp.")) published.push(event.type)
        }),
      )
      yield* place.mcp.callTool({ server: "fixture", name: "change" })
      yield* until(
        "the change",
        Effect.sync(() => published),
        (list) => list.includes(McpEvent.ToolsChanged.type),
      )
      published.length = 0
      yield* place.close
      yield* stop
      expect(published).toEqual([])
    }),
  )
})

describe("MCP startup", () => {
  it.effect("lets a model call wait for a server still connecting, within its startup window", () =>
    Effect.gen(function* () {
      const server = yield* serve({ era: "modern" })
      const gate = yield* hold(server, handshake)
      const place = yield* (yield* world).open({ servers: { fixture: remote(server.url, { codemode: false }) } })
      yield* gate.started
      const flush = yield* place.mcpTool.flush.pipe(Effect.forkChild({ startImmediately: true }))
      yield* Effect.promise(() => Bun.sleep(10))
      expect(flush.pollUnsafe()).toBeUndefined()
      yield* gate.release
      yield* Fiber.join(flush)
      expect((yield* place.tools.list()).map((tool) => tool.id)).toContain("fixture_echo")
    }),
  )

  it.effect("stops waiting for a server once its startup window ends", () =>
    Effect.gen(function* () {
      const server = yield* serve({ era: "modern" })
      const gate = yield* hold(server, handshake)
      const place = yield* (yield* world).open({ servers: { fixture: remote(server.url) } })
      yield* gate.started
      const flush = yield* place.mcpTool.flush.pipe(Effect.forkChild({ startImmediately: true }))
      yield* TestClock.adjust("1999 millis")
      expect(flush.pollUnsafe()).toBeUndefined()
      yield* TestClock.adjust("1 millis")
      yield* Fiber.join(flush)
      // Past its window, a server still pending holds nothing up.
      yield* place.mcpTool.flush
      expect(yield* place.status("fixture")).toEqual({ status: "pending" })
      // Closing the Location waits for the held handshake.
      yield* gate.release

      // Nor does a server whose registration failed.
      const failing = yield* (yield* world).open({
        integration: integration(() => Effect.die("integration unavailable")),
      })
      yield* failing.mcp.add("remote", remote(server.url, { oauth: undefined })).pipe(Effect.exit)
      const waiting = yield* failing.mcp.awaitStartup().pipe(Effect.forkChild({ startImmediately: true }))
      yield* Effect.yieldNow
      expect(waiting.pollUnsafe()).toBeDefined()
    }),
  )
})
