import { expect } from "bun:test"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { PluginPromise } from "@opencode/core/plugin/promise"
import { Session } from "@opencode/core/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

it.live("Effect plugins can admit session compaction", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const sessions = yield* Session.Service
    const context = yield* PluginHost.make(plugins)
    const created = yield* context.session.create({ title: "Plugin compaction" })
    const id = SessionMessage.ID.create()

    const admitted = yield* context.session.compact({ sessionID: created.id, id, delivery: "queue" })

    expect(admitted).toMatchObject({ id, sessionID: created.id, type: "compaction", delivery: "queue" })
    expect(yield* sessions.inbox(created.id)).toContainEqual(admitted)
    expect(yield* context.session.compact({ sessionID: Session.ID.create() }).pipe(Effect.flip)).toMatchObject({
      _tag: "Session.NotFoundError",
    })
  }),
)

it.live("Promise plugins can admit session compaction", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const sessions = yield* Session.Service
    const context = yield* PluginHost.make(plugins)
    const created = yield* context.session.create({ title: "Promise plugin compaction" })
    const id = SessionMessage.ID.create()

    yield* PluginPromise.fromPromise({
      id: "test.session-compact",
      async setup(ctx) {
        const admitted = await ctx.session.compact({ sessionID: created.id, id })
        expect(admitted).toMatchObject({ id, sessionID: created.id, type: "compaction", delivery: "steer" })
        await expect(ctx.session.compact({ sessionID: Session.ID.create() })).rejects.toThrow()
      },
    }).effect(context)

    expect(yield* sessions.inbox(created.id)).toContainEqual(
      expect.objectContaining({ id, type: "compaction", delivery: "steer" }),
    )
  }),
)
