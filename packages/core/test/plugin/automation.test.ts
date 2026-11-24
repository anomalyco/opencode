import { expect } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { Agent } from "@opencode/core/agent"
import { Automation } from "@opencode/core/automation"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Plugin } from "@opencode/core/plugin"
import { AgentPlugin } from "@opencode/core/plugin/agent"
import { PluginHost } from "@opencode/core/plugin/host"
import { PluginPromise } from "@opencode/core/plugin/promise"
import { AbsolutePath } from "@opencode/schema/schema"
import { Deferred, Effect, Fiber, Latch } from "effect"
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

it.live("Effect plugins cannot store an automation with an invalid target", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const automations = yield* Automation.Service
    const context = yield* PluginHost.make(plugins, "test")
    const session = yield* context.session.create({ title: "Effect invalid automation" })

    // A JavaScript plugin is not held to the input type.
    const exit = yield* context.experimental.automation
      .create({
        sessionID: session.id,
        name: "empty target",
        trigger: { type: "every", every: "1 hour" },
        action: { type: "prompt", prompt: "Check in.", to: {} as never },
      })
      .pipe(Effect.exit)

    expect(exit._tag).toBe("Failure")
    expect((yield* automations.list()).map((item) => item.name)).not.toContain("empty target")
  }),
)

const setupActions = {
  code: { type: "code", code: "return" },
  subagent: { type: "prompt", prompt: "Triage the inbox.", to: { subagent: Agent.ID.make("general") } },
} as const

for (const kind of ["code", "subagent"] as const) {
  it.live(`a plugin's ${kind} automation is refused while its Location activates and created after`, () =>
    Effect.gen(function* () {
      const automations = yield* Automation.Service
      const location = yield* Location.Service
      const locations = yield* LocationServiceMap.Service
      const loaded: string[] = []
      const later: Array<() => Promise<unknown>> = []
      const input = (name: string) =>
        ({ name, trigger: { type: "every", every: "1 hour" }, action: setupActions[kind] }) as const

      // Activate the Location's own plugins. Their permissions are not all applied yet, so creates that need them fail.
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
                const session = yield* ctx.session.create({ title: `Effect ${kind} automation` })
                const create = ctx.experimental.automation.create({ ...input("effect"), sessionID: session.id })
                loaded.push(
                  yield* create.pipe(
                    Effect.match({
                      onFailure: (error) =>
                        String(error).includes("still loading") ? "effect refused" : String(error),
                      onSuccess: () => "effect created",
                    }),
                  ),
                )
                later.push(() => Effect.runPromise(create))
              }).pipe(Effect.orDie),
          },
          {
            revision: "1",
            ...PluginPromise.fromPromise({
              id: "test.automation.promise",
              async setup(ctx) {
                const session = await ctx.session.create({ title: `Promise ${kind} automation` })
                const create = () => ctx.experimental.automation.create({ ...input("promise"), sessionID: session.id })
                await create().then(
                  () => loaded.push("promise created"),
                  (error: unknown) =>
                    loaded.push(String(error).includes("still loading") ? "promise refused" : String(error)),
                )
                later.push(create)
              },
            }),
          },
          { id: "test.automation.after", revision: "1", effect: () => Effect.sync(() => loaded.push("after")) },
        ])
      }).pipe(Effect.provide(locations.get(LocationServiceMap.canonical({ directory: location.directory }))))

      expect(loaded).toEqual(["effect refused", "promise refused", "after"])
      expect((yield* automations.list()).map((item) => item.name)).toEqual([])
      yield* Effect.promise(() => Promise.all(later.map((create) => create())))
      expect((yield* automations.list()).map((item) => item.name).toSorted()).toEqual(["effect", "promise"])
    }),
  )
}

