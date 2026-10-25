import { expect } from "bun:test"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { PluginPromise } from "@opencode/core/plugin/promise"
import { Session } from "@opencode/core/session"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

it.live("Effect plugins can remove sessions and their children", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const sessions = yield* Session.Service
    const context = yield* PluginHost.make(plugins)
    const parent = yield* context.session.create({ title: "Temporary worker" })
    const child = yield* sessions.create({ parentID: parent.id })
    const unrelated = yield* context.session.create({ title: "Unrelated session" })

    expect(yield* context.session.remove({ sessionID: parent.id })).toBeUndefined()

    expect(yield* sessions.get(parent.id).pipe(Effect.flip)).toMatchObject({
      _tag: "Session.NotFoundError",
      sessionID: parent.id,
    })
    expect(yield* sessions.get(child.id).pipe(Effect.flip)).toMatchObject({
      _tag: "Session.NotFoundError",
      sessionID: child.id,
    })
    expect(yield* context.session.get({ sessionID: unrelated.id })).toEqual(unrelated)
    expect(yield* context.session.remove({ sessionID: parent.id }).pipe(Effect.flip)).toMatchObject({
      _tag: "Session.NotFoundError",
      sessionID: parent.id,
    })
  }),
)

it.live("Promise plugins can remove sessions and their children", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const sessions = yield* Session.Service
    const context = yield* PluginHost.make(plugins)
    const parent = yield* context.session.create({ title: "Temporary worker" })
    const child = yield* sessions.create({ parentID: parent.id })
    const unrelated = yield* context.session.create({ title: "Unrelated session" })

    yield* PluginPromise.fromPromise({
      id: "test.session-remove",
      async setup(ctx) {
        expect(await ctx.session.remove({ sessionID: parent.id })).toBeUndefined()
        await expect(ctx.session.get({ sessionID: parent.id })).rejects.toThrow()
        await expect(ctx.session.get({ sessionID: child.id })).rejects.toThrow()
        expect(await ctx.session.get({ sessionID: unrelated.id })).toMatchObject({ id: unrelated.id })
        await expect(ctx.session.remove({ sessionID: parent.id })).rejects.toThrow()
      },
    }).effect(context)

    expect((yield* sessions.list()).data.map((session) => session.id)).toEqual([unrelated.id])
  }),
)
