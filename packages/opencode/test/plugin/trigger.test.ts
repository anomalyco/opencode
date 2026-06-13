import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"
import path from "path"
import { pathToFileURL } from "url"
import { Bus } from "../../src/bus"
import { Config } from "../../src/config/config"
import { Env } from "../../src/env"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { Plugin } from "../../src/plugin/index"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { SessionID } from "../../src/session/schema"
import { Todo } from "../../src/session/todo"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { AccountTest } from "../fake/account"
import { AuthTest } from "../fake/auth"
import { NpmTest } from "../fake/npm"

const busLayer = Bus.layer
const configLayer = Config.layer.pipe(
  Layer.provide(EffectFlock.defaultLayer),
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Env.defaultLayer),
  Layer.provide(AuthTest.empty),
  Layer.provide(AccountTest.empty),
  Layer.provide(NpmTest.noop),
  Layer.provide(FetchHttpClient.layer),
)
const it = testEffect(
  Layer.mergeAll(
    Plugin.layer.pipe(
      Layer.provide(busLayer),
      Layer.provide(configLayer),
      Layer.provide(RuntimeFlags.layer({ disableDefaultPlugins: true })),
    ),
    busLayer,
    CrossSpawnSpawner.defaultLayer,
  ),
)
const systemHook = "experimental.chat.system.transform"
const chatHook = "chat.message"

async function readText(file: string) {
  return Bun.file(file)
    .text()
    .catch(() => "")
}

async function waitForText(file: string, expected: string) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const text = await readText(file)
    if (text === expected) return text
    await Bun.sleep(5)
  }
  return readText(file)
}

function withProject<A, E, R>(source: string, self: Effect.Effect<A, E, R>) {
  return provideTmpdirInstance((dir) =>
    Effect.gen(function* () {
      const file = path.join(dir, "plugin.ts")
      yield* Effect.all(
        [
          Effect.promise(() => Bun.write(file, source)),
          Effect.promise(() =>
            Bun.write(
              path.join(dir, "opencode.json"),
              JSON.stringify(
                {
                  $schema: "https://opencode.ai/config.json",
                  plugin: [pathToFileURL(file).href],
                },
                null,
                2,
              ),
            ),
          ),
        ],
        { discard: true, concurrency: 2 },
      )
      return yield* self
    }),
  )
}

const triggerSystemTransform = Effect.fn("PluginTriggerTest.triggerSystemTransform")(function* () {
  const plugin = yield* Plugin.Service
  const out = { system: [] as string[] }
  yield* plugin.trigger(
    systemHook,
    {
      model: {
        providerID: ProviderID.anthropic,
        modelID: ModelID.make("claude-sonnet-4-6"),
      },
    },
    out,
  )
  return out.system
})

const triggerChatMessage = Effect.fn("PluginTriggerTest.triggerChatMessage")(function* (sessionID: SessionID) {
  const plugin = yield* Plugin.Service
  const out = { message: {}, parts: [] as Array<{ text: string }> }
  yield* plugin.trigger(chatHook, { sessionID }, out as any)
  return out.parts.map((part) => part.text)
})

