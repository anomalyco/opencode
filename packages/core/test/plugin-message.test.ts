import { expect } from "bun:test"
import { Bus } from "@opencode/core/bus"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { SessionEvent } from "@opencode/core/session/event"
import { fromPromise } from "@opencode/plugin/promise/adapter"
import { Effect } from "effect"
import { testEffect } from "./lib/effect"
import { PluginTestLayer } from "./plugin/fixture"

const it = testEffect(PluginTestLayer)

it.effect("exposes session messages through the plugin host", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const bus = yield* Bus.Service
    const host = yield* PluginHost.make(plugins)
    const session = yield* host.session.create({})

    const empty = yield* host.message.list({ sessionID: session.id })
    expect(empty.data).toEqual([])

    yield* bus.publish(SessionEvent.Synthetic, { sessionID: session.id, text: "hello" })
    const listed = yield* host.message.list({ sessionID: session.id })
    expect(listed.data.length).toBe(1)
    const first = listed.data[0]
    if (!first || first.type !== "synthetic") return yield* Effect.die("expected synthetic message")
    expect(first.text).toBe("hello")
    expect(listed.cursor.previous).toBeDefined()
    expect(listed.cursor.next).toBeDefined()

    const fetched = yield* host.session.message.get({ sessionID: session.id, messageID: first.id })
    expect(fetched.id).toBe(first.id)

    const missing = yield* host.session.message
      .get({ sessionID: session.id, messageID: first.id.replace(/^msg_/, "msg_missing_") as typeof first.id })
      .pipe(Effect.flip)
    expect(String(missing)).toContain("Message not found")

    const invalid = yield* host.message.list({ sessionID: session.id, cursor: "invalid" }).pipe(Effect.flip)
    expect(String(invalid)).toContain("Invalid cursor")

    const combined = yield* host.message
      .list({ sessionID: session.id, cursor: listed.cursor.next, order: "asc" })
      .pipe(Effect.flip)
    expect(String(combined)).toContain("Cursor cannot be combined")
  }),
)

it.effect("exposes session messages to promise plugins", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const bus = yield* Bus.Service
    const host = yield* PluginHost.make(plugins)
    const session = yield* host.session.create({})
    yield* bus.publish(SessionEvent.Synthetic, { sessionID: session.id, text: "hello promise" })

    const seen: string[] = []
    const definition = fromPromise({
      id: "message-list",
      async setup(ctx) {
        const listed = await ctx.message.list({ sessionID: session.id })
        const first = listed.data[0]
        if (first?.type === "synthetic") seen.push(first.text)
        if (first) {
          const fetched = await ctx.session.message.get({ sessionID: session.id, messageID: first.id })
          if (fetched.type === "synthetic") seen.push(fetched.text)
        }
      },
    })
    yield* definition.effect(host)

    expect(seen).toEqual(["hello promise", "hello promise"])
  }),
)
