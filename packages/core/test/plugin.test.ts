import { expect } from "bun:test"
import path from "path"
import { Clock, Effect } from "effect"
import { TestClock } from "effect/testing"
import { Command } from "@opencode-ai/core/command"
import { Credential } from "@opencode-ai/core/credential"
import { Integration } from "@opencode-ai/core/integration"
import { Plugin } from "@opencode-ai/core/plugin"
import { PluginModule } from "@opencode-ai/core/plugin/module"
import { Session } from "@opencode-ai/schema/session"
import { testEffect } from "./lib/effect"
import { PluginTestLayer } from "./plugin/fixture"

const it = testEffect(PluginTestLayer)

for (const scenario of [
  {
    name: "starts only the appended plugin",
    before: ["a", "b"],
    after: ["a", "b", "c"],
    expected: ["start:c:1"],
  },
  {
    name: "restarts the suffix after an insertion",
    before: ["a", "b", "c"],
    after: ["a", "x", "b", "c"],
    expected: ["stop:c:1", "stop:b:1", "start:x:1", "start:b:1", "start:c:1"],
  },
  {
    name: "restarts the suffix after a revision changes",
    before: ["a", "b", "c"],
    after: ["a", "b", "c"],
    updated: "b",
    expected: ["stop:c:1", "stop:b:1", "start:b:2", "start:c:1"],
  },
  {
    name: "stops only the removed trailing plugin",
    before: ["a", "b", "c"],
    after: ["a", "b"],
    expected: ["stop:c:1"],
  },
]) {
  it.effect(scenario.name, () =>
    Effect.gen(function* () {
      const plugins = yield* Plugin.Service
      const events: string[] = []
      const plugin = (id: string, revision = "1"): Plugin.Generation => ({
        id,
        revision,
        effect: () =>
          Effect.gen(function* () {
            events.push(`start:${id}:${revision}`)
            yield* Effect.addFinalizer(() => Effect.sync(() => events.push(`stop:${id}:${revision}`)))
          }),
      })

      yield* plugins.activate(scenario.before.map((id) => plugin(id)))
      events.length = 0
      yield* plugins.activate(scenario.after.map((id) => plugin(id, id === scenario.updated ? "2" : "1")))

      expect(events).toEqual(scenario.expected)
      expect((yield* plugins.list()).map((plugin) => plugin.id)).toEqual(scenario.after.map((id) => Plugin.ID.make(id)))
    }),
  )
}

it.effect("updates inventory metadata without restarting an unchanged generation", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    let loads = 0
    const plugin = {
      id: "metadata",
      revision: "1",
      source: { type: "package" as const, target: "fixture" },
      effect: () => Effect.sync(() => loads++),
    }

    yield* plugins.activate([plugin])
    yield* plugins.activate([{ ...plugin, source: { ...plugin.source, outdated: true } }])

    expect(loads).toBe(1)
    expect((yield* plugins.list())[0]?.source).toEqual({ type: "package", target: "fixture", outdated: true })
  }),
)

it.live("loads a local plugin with its configured options", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const commands = yield* Command.Service
    yield* plugins.awaitActivation
    const definition = yield* PluginModule.load({
      type: "add",
      target: path.join(import.meta.dir, "plugin/fixtures/greeting.ts"),
      options: { description: "Configured greeting" },
    })
    if ("pending" in definition) return yield* Effect.die("Local plugin was not loaded")
    yield* plugins.activate([definition])

    expect(yield* commands.get("greet")).toMatchObject({ description: "Configured greeting" })
  }),
)

it.effect("unloading a plugin removes its commands and runs cleanup", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const commands = yield* Command.Service
    let cleaned = false
    yield* plugins.activate([
      {
        id: "greeting",
        revision: "1",
        effect: (ctx) =>
          Effect.gen(function* () {
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                cleaned = true
              }),
            )
            yield* ctx.command.transform((editor) => editor.add({ name: "greet", execute: () => Effect.void }))
          }),
      },
    ])
    expect(yield* commands.get("greet")).toBeDefined()
    expect(cleaned).toBe(false)

    yield* plugins.activate([])

    expect(yield* commands.get("greet")).toBeUndefined()
    expect(cleaned).toBe(true)
  }),
)

it.effect("reports a failed plugin without blocking a healthy plugin", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const commands = yield* Command.Service
    yield* plugins.activate([
      { id: "broken", revision: "1", effect: () => Effect.die(new Error("Setup failed")) },
      {
        id: "greeting",
        revision: "1",
        effect: (ctx) =>
          ctx.command
            .transform((editor) => editor.add({ name: "greet", execute: () => Effect.void }))
            .pipe(Effect.asVoid),
      },
    ])

    expect((yield* plugins.list()).find((plugin) => plugin.id === "broken")?.state).toMatchObject({
      status: "failed",
      error: expect.stringContaining("Setup failed"),
    })
    expect(yield* commands.get("greet")).toBeDefined()
  }),
)

