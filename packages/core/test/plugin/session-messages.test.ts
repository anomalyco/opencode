import { expect } from "bun:test"
import { Database } from "@opencode/core/database/database"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { PluginPromise } from "@opencode/core/plugin/promise"
import { Session } from "@opencode/core/session"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionMessageTable } from "@opencode/core/session/sql"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

it.live("Promise and Effect plugins can follow the same filtered transcript page forward and backward", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const host = yield* PluginHost.make(plugins, "test")
    const session = yield* host.session.create({ title: "Message pages" })
    const { db } = yield* Database.Service
    const ids = [SessionMessage.ID.create(), SessionMessage.ID.create(), SessionMessage.ID.create()] as const
    const location = { directory: host.location.directory, workspaceID: "wrk_internal" }
    const rows = ids.map((id, i) => ({
      id,
      session_id: session.id,
      type: i === 1 ? ("location-switched" as const) : ("user" as const),
      seq: 100 + i,
      data: {
        ...(i === 1 ? { location, previous: { location } } : { text: `message ${i}` }),
        time: { created: 300 - i },
      },
    }))
    yield* db.insert(SessionMessageTable).values(rows).run()
    const input = { sessionID: session.id, limit: 1, type: "user" } as const
    const first = yield* host.session.message.list(input)
    expect(first.data.map((m) => m.id)).toEqual([ids[2]])
    const moves = yield* host.session.message.list({ sessionID: session.id, type: "location-switched" })
    const move = moves.data.find((m) => m.type === "location-switched" && m.id === ids[1])
    expect(move).toBeDefined()
    if (move?.type === "location-switched") {
      expect(move.location).toEqual({ directory: location.directory })
      expect(move.previous?.location).toEqual({ directory: location.directory })
    }
    expect(yield* host.session.message.list({ ...input, limit: 201 }).pipe(Effect.flip)).toMatchObject({
      _tag: "SchemaError",
    })
    expect(yield* host.session.message.list({ ...input, cursor: "invalid" }).pipe(Effect.flip)).toMatchObject({
      _tag: "InvalidCursorError",
    })
    expect(
      yield* host.session.message.list({ ...input, sessionID: Session.ID.create() }).pipe(Effect.flip),
    ).toMatchObject({ _tag: "SessionNotFoundError" })
    yield* PluginPromise.fromPromise({
      id: "test.session-messages",
      async setup(ctx) {
        expect(first.cursor.next).toBeString()
        const next = await ctx.session.message.list({ ...input, cursor: first.cursor.next })
        expect(next.data.map((m) => m.id)).toEqual([ids[0]])
        expect(next.cursor.previous).toBeString()
        const previous = await ctx.session.message.list({ ...input, cursor: next.cursor.previous ?? undefined })
        expect(previous.data.map((m) => m.id)).toEqual([ids[2]])
        const end = await ctx.session.message.list({ ...input, cursor: next.cursor.next ?? undefined })
        expect(end).toEqual({ data: [], cursor: { previous: null, next: null } })
        await expect(
          ctx.session.message.list({ ...input, order: "desc", cursor: first.cursor.next }),
        ).rejects.toMatchObject({ _tag: "InvalidCursorError" })
      },
    }).effect(host)
  }),
)
