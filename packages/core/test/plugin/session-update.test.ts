import { beforeEach, expect } from "bun:test"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { PluginPromise } from "@opencode/core/plugin/promise"
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
const create = (title: string) =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const context = yield* PluginHost.make(plugins)
    return { context, created: yield* context.session.create({ title }) }
  })

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

it.live("Session.update generates a title for an empty one instead of renaming to it", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const { created } = yield* create("Plugin title")

    yield* sessions.update({ sessionID: created.id, title: "" })

    expect((yield* sessions.get(created.id)).title).toBe("Plugin title")
    expect(generated).toEqual([created.id])
  }),
)

it.live("plugins generate a title through session.update with an empty title", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const { context, created } = yield* create("Plugin title")

    yield* PluginPromise.fromPromise({
      id: "test.session-update",
      async setup(ctx) {
        await ctx.session.update({ sessionID: created.id, title: "" })
      },
    }).effect(context)

    expect((yield* sessions.get(created.id)).title).toBe("Plugin title")
    expect(generated).toEqual([created.id])
  }),
)

it.live("a plugin's setup can wait on an empty-title update without deadlocking its own activation", () =>
  Effect.gen(function* () {
    const { created } = yield* create("Plugin title")

    // Session.update generates in the session's location, so the plugin has to be activated there.
    yield* Effect.gen(function* () {
      const plugins = yield* Plugin.Service
      yield* plugins.awaitActivation
      yield* plugins.activate([
        {
          id: "test.setup-update",
          revision: "1",
          effect: (ctx) => ctx.session.update({ sessionID: created.id, title: "" }).pipe(Effect.orDie),
        },
      ])
    }).pipe(Effect.provide(LocationServiceMap.Service.get(created.location)))

    expect(generated).toEqual([created.id])
  }),
)
