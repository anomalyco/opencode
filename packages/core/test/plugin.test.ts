import { expect } from "bun:test"
import path from "path"
import { Effect } from "effect"
import { Command } from "@opencode-ai/core/command"
import { Plugin } from "@opencode-ai/core/plugin"
import { PluginModule } from "@opencode-ai/core/plugin/module"
import { Session } from "@opencode-ai/schema/session"
import { testEffect } from "./lib/effect"
import { PluginTestLayer } from "./plugin/fixture"

const it = testEffect(PluginTestLayer)

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
            yield* ctx.command.transform((draft) => draft.add({ name: "greet", execute: () => Effect.void }))
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
            .transform((draft) => draft.add({ name: "greet", execute: () => Effect.void }))
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
              .transform((draft) =>
                draft.add({
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
