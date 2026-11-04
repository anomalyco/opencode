import { expect } from "bun:test"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { Rpc } from "@opencode/core/rpc"
import { AbsolutePath } from "@opencode/schema/schema"
import { Browser } from "@opencode/plugin-browser/rpc"
import { Deferred, Effect, Exit, Fiber, Scope, Stream } from "effect"
import { BrowserConnection } from "../../../plugin-browser/src/connection"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)
const access = [
  { action: "browser", resource: "*", effect: "allow" },
  { action: "skill", resource: "browser", effect: "allow" },
] as const

it.live("starting another location leaves a live browser attachment's grants intact", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const host = yield* PluginHost.make(plugins, "test")
    const service = yield* Rpc.Service
    const rpc = service.client(Browser.Definition)
    const connection = yield* BrowserConnection.make(host)
    const session = yield* host.session.create({})
    const attached = yield* Deferred.make<void>()
    yield* rpc.events.subscribe("control").pipe(
      Stream.runForEach((event) =>
        event.data.type === "attached" ? Deferred.succeed(attached, undefined) : Effect.void,
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
    const pending = yield* rpc
      .attach({ sessionID: session.id, connectionID: "first", version: 4 })
      .pipe(Effect.forkScoped)
    yield* Deferred.await(attached)
    expect((yield* host.session.get({ sessionID: session.id })).permissions).toEqual(access)
    const directory = AbsolutePath.make(`${host.location.directory}/other`)
    const stale = yield* host.session.create({ location: { directory }, permissions: access })
    yield* BrowserConnection.make({
      ...host,
      location: { ...host.location, directory },
    })
    expect((yield* host.session.get({ sessionID: session.id })).permissions).toEqual(access)
    expect((yield* host.session.get({ sessionID: stale.id })).permissions).toEqual([])
    expect(pending.pollUnsafe()).toBeUndefined()
    yield* connection.target(session.id, { type: "tabs.list" })
    yield* Fiber.interrupt(pending)
  }),
)

it.live("a replaced attachment removes only its grants and preserves ordered user permissions", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const host = yield* PluginHost.make(plugins, "test")
    const service = yield* Rpc.Service
    const rpc = service.client(Browser.Definition)
    const release = yield* Deferred.make<void>()
    const releasing = yield* Deferred.make<void>()
    const first = yield* Deferred.make<void>()
    const second = yield* Deferred.make<void>()
    // The first RPC handler owns its grant finalizer. Hold that finalizer before reading
    // permissions until the replacement has appended its own grants.
    const old = { fiber: -1, blocked: false }
    yield* BrowserConnection.make({
      ...host,
      session: {
        ...host.session,
        get: (input) =>
          Effect.gen(function* () {
            const id = yield* Effect.fiberId
            if (old.fiber === -1) old.fiber = id
            if (old.blocked && id === old.fiber) {
              yield* Deferred.succeed(releasing, undefined)
              yield* Deferred.await(release)
            }
            return yield* host.session.get(input)
          }),
      },
    })
    const baseline = [
      ...access,
      { action: "browser", resource: "*", effect: "deny" },
      { action: "skill", resource: "browser", effect: "deny" },
      { action: "edit", resource: "*", effect: "ask" },
    ] as const
    const session = yield* host.session.create({ permissions: baseline })
    yield* rpc.events.subscribe("control").pipe(
      Stream.runForEach((event) =>
        event.data.type === "attached"
          ? Deferred.succeed(event.data.connectionID === "first" ? first : second, undefined)
          : Effect.void,
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* Effect.gen(function* () {
      const pending = yield* rpc
        .attach({ sessionID: session.id, connectionID: "first", version: 4 })
        .pipe(Effect.forkScoped)
      yield* Deferred.await(first)
      old.blocked = true
      const replacement = yield* rpc
        .attach({ sessionID: session.id, connectionID: "second", version: 4 })
        .pipe(Effect.forkScoped)
      yield* Deferred.await(releasing)
      yield* Deferred.await(second)
      expect((yield* host.session.get({ sessionID: session.id })).permissions).toEqual([
        ...baseline,
        ...access,
        ...access,
      ])
      yield* Deferred.succeed(release, undefined)
      expect(yield* Fiber.join(pending)).toBe("replaced")
      expect((yield* host.session.get({ sessionID: session.id })).permissions).toEqual([...baseline, ...access])
      yield* Fiber.interrupt(replacement)
      expect((yield* host.session.get({ sessionID: session.id })).permissions).toEqual(baseline)
    }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)))
  }),
)

