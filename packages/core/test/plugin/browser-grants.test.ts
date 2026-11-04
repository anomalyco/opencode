import { expect } from "bun:test"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { Rpc } from "@opencode/core/rpc"
import { AbsolutePath } from "@opencode/schema/schema"
import type { Session } from "@opencode/schema/session"
import { Browser } from "@opencode/plugin-browser/rpc"
import { Context, Deferred, Effect, Exit, Fiber, Scope, Stream } from "effect"
import { BrowserConnection } from "../../../plugin-browser/src/connection"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)
const access = [
  { action: "browser", resource: "*", effect: "allow" },
  { action: "skill", resource: "browser", effect: "allow" },
] as const
const held = Context.Reference<boolean>("test/browser-grants/held", { defaultValue: () => false })
const setup = Effect.fn(function* () {
  const plugins = yield* Plugin.Service
  const host = yield* PluginHost.make(plugins, "test")
  const service = yield* Rpc.Service
  return { host, rpc: service.client(Browser.Definition) }
})
const attach = Effect.fn(function* (rpc: Effect.Success<ReturnType<typeof setup>>["rpc"], sessionID: Session.ID) {
  const connectionID = crypto.randomUUID()
  const attached = yield* rpc.events.subscribe("control").pipe(
    Stream.filter((event) => event.data.type === "attached" && event.data.connectionID === connectionID),
    Stream.take(1),
    Stream.runDrain,
    Effect.forkScoped({ startImmediately: true }),
  )
  const pending = yield* rpc.attach({ sessionID, connectionID, version: 4 }).pipe(Effect.forkScoped)
  yield* Fiber.join(attached)
  return pending
})

it.live("starting another location leaves a live browser attachment's grants intact", () =>
  Effect.gen(function* () {
    const { host, rpc } = yield* setup()
    const connection = yield* BrowserConnection.make(host)
    const session = yield* host.session.create({})
    const pending = yield* attach(rpc, session.id)
    const directory = AbsolutePath.make(`${host.location.directory}/other`)
    const stale = yield* host.session.create({ location: { directory }, permissions: access })
    yield* BrowserConnection.make({ ...host, location: { ...host.location, directory } })
    expect((yield* host.session.get({ sessionID: session.id })).permissions).toEqual(access)
    expect((yield* host.session.get({ sessionID: stale.id })).permissions).toEqual([])
    yield* connection.target(session.id, { type: "tabs.list" })
    yield* Fiber.interrupt(pending)
  }),
)

it.live("a replaced attachment preserves its replacement's grants and ordered user permissions", () =>
  Effect.gen(function* () {
    const { host, rpc } = yield* setup()
    yield* BrowserConnection.make(host)
    const baseline = [
      ...access,
      { action: "browser", resource: "*", effect: "deny" },
      { action: "skill", resource: "browser", effect: "deny" },
      { action: "edit", resource: "*", effect: "ask" },
    ] as const
    const session = yield* host.session.create({ permissions: baseline })
    const first = yield* attach(rpc, session.id)
    const replacement = yield* attach(rpc, session.id)
    expect(yield* Fiber.join(first)).toBe("replaced")
    expect((yield* host.session.get({ sessionID: session.id })).permissions).toEqual([...baseline, ...access])
    yield* Fiber.interrupt(replacement)
    expect((yield* host.session.get({ sessionID: session.id })).permissions).toEqual(baseline)
  }),
)

for (const replaced of [false, true]) {
  it.live(`browser teardown waits for ${replaced ? "a replaced" : "its active"} attachment's grant cleanup`, () =>
    Effect.gen(function* () {
      const { host, rpc } = yield* setup()
      const scope = yield* Scope.make()
      const release = yield* Deferred.make<void>()
      const releasing = yield* Deferred.make<void>()
      const entered = yield* Deferred.make<void>()
      const continueClose = yield* Deferred.make<void>()
      const closed = yield* Deferred.make<void>()
      const register: typeof host.rpc.register = (definition, handlers) =>
        Effect.addFinalizer(() =>
          Effect.gen(function* () {
            // Queue the signal so teardown is parked before the test resumes.
            yield* Deferred.succeed(entered, undefined).pipe(Effect.forkChild)
            yield* Deferred.await(continueClose)
          }),
        ).pipe(Effect.andThen(host.rpc.register(definition, handlers)))
      const gate = { enabled: false }
      yield* BrowserConnection.make({
        ...host,
        rpc: Object.assign(host.rpc.bind(undefined), { register }),
        agent: {
          ...host.agent,
          // Mark the end of browser teardown before agent-transform notifications can suspend it.
          transform: (callback) =>
            host.agent
              .transform(callback)
              .pipe(Effect.tap(() => Effect.addFinalizer(() => Deferred.succeed(closed, undefined)))),
        },
        session: {
          ...host.session,
          get: (input) =>
            Effect.gen(function* () {
              if (gate.enabled && (yield* held)) {
                yield* Deferred.succeed(releasing, undefined)
                yield* Deferred.await(release)
              }
              return yield* host.session.get(input)
            }),
        },
      }).pipe(Effect.provideService(Scope.Scope, scope))
      const session = yield* host.session.create({})
      yield* Effect.gen(function* () {
        // Tag the request explicitly rather than guessing which runtime fiber owns its finalizer.
        const first = yield* attach(rpc, session.id).pipe(Effect.provideService(held, true))
        gate.enabled = true
        if (replaced) {
          const replacement = yield* attach(rpc, session.id)
          yield* Deferred.await(releasing)
          // Only the replaced handler remains, so teardown must track it outside the live browser map.
          yield* Fiber.interrupt(replacement)
        }
        const closing = yield* Scope.close(scope, Exit.void).pipe(Effect.forkScoped({ startImmediately: true }))
        // This signal follows event/RPC disposal and parks just before BrowserConnection's finalizer.
        yield* Deferred.await(entered)
        yield* Deferred.succeed(continueClose, undefined)
        yield* Deferred.await(releasing)
        // Only the browser finalizer lies between this handshake and the closed marker.
        closing.currentDispatcher.flush()
        expect(yield* Deferred.isDone(closed)).toBe(false)
        yield* Deferred.succeed(release, undefined)
        yield* Fiber.join(closing)
        expect(yield* Deferred.isDone(closed)).toBe(true)
        expect(yield* Fiber.join(first)).toBe(replaced ? "replaced" : "closed")
        expect((yield* host.session.get({ sessionID: session.id })).permissions).toEqual([])
        yield* BrowserConnection.make(host)
        const reloaded = yield* attach(rpc, session.id)
        expect((yield* host.session.get({ sessionID: session.id })).permissions).toEqual(access)
        yield* Fiber.interrupt(reloaded)
      }).pipe(
        Effect.ensuring(Deferred.succeed(continueClose, undefined)),
        Effect.ensuring(Deferred.succeed(release, undefined)),
      )
    }),
  )
}
