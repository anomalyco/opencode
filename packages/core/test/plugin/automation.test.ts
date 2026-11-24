import { expect } from "bun:test"
import { Agent } from "@opencode/core/agent"
import { Automation } from "@opencode/core/automation"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Plugin } from "@opencode/core/plugin"
import { AgentPlugin } from "@opencode/core/plugin/agent"
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

it.live("a plugin can create a subagent prompt automation while its Location activates", () =>
  Effect.gen(function* () {
    const automations = yield* Automation.Service
    const location = yield* Location.Service
    const locations = yield* LocationServiceMap.Service
    const loaded: string[] = []
    const triage = {
      name: "triage",
      trigger: { type: "every", every: "1 hour" },
      action: { type: "prompt", prompt: "Triage the inbox.", to: { subagent: Agent.ID.make("general") } },
    } as const

    // Activate the Location's own plugins, the ones a create in that Location used to wait for.
    yield* Effect.gen(function* () {
      const plugins = yield* Plugin.Service
      yield* plugins.awaitActivation
      yield* plugins.activate([
        { ...AgentPlugin.Plugin, revision: "1" },
        {
          id: "test.automation.effect",
          revision: "1",
          effect: (ctx) =>
            Effect.gen(function* () {
              const session = yield* ctx.session.create({ title: "Effect subagent automation" })
              yield* ctx.experimental.automation.create({ ...triage, sessionID: session.id, name: "effect triage" })
              loaded.push("effect")
            }).pipe(Effect.orDie),
        },
        {
          revision: "1",
          ...PluginPromise.fromPromise({
            id: "test.automation.promise",
            async setup(ctx) {
              const session = await ctx.session.create({ title: "Promise subagent automation" })
              await ctx.experimental.automation.create({ ...triage, sessionID: session.id, name: "promise triage" })
              loaded.push("promise")
            },
          }),
        },
        { id: "test.automation.after", revision: "1", effect: () => Effect.sync(() => loaded.push("after")) },
      ])
    }).pipe(
      Effect.provide(locations.get(LocationServiceMap.canonical({ directory: location.directory }))),
      Effect.timeout("10 seconds"),
    )

    expect(loaded).toEqual(["effect", "promise", "after"])
    expect((yield* automations.list()).map((item) => item.name)).toEqual(
      expect.arrayContaining(["effect triage", "promise triage"]),
    )
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