describe("plugin.trigger", () => {
  it.live("runs synchronous hooks without crashing", () =>
    withProject(
      [
        "export default async () => ({",
        `  ${JSON.stringify(systemHook)}: (_input, output) => {`,
        '    output.system.unshift("sync")',
        "  },",
        "})",
        "",
      ].join("\n"),
      Effect.gen(function* () {
        expect(yield* triggerSystemTransform()).toEqual(["sync"])
      }),
    ),
  )

  it.live("awaits asynchronous hooks", () =>
    withProject(
      [
        "export default async () => ({",
        `  ${JSON.stringify(systemHook)}: async (_input, output) => {`,
        "    await Bun.sleep(1)",
        '    output.system.unshift("async")',
        "  },",
        "})",
        "",
      ].join("\n"),
      Effect.gen(function* () {
        expect(yield* triggerSystemTransform()).toEqual(["async"])
      }),
    ),
  )

  it.live("skips disabled trigger hooks for the matching session", () =>
    withProject(
      [
        "export default async () => ({",
        `  ${JSON.stringify(chatHook)}: async (_input, output) => {`,
        '    output.parts.push({ text: "ran" })',
        "  },",
        "})",
        "",
      ].join("\n"),
      Effect.gen(function* () {
        const plugin = yield* Plugin.Service
        const blocked = SessionID.make("ses_blocked")
        const allowed = SessionID.make("ses_allowed")

        yield* plugin.setHookControl({ sessionID: blocked, hook: chatHook, enabled: false })

        expect(yield* triggerChatMessage(blocked)).toEqual([])
        expect(yield* triggerChatMessage(allowed)).toEqual(["ran"])

        yield* plugin.setHookControl({ sessionID: blocked, hook: chatHook, enabled: true })
        expect(yield* triggerChatMessage(blocked)).toEqual(["ran"])
      }),
    ),
  )

  it.live("skips all hooks disabled with a session wildcard control", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const file = path.join(dir, "plugin.ts")
        const log = path.join(dir, "events.log")
        yield* Effect.all(
          [
            Effect.promise(() =>
              Bun.write(
                file,
                [
                  `const log = ${JSON.stringify(log)}`,
                  "export default async () => ({",
                  `  ${JSON.stringify(chatHook)}: async (_input, output) => {`,
                  '    output.parts.push({ text: "ran" })',
                  "  },",
                  "  event: async ({ event }) => {",
                  '    if (event.type !== "todo.updated") return',
                  '    const sessionID = event.properties?.sessionID ?? ""',
                  '    const prev = await Bun.file(log).text().catch(() => "")',
                  "    await Bun.write(log, `${prev}${event.type}:${sessionID}\\n`)",
                  "  },",
                  "})",
                  "",
                ].join("\n"),
              ),
            ),
            Effect.promise(() =>
              Bun.write(
                path.join(dir, "opencode.json"),
                JSON.stringify(
                  {
                    $schema: "https://opencode.ai/config.json",
                    plugin: [pathToFileURL(file).href],
                  },
                  null,
                  2,
                ),
              ),
            ),
          ],
          { discard: true, concurrency: 2 },
        )

        const plugin = yield* Plugin.Service
        const bus = yield* Bus.Service
        const blocked = SessionID.make("ses_blocked")
        const allowed = SessionID.make("ses_allowed")

        yield* plugin.init()
        yield* plugin.setHookControl({ sessionID: blocked, plugin: "*", hook: "*", enabled: false })

        expect(yield* triggerChatMessage(blocked)).toEqual([])
        expect(yield* triggerChatMessage(allowed)).toEqual(["ran"])

        yield* bus.publish(Todo.Event.Updated, { sessionID: blocked, todos: [] })
        yield* Effect.promise(() => Bun.sleep(20))
        expect(yield* Effect.promise(() => readText(log))).toBe("")

        yield* bus.publish(Todo.Event.Updated, { sessionID: allowed, todos: [] })
        expect(yield* Effect.promise(() => waitForText(log, "todo.updated:ses_allowed\n"))).toBe(
          "todo.updated:ses_allowed\n",
        )
      }),
    ),
  )

  it.live("skips disabled event hooks for the matching session and event type", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const file = path.join(dir, "plugin.ts")
        const log = path.join(dir, "events.log")
        yield* Effect.all(
          [
            Effect.promise(() =>
              Bun.write(
                file,
                [
                  `const log = ${JSON.stringify(log)}`,
                  "export default async () => ({",
                  "  event: async ({ event }) => {",
                  '    if (event.type !== "todo.updated") return',
                  '    const sessionID = event.properties?.sessionID ?? ""',
                  '    const prev = await Bun.file(log).text().catch(() => "")',
                  "    await Bun.write(log, `${prev}${event.type}:${sessionID}\\n`)",
                  "  },",
                  "})",
                  "",
                ].join("\n"),
              ),
            ),
            Effect.promise(() =>
              Bun.write(
                path.join(dir, "opencode.json"),
                JSON.stringify(
                  {
                    $schema: "https://opencode.ai/config.json",
                    plugin: [pathToFileURL(file).href],
                  },
                  null,
                  2,
                ),
              ),
            ),
          ],
          { discard: true, concurrency: 2 },
        )

        const plugin = yield* Plugin.Service
        const bus = yield* Bus.Service
        const blocked = SessionID.make("ses_blocked")
        const allowed = SessionID.make("ses_allowed")

        yield* plugin.init()
        yield* plugin.setHookControl({
          sessionID: blocked,
          hook: "event",
          event: Todo.Event.Updated.type,
          enabled: false,
        })

        yield* bus.publish(Todo.Event.Updated, { sessionID: blocked, todos: [] })
        yield* Effect.promise(() => Bun.sleep(20))
        expect(yield* Effect.promise(() => readText(log))).toBe("")

        yield* bus.publish(Todo.Event.Updated, { sessionID: allowed, todos: [] })
        expect(yield* Effect.promise(() => waitForText(log, "todo.updated:ses_allowed\n"))).toBe(
          "todo.updated:ses_allowed\n",
        )
      }),
    ),
  )
})