for (const replaced of [false, true]) {
  it.live(`browser teardown waits for ${replaced ? "a replaced" : "its active"} attachment's grant cleanup`, () =>
    Effect.gen(function* () {
      const plugins = yield* Plugin.Service
      const host = yield* PluginHost.make(plugins, "test")
      const service = yield* Rpc.Service
      const rpc = service.client(Browser.Definition)
      const scope = yield* Scope.make()
      const release = yield* Deferred.make<void>()
      const releasing = yield* Deferred.make<void>()
      const first = yield* Deferred.make<void>()
      const second = yield* Deferred.make<void>()
      const third = yield* Deferred.make<void>()
      const old = { fiber: -1, blocked: false }
      yield* BrowserConnection.make({
        ...host,
        session: {
          ...host.session,
          get: (input) =>
            Effect.gen(function* () {
              const id = yield* Effect.fiberId
              if (old.fiber === -1) old.fiber = id
              if (old.blocked && old.fiber === id) {
                yield* Deferred.succeed(releasing, undefined)
                yield* Deferred.await(release)
              }
              return yield* host.session.get(input)
            }),
        },
      }).pipe(Effect.provideService(Scope.Scope, scope))
      const session = yield* host.session.create({})
      yield* rpc.events.subscribe("control").pipe(
        Stream.runForEach((event) =>
          event.data.type === "attached"
            ? Deferred.succeed(
                event.data.connectionID === "first" ? first : event.data.connectionID === "second" ? second : third,
                undefined,
              )
            : Effect.void,
        ),
        Effect.forkScoped({ startImmediately: true }),
      )
      yield* Effect.gen(function* () {
        const pending = yield* rpc
          .attach({ sessionID: session.id, connectionID: "first", version: 4 })
          .pipe(Effect.forkScoped)
        yield* Deferred.await(first)
        old.blocked = true
        const replacement = replaced
          ? yield* rpc.attach({ sessionID: session.id, connectionID: "second", version: 4 }).pipe(Effect.forkScoped)
          : undefined
        if (replacement) {
          yield* Deferred.await(releasing)
          yield* Deferred.await(second)
        }
        const closing = yield* Scope.close(scope, Exit.void).pipe(Effect.forkScoped({ startImmediately: true }))
        yield* Deferred.await(releasing)
        // Let teardown reach its completion wait while the old finalizer remains blocked.
        yield* Effect.yieldNow
        expect(closing.pollUnsafe()).toBeUndefined()
        expect(pending.pollUnsafe()).toBeUndefined()
        yield* Deferred.succeed(release, undefined)
        yield* Fiber.join(closing)
        expect(yield* Fiber.join(pending)).toBe(replaced ? "replaced" : "closed")
        if (replacement) expect(yield* Fiber.join(replacement)).toBe("closed")
        expect((yield* host.session.get({ sessionID: session.id })).permissions).toEqual([])

        yield* BrowserConnection.make(host)
        const resumed = yield* rpc
          .attach({ sessionID: session.id, connectionID: "third", version: 4 })
          .pipe(Effect.forkScoped)
        yield* Deferred.await(third)
        expect((yield* host.session.get({ sessionID: session.id })).permissions).toEqual(access)
        yield* Fiber.interrupt(resumed)
        expect((yield* host.session.get({ sessionID: session.id })).permissions).toEqual([])
      }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)))
    }),
  )
}
