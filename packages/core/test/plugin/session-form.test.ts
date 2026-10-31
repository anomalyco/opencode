import { expect } from "bun:test"
import { Form } from "@opencode/core/form"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { PluginPromise } from "@opencode/core/plugin/promise"
import { Session } from "@opencode/core/session"
import { Effect, Fiber } from "effect"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const fields = [
  {
    key: "choice",
    type: "string",
    title: "Choice",
    options: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
    ],
    custom: true,
  },
] satisfies Form.Fields

it.live("Effect plugins can list, get, reply to, and cancel session forms", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const forms = yield* Form.Service
    const context = yield* PluginHost.make(plugins)
    const session = yield* context.session.create({ title: "Forms" })
    const other = yield* context.session.create({ title: "Other" })

    const form = yield* forms.create({ sessionID: session.id, title: "Deploy?", fields })
    expect(yield* context.session.form.list({ sessionID: session.id })).toEqual([form])
    expect(yield* context.session.form.get({ sessionID: session.id, formID: form.id })).toMatchObject({
      id: form.id,
      state: { status: "pending" },
    })

    for (const operation of [
      context.session.form.get({ sessionID: other.id, formID: form.id }),
      context.session.form.reply({ sessionID: other.id, formID: form.id, answer: { choice: "yes" } }),
      context.session.form.cancel({ sessionID: other.id, formID: form.id }),
    ]) {
      expect(yield* operation.pipe(Effect.flip)).toMatchObject({
        _tag: "Form.NotFoundError",
        id: form.id,
      })
    }

    const missing = Session.ID.create()
    for (const operation of [
      context.session.form.list({ sessionID: missing }),
      context.session.form.get({ sessionID: missing, formID: form.id }),
      context.session.form.reply({ sessionID: missing, formID: form.id, answer: { choice: "yes" } }),
      context.session.form.cancel({ sessionID: missing, formID: form.id }),
    ]) {
      expect(yield* operation.pipe(Effect.flip)).toMatchObject({
        _tag: "Session.NotFoundError",
        sessionID: missing,
      })
    }

    yield* context.session.form.reply({ sessionID: session.id, formID: form.id, answer: { choice: "yes" } })
    expect(yield* context.session.form.list({ sessionID: session.id })).toEqual([])
    expect(yield* context.session.form.get({ sessionID: session.id, formID: form.id })).toMatchObject({
      state: { status: "answered", answer: { choice: "yes" } },
    })

    const cancelled = yield* forms.create({ sessionID: session.id, title: "Cancel?", fields })
    yield* context.session.form.cancel({ sessionID: session.id, formID: cancelled.id, message: "not needed" })
    expect(yield* context.session.form.get({ sessionID: session.id, formID: cancelled.id })).toMatchObject({
      state: { status: "cancelled", message: "not needed" },
    })
  }),
)

it.live("Effect plugins settle a form started by Form.ask", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const forms = yield* Form.Service
    const context = yield* PluginHost.make(plugins)
    const session = yield* context.session.create({ title: "Forms" })

    const fiber = yield* forms
      .ask({ sessionID: session.id, title: "Deploy?", fields })
      .pipe(Effect.forkChild({ startImmediately: true }))
    const pending = yield* context.session.form.list({ sessionID: session.id })
    expect(pending).toHaveLength(1)
    yield* context.session.form.reply({
      sessionID: session.id,
      formID: pending[0].id,
      answer: { choice: "yes" },
    })
    expect(yield* Fiber.join(fiber)).toMatchObject({
      status: "answered",
      answer: { choice: "yes" },
    })
  }),
)

it.live("Promise plugins can list, reply to, and cancel session forms through the adapter", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const forms = yield* Form.Service
    const context = yield* PluginHost.make(plugins)
    const session = yield* context.session.create({ title: "Forms" })
    const form = yield* forms.create({ sessionID: session.id, title: "Deploy?", fields })
    const cancelled = yield* forms.create({ sessionID: session.id, title: "Cancel?", fields })

    yield* PluginPromise.fromPromise({
      id: "test.session-form",
      async setup(ctx) {
        const pending = await ctx.session.form.list({ sessionID: session.id })
        expect(pending.map((item) => item.id).sort()).toEqual([form.id, cancelled.id].sort())
        await ctx.session.form.reply({ sessionID: session.id, formID: form.id, answer: { choice: "yes" } })
        expect(await ctx.session.form.get({ sessionID: session.id, formID: form.id })).toMatchObject({
          state: { status: "answered", answer: { choice: "yes" } },
        })
        await ctx.session.form.cancel({ sessionID: session.id, formID: cancelled.id, message: "not needed" })
        expect(await ctx.session.form.get({ sessionID: session.id, formID: cancelled.id })).toMatchObject({
          state: { status: "cancelled", message: "not needed" },
        })
      },
    }).effect(context)
  }),
)