it.live("a plugin's create for another Location waits for that Location's plugins", () =>
  Effect.gen(function* () {
    const automations = yield* Automation.Service
    const location = yield* Location.Service
    const locations = yield* LocationServiceMap.Service
    const other = AbsolutePath.make(path.join(location.directory, "other"))
    yield* Effect.promise(() => mkdir(other, { recursive: true }))
    const inLocation = (directory: AbsolutePath) =>
      Effect.provide(locations.get(LocationServiceMap.canonical({ directory })))
    const gate = yield* Latch.make()
    const creating = yield* Deferred.make<void>()
    const loaded: string[] = []

    // The other Location's plugins are still activating, and one of them provides the subagent.
    yield* Plugin.awaitActivation.pipe(inLocation(other))
    const activating = yield* Effect.gen(function* () {
      const plugins = yield* Plugin.Service
      yield* plugins.activate([
        { ...AgentPlugin.Plugin, revision: "1" },
        {
          id: "test.automation.reviewer",
          revision: "1",
          effect: (ctx) =>
            gate.await.pipe(
              Effect.andThen(
                ctx.agent.transform((editor) =>
                  editor.update("reviewer", (item) => {
                    item.name = Agent.Name.make("Reviewer")
                    item.mode = "subagent"
                  }),
                ),
              ),
            ),
        },
      ])
    }).pipe(inLocation(other), Effect.forkChild({ startImmediately: true }))

    const creatingElsewhere = yield* Effect.gen(function* () {
      const plugins = yield* Plugin.Service
      yield* plugins.awaitActivation
      yield* plugins.activate([
        {
          id: "test.automation.elsewhere",
          revision: "1",
          effect: (ctx) =>
            Effect.gen(function* () {
              const session = yield* ctx.session.create({ title: "Elsewhere", location: { directory: other } })
              yield* Deferred.succeed(creating, undefined)
              yield* ctx.experimental.automation.create({
                sessionID: session.id,
                name: "review elsewhere",
                trigger: { type: "every", every: "1 hour" },
                action: { type: "prompt", prompt: "Review the changes.", to: { subagent: Agent.ID.make("reviewer") } },
              })
              loaded.push("elsewhere")
            }).pipe(
              // Record why a create failed, so a failure shows the reason rather than a missing entry.
              Effect.tapError((error) =>
                Effect.sync(() => loaded.push(error instanceof Error ? error.message : String(error))),
              ),
              Effect.orDie,
            ),
        },
      ])
    }).pipe(inLocation(location.directory), Effect.forkChild({ startImmediately: true }))

    // Give a create that skipped the other Location's activation time to fail before its plugins finish loading.
    yield* Deferred.await(creating)
    yield* Effect.sleep("100 millis")
    yield* gate.open
    yield* Fiber.join(activating)
    yield* Fiber.join(creatingElsewhere)

    expect(loaded).toEqual(["elsewhere"])
    expect((yield* automations.list()).map((item) => item.name)).toContain("review elsewhere")
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

it.live("Promise plugins cannot delete an automation with an aborted signal", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const automations = yield* Automation.Service
    const context = yield* PluginHost.make(plugins, "test")
    const session = yield* context.session.create({ title: "Promise automation abort target" })
    const ids: string[] = []

    yield* PluginPromise.fromPromise({
      id: "test.automation.abort",
      async setup(ctx) {
        const created = await ctx.experimental.automation.create({
          directory: ctx.location.directory,
          name: "kept inbox",
          trigger: { type: "cron", cron: "0 9 * * *" },
          action: { type: "prompt", prompt: "Check the balance now.", to: { session: session.id } },
        })
        ids.push(created.id)
        const controller = new AbortController()
        controller.abort()
        await expect(
          ctx.experimental.automation.delete({ automationID: created.id }, { signal: controller.signal }),
        ).rejects.toThrow()
      },
    }).effect(context)

    expect(ids).toHaveLength(1)
    expect((yield* automations.list()).map((item): string => item.id)).toContain(ids[0])
  }),
)

it.live("Promise plugin calls aborted mid-call reject with the signal's reason", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const host = yield* PluginHost.make(plugins, "test")
    // A call that only ends when it's aborted.
    const context = {
      ...host,
      experimental: { ...host.experimental, automation: { ...host.experimental.automation, list: () => Effect.never } },
    }
    const reasons: unknown[] = []

    yield* PluginPromise.fromPromise({
      id: "test.automation.abort-mid-call",
      async setup(ctx) {
        const controller = new AbortController()
        const listed = ctx.experimental.automation.list(
          { directory: ctx.location.directory },
          { signal: controller.signal },
        )
        controller.abort()
        await listed.catch((error: unknown) => reasons.push(error))
      },
    }).effect(context as typeof host)

    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toBeInstanceOf(DOMException)
    expect((reasons[0] as DOMException).name).toBe("AbortError")
  }),
)
