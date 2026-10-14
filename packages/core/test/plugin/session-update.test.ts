import { beforeEach, expect } from "bun:test"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { PluginPromise } from "@opencode/core/plugin/promise"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionTitle } from "@opencode/core/session/title"
import { Effect, Layer } from "effect"
import { testEffect } from "../lib/effect"
import { makePluginTestLayer } from "./fixture"

const generated: Session.ID[] = []
const recorder = Layer.mock(SessionTitle.Service)({
  generate: (sessionID) => Effect.sync(() => void generated.push(sessionID)),
})
beforeEach(() => {
  generated.length = 0
})
const it = testEffect(makePluginTestLayer(undefined, recorder))
const create = (title: string, location?: { directory: AbsolutePath }) =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const context = yield* PluginHost.make(plugins)
    return { context, created: yield* context.session.create({ title, location }) }
  })
const gone = { directory: AbsolutePath.make("/nonexistent/session-update-test") }

it.live("Session.update renames with a title and applies metadata and permissions", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const { created } = yield* create("Plugin title")
    const permissions = [{ action: "read", resource: "*", effect: "allow" as const }]

    yield* sessions.update({ sessionID: created.id, title: "Renamed", metadata: { origin: "test" }, permissions })

    const session = yield* sessions.get(created.id)
    expect(session.title).toBe("Renamed")
    expect(session.metadata).toEqual({ origin: "test" })
    expect(session.permissions).toEqual(permissions)
    expect(generated).toEqual([])
  }),
)

it.live("Session.update leaves the title alone when none is given", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const { created } = yield* create("Plugin title")

    yield* sessions.update({ sessionID: created.id, metadata: { origin: "test" } })

    expect((yield* sessions.get(created.id)).title).toBe("Plugin title")
    expect(generated).toEqual([])
  }),
)

it.live("Session.update generates a title for an empty one instead of renaming to it", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const { created } = yield* create("Plugin title")

    yield* sessions.update({ sessionID: created.id, title: "" })

    expect((yield* sessions.get(created.id)).title).toBe("Plugin title")
    expect(generated).toEqual([created.id])
  }),
)

it.live("Session.update fails for a missing session", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    expect(yield* sessions.update({ sessionID: Session.ID.create(), title: "x" }).pipe(Effect.flip)).toMatchObject({
      _tag: "Session.NotFoundError",
    })
  }),
)

it.live("Session.update renames a session whose directory is missing without booting its location", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const { created } = yield* create("Gone", gone)

    yield* sessions.update({ sessionID: created.id, title: "Still gone" })

    expect((yield* sessions.get(created.id)).title).toBe("Still gone")
  }),
)

it.live("Session.update fails to generate a title when the session's directory is missing", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const { created } = yield* create("Gone", gone)

    expect(yield* sessions.update({ sessionID: created.id, title: "" }).pipe(Effect.flip)).toMatchObject({
      _tag: "FileSystem.DirectoryNotFoundError",
    })
    expect(generated).toEqual([])
  }),
)

it.live("Effect plugins regenerate a title through session.update with an empty title", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const { context, created } = yield* create("Effect plugin title")

    yield* context.session.update({ sessionID: created.id, title: "" })

    expect((yield* sessions.get(created.id)).title).toBe("Effect plugin title")
    expect(generated).toEqual([created.id])
  }),
)

it.live("Promise plugins regenerate a title through session.update with an empty title", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const { context, created } = yield* create("Promise plugin title")

    yield* PluginPromise.fromPromise({
      id: "test.session-update",
      async setup(ctx) {
        await ctx.session.update({ sessionID: created.id, title: "" })
      },
    }).effect(context)

    expect((yield* sessions.get(created.id)).title).toBe("Promise plugin title")
    expect(generated).toEqual([created.id])
  }),
)

it.live("a plugin setup awaiting an empty-title update completes while its location is activating", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const { created } = yield* create("Setup title")

    // Activate in the registry Session.update reaches, not the fixture's root registry.
    const state = yield* Effect.gen(function* () {
      const plugins = yield* Plugin.Service
      yield* plugins.awaitActivation
      yield* plugins.activate([
        {
          id: "test.setup-retitle",
          revision: "1",
          effect: (ctx) => ctx.session.update({ sessionID: created.id, title: "" }).pipe(Effect.orDie),
        },
      ])
      return (yield* plugins.list()).find((plugin) => plugin.id === "test.setup-retitle")?.state
    }).pipe(
      Effect.provide(LocationServiceMap.Service.get(created.location)),
      Effect.timeoutOrElse({ duration: "3 seconds", orElse: () => Effect.die("setup never finished") }),
    )

    expect(state).toEqual({ status: "active" })
    expect((yield* sessions.get(created.id)).title).toBe("Setup title")
    expect(generated).toEqual([created.id])
  }),
)
