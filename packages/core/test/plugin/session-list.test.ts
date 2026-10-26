import { expect } from "bun:test"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { PluginPromise } from "@opencode/core/plugin/promise"
import { Session } from "@opencode/core/session"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

it.live("Effect plugins list sessions with the same pages as Core", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const sessions = yield* Session.Service
    const context = yield* PluginHost.make(plugins)
    const parent = yield* context.session.create({ title: "match parent" })
    yield* sessions.create({ parentID: parent.id, title: "match child" })
    yield* context.session.create({ title: "match root" })
    yield* context.session.create({ title: "different" })
    const filter = { directory: context.location.directory, parentID: null, search: "match", limit: 1 }

    const first = yield* context.session.list(filter)
    expect(first).toEqual(yield* sessions.list(filter))
    expect(yield* context.session.list({ cursor: first.cursor.next })).toEqual(
      yield* sessions.list({ cursor: first.cursor.next }),
    )
  }),
)

it.live("Promise plugins list sessions and follow cursors", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const sessions = yield* Session.Service
    const context = yield* PluginHost.make(plugins)
    const parent = yield* context.session.create({ title: "match parent" })
    yield* sessions.create({ parentID: parent.id, title: "match child" })
    yield* context.session.create({ title: "match root" })
    const roots = (yield* sessions.list({ parentID: null, search: "match" })).data.map((session) => session.id)

    yield* PluginPromise.fromPromise({
      id: "test.session-list",
      async setup(ctx) {
        const first = await ctx.session.list({ parentID: null, search: "match", limit: 1 })
        expect(first.cursor.next).toBeDefined()
        const second = await ctx.session.list({ cursor: first.cursor.next ?? undefined, limit: 1 })
        expect([...first.data, ...second.data].map((session) => session.id)).toEqual(roots)
        await expect(ctx.session.list({ cursor: "invalid" })).rejects.toThrow()
      },
    }).effect(context)
  }),
)
