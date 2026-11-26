import { expect } from "bun:test"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { Session } from "@opencode/core/session"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

it.live("plugins archive sessions through session.update", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const sessions = yield* Session.Service
    const context = yield* PluginHost.make(plugins)
    const session = yield* context.session.create()

    yield* context.session.update({ sessionID: session.id, archived: true })
    const archived = yield* sessions.get(session.id)
    expect(archived.time.archived).toBeDefined()

    yield* context.session.update({ sessionID: session.id, title: "still archived" })
    expect((yield* sessions.get(session.id)).time.archived).toEqual(archived.time.archived)
  }),
)

it.live("plugins unarchive sessions through session.update", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const sessions = yield* Session.Service
    const context = yield* PluginHost.make(plugins)
    const session = yield* context.session.create()
    yield* sessions.archive(session.id)

    yield* context.session.update({ sessionID: session.id, archived: false })
    expect((yield* sessions.get(session.id)).time.archived).toBeUndefined()
  }),
)