it.effect("keeps the suffix after a failed plugin alive across identical activations", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const setups = { good1: 0, broken: 0, good2: 0 }
    const good = (id: "good1" | "good2"): Plugin.Generation => ({
      id,
      revision: "1",
      effect: () => Effect.sync(() => void setups[id]++),
    })
    const broken = (revision: string): Plugin.Generation => ({
      id: "broken",
      revision,
      effect: () =>
        Effect.suspend(() => {
          setups.broken++
          return Effect.die(new Error("Setup failed"))
        }),
    })
    const failed = () =>
      plugins.list().pipe(Effect.map((inventory) => inventory.find((plugin) => plugin.id === "broken")?.state))

    yield* plugins.activate([good("good1"), broken("1"), good("good2")])
    expect(setups).toEqual({ good1: 1, broken: 1, good2: 1 })
    expect(yield* failed()).toMatchObject({ status: "failed", error: expect.stringContaining("Setup failed") })

    // Identical definitions: nothing restarts and the failed revision is not retried.
    yield* plugins.activate([good("good1"), broken("1"), good("good2")])
    expect(setups).toEqual({ good1: 1, broken: 1, good2: 1 })
    expect(yield* failed()).toMatchObject({ status: "failed", error: expect.stringContaining("Setup failed") })
    expect((yield* plugins.list()).map((plugin) => `${plugin.id}:${plugin.state.status}`)).toEqual([
      "good1:active",
      "broken:failed",
      "good2:active",
    ])

    // A new revision of the failed plugin is retried once, restarting only the suffix behind it.
    yield* plugins.activate([good("good1"), broken("2"), good("good2")])
    expect(setups).toEqual({ good1: 1, broken: 2, good2: 2 })
    expect(yield* failed()).toMatchObject({ status: "failed" })
  }),
)

it.effect("reloading a plugin replaces its command implementation", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const commands = yield* Command.Service
    const output: string[] = []
    const load = (revision: string, text: string) =>
      plugins.activate([
        {
          id: "greeting",
          revision,
          effect: (ctx) =>
            ctx.command
              .transform((editor) =>
                editor.add({
                  name: "greet",
                  execute: () =>
                    Effect.sync(() => {
                      output.push(text)
                    }),
                }),
              )
              .pipe(Effect.asVoid),
        },
      ])
    const request = {
      name: "greet",
      invocation: { sessionID: Session.ID.make("ses_plugin"), prompt: { text: "" }, delivery: "steer" as const },
    }

    yield* load("1", "before")
    yield* commands.execute(request)
    expect(output).toEqual(["before"])

    yield* load("2", "after")
    yield* commands.execute(request)
    expect(output).toEqual(["before", "after"])
  }),
)

it.effect("refreshes expired OAuth credentials through the context during activation", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const credentials = yield* Credential.Service
    const integrations = yield* Integration.Service
    const clock = yield* Clock.Clock
    const integrationID = Integration.ID.make("refresh-fixture")
    const methodID = Integration.MethodID.make("oauth")
    const expired = Credential.OAuth.make({
      type: "oauth",
      methodID,
      access: "expired-access",
      refresh: "fixture-refresh",
      expires: (yield* Clock.currentTimeMillis) + 60_000,
    })
    const stored = yield* credentials.create({ integrationID, label: "Fixture", value: expired })
    yield* TestClock.adjust("2 minutes")
    const refreshed = Credential.OAuth.make({
      ...expired,
      access: "fresh-access",
      refresh: "rotated-refresh",
      expires: (yield* Clock.currentTimeMillis) + 3_600_000,
    })
    const refreshes: Credential.OAuth[] = []
    const resolved: Array<Credential.Value | undefined> = []

    yield* plugins.activate([
      {
        id: "oauth-refresh",
        revision: "1",
        effect: (ctx) =>
          Effect.gen(function* () {
            yield* ctx.integration.transform((editor) =>
              editor.method.update({
                integrationID,
                method: { id: methodID, type: "oauth", label: "Fixture" },
                authorize: () => Effect.die("unexpected authorization"),
                refresh: (value) =>
                  Effect.sync(() => {
                    refreshes.push(value)
                    return refreshed
                  }),
              }),
            )
            // The method registered above must be readable before the activation batch ends.
            const connection = yield* ctx.integration.connection.active(integrationID)
            if (!connection) return yield* Effect.die("fixture connection not found")
            resolved.push(yield* ctx.integration.connection.resolve(connection).pipe(Effect.orDie))
          }).pipe(
            // Plugin activation isolates ambient services, including the test clock.
            Effect.provideService(Clock.Clock, clock),
          ),
      },
    ])

    expect(yield* plugins.list()).toMatchObject([{ id: "oauth-refresh", state: { status: "active" } }])
    expect(resolved).toEqual([refreshed])
    expect((yield* credentials.get(stored.id))?.value).toEqual(refreshed)
    expect(yield* integrations.connection.resolve({ type: "credential", id: stored.id, label: stored.label })).toEqual(
      refreshed,
    )
    expect(refreshes).toEqual([expired])
  }),
)
