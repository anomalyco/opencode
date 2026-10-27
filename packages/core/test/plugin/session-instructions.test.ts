import { expect } from "bun:test"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { PluginPromise } from "@opencode/core/plugin/promise"
import { Session } from "@opencode/core/session"
import { SessionHistory } from "@opencode/core/session/history"
import { InstructionEntry } from "@opencode/core/session/instruction-entry"
import { InstructionState } from "@opencode/core/session/instruction-state"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const prepareRequest = Effect.fnUntraced(function* (sessionID: Session.ID) {
  const { db } = yield* Database.Service
  const bus = yield* Bus.Service
  const entries = yield* InstructionEntry.Service
  const instructions = yield* entries.load(sessionID)
  yield* InstructionState.prepare(db, bus, instructions, sessionID)
  return yield* SessionHistory.entriesForRunner(db, sessionID, instructions, "local")
})

it.live("Effect plugins can put, list, and remove session instruction entries seen by the next model request", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const sessions = yield* Session.Service
    const context = yield* PluginHost.make(plugins)
    const created = yield* context.session.create({ title: "Plugin instructions" })

    yield* context.session.instructions.entry.put({
      sessionID: created.id,
      key: "deploy-target",
      value: "production",
    })
    expect(yield* context.session.instructions.entry.list({ sessionID: created.id })).toEqual([
      { key: "deploy-target", value: "production" },
    ])
    expect(yield* sessions.inbox(created.id)).toEqual([])

    const first = yield* prepareRequest(created.id)
    expect(first.initial).toBe(['<context key="deploy-target">', "production", "</context>"].join("\n"))
    expect(first.entries).toEqual([])

    yield* context.session.instructions.entry.put({
      sessionID: created.id,
      key: "deploy-target",
      value: { region: "us-east-1" },
    })
    const second = yield* prepareRequest(created.id)
    expect(second.entries.map((entry) => entry.message)).toEqual([
      expect.objectContaining({
        type: "system",
        text: [
          'The context under "deploy-target" changed and supersedes the previous value:',
          '<context key="deploy-target">',
          "{",
          '  "region": "us-east-1"',
          "}",
          "</context>",
        ].join("\n"),
      }),
    ])

    yield* context.session.instructions.entry.remove({ sessionID: created.id, key: "deploy-target" })
    expect(yield* context.session.instructions.entry.list({ sessionID: created.id })).toEqual([])

    const third = yield* prepareRequest(created.id)
    expect(third.entries.at(-1)?.message).toMatchObject({
      type: "system",
      text: 'The context under "deploy-target" no longer applies. Disregard it.',
    })
    expect(yield* sessions.inbox(created.id)).toEqual([])

    const missing = Session.ID.create()
    for (const operation of [
      context.session.instructions.entry.list({ sessionID: missing }),
      context.session.instructions.entry.put({ sessionID: missing, key: "deploy-target", value: "production" }),
      context.session.instructions.entry.remove({ sessionID: missing, key: "deploy-target" }),
    ]) {
      expect(yield* operation.pipe(Effect.flip)).toMatchObject({
        _tag: "Session.NotFoundError",
        sessionID: missing,
      })
    }
    expect(
      yield* context.session.instructions.entry
        .put({
          sessionID: created.id,
          key: "oversized",
          value: "x".repeat(InstructionEntry.MaxValueBytes),
        })
        .pipe(Effect.flip),
    ).toBeInstanceOf(InstructionEntry.ValueTooLargeError)

    for (const key of ["Bad Key", "invalid/key"]) {
      for (const operation of [
        context.session.instructions.entry.put({ sessionID: created.id, key, value: "rejected" }),
        context.session.instructions.entry.remove({ sessionID: created.id, key }),
      ]) {
        expect(yield* operation.pipe(Effect.flip)).toMatchObject({ _tag: "SchemaError" })
      }
    }
    yield* context.session.instructions.entry.put({
      sessionID: created.id,
      key: "recovered",
      value: "still works",
    })
    const fourth = yield* prepareRequest(created.id)
    expect(fourth.entries.at(-1)?.message).toMatchObject({
      type: "system",
      text: ['<context key="recovered">', "still works", "</context>"].join("\n"),
    })
  }),
)

it.live("Promise plugins can put, list, and remove session instruction entries seen by the next model request", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const sessions = yield* Session.Service
    const context = yield* PluginHost.make(plugins)
    const created = yield* context.session.create({ title: "Promise plugin instructions" })

    yield* PluginPromise.fromPromise({
      id: "test.session-instructions.put",
      async setup(ctx) {
        expect(
          await ctx.session.instructions.entry.put({
            sessionID: created.id,
            key: "team.guidelines",
            value: "Prefer small, focused changes.",
          }),
        ).toBeUndefined()
        expect(await ctx.session.instructions.entry.list({ sessionID: created.id })).toEqual([
          { key: "team.guidelines", value: "Prefer small, focused changes." },
        ])
        const missing = Session.ID.create()
        await expect(ctx.session.instructions.entry.list({ sessionID: missing })).rejects.toMatchObject({
          _tag: "Session.NotFoundError",
          sessionID: missing,
        })
        await expect(
          ctx.session.instructions.entry.put({ sessionID: missing, key: "deploy-target", value: "production" }),
        ).rejects.toMatchObject({ _tag: "Session.NotFoundError", sessionID: missing })
        await expect(
          ctx.session.instructions.entry.remove({ sessionID: missing, key: "deploy-target" }),
        ).rejects.toMatchObject({ _tag: "Session.NotFoundError", sessionID: missing })
        await expect(
          ctx.session.instructions.entry.put({
            sessionID: created.id,
            key: "invalid/key",
            value: "rejected",
          }),
        ).rejects.toMatchObject({ _tag: "SchemaError" })
        await expect(
          ctx.session.instructions.entry.remove({ sessionID: created.id, key: "invalid/key" }),
        ).rejects.toMatchObject({ _tag: "SchemaError" })
        await expect(
          ctx.session.instructions.entry.put({
            sessionID: created.id,
            key: "oversized",
            value: "x".repeat(InstructionEntry.MaxValueBytes),
          }),
        ).rejects.toBeInstanceOf(InstructionEntry.ValueTooLargeError)
      },
    }).effect(context)

    const first = yield* prepareRequest(created.id)
    expect(first.initial).toBe(
      ['<context key="team.guidelines">', "Prefer small, focused changes.", "</context>"].join("\n"),
    )
    expect(yield* sessions.inbox(created.id)).toEqual([])

    yield* PluginPromise.fromPromise({
      id: "test.session-instructions.remove",
      async setup(ctx) {
        expect(
          await ctx.session.instructions.entry.remove({
            sessionID: created.id,
            key: "team.guidelines",
          }),
        ).toBeUndefined()
        expect(await ctx.session.instructions.entry.list({ sessionID: created.id })).toEqual([])
      },
    }).effect(context)

    const second = yield* prepareRequest(created.id)
    expect(second.entries.at(-1)?.message).toMatchObject({
      type: "system",
      text: 'The context under "team.guidelines" no longer applies. Disregard it.',
    })
    expect(yield* sessions.inbox(created.id)).toEqual([])
  }),
)
