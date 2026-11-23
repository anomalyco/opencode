import { expect } from "bun:test"
import { Automation } from "@opencode/core/automation"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { PluginPromise } from "@opencode/core/plugin/promise"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

it.live("Effect plugins can create, list and delete automations", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const automations = yield* Automation.Service
    const context = yield* PluginHost.make(plugins, "test")
    const session = yield* context.session.create({ title: "Effect automation target" })

    const created = yield* context.experimental.automation.create({
      directory: context.location.directory,
      name: "effect inbox",
      trigger: { type: "cron", cron: "0 * * * *", tz: "Europe/Madrid" },
      action: { type: "prompt", prompt: "Clean up the inboxes now.", to: { session: session.id } },
    })

    expect(created).toMatchObject({
      name: "effect inbox",
      status: "active",
      trigger: { type: "cron", cron: "0 * * * *" },
      action: { type: "prompt", prompt: "Clean up the inboxes now.", to: { session: session.id } },
    })
    const listed = yield* context.experimental.automation.list({ directory: context.location.directory })
    expect(listed.map((item) => item.id)).toContain(created.id)

    yield* context.experimental.automation.delete({ automationID: created.id })
    expect((yield* automations.list()).map((item) => item.id)).not.toContain(created.id)
  }),
)

it.live("Promise plugins can create, list and delete automations", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const automations = yield* Automation.Service
    const context = yield* PluginHost.make(plugins, "test")
    const session = yield* context.session.create({ title: "Promise automation target" })
    const ids: string[] = []

    yield* PluginPromise.fromPromise({
      id: "test.automation",
      async setup(ctx) {
        const created = await ctx.experimental.automation.create({
          directory: ctx.location.directory,
          name: "promise inbox",
          trigger: { type: "cron", cron: "0 9 * * *" },
          action: { type: "prompt", prompt: "Check the balance now.", to: { session: session.id } },
        })
        ids.push(created.id)
        expect(created).toMatchObject({ name: "promise inbox", action: { to: { session: session.id } } })
        expect(
          (await ctx.experimental.automation.list({ directory: ctx.location.directory })).map((item) => item.id),
        ).toContain(created.id)
        await ctx.experimental.automation.delete({ automationID: created.id })
        await expect(ctx.experimental.automation.delete({ automationID: created.id })).rejects.toThrow()
      },
    }).effect(context)

    expect(ids).toHaveLength(1)
    expect((yield* automations.list()).map((item) => item.id)).not.toContain(ids[0])
  }),
)
