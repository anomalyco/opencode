import { describe, expect } from "bun:test"
import { Effect, Logger, LogLevel } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Npm } from "@opencode-ai/core/npm"
import path from "path"
import { pathToFileURL } from "url"
import { Account } from "../../src/account/account"
import { Auth } from "../../src/auth"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { Plugin } from "../../src/plugin/index"

import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { AccountTest } from "../fake/account"
import { AuthTest } from "../fake/auth"
import { NpmTest } from "../fake/npm"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Plugin.node, CrossSpawnSpawner.node]), [
    [Auth.node, AuthTest.empty],
    [Account.node, AccountTest.empty],
    [Npm.node, NpmTest.noop],
    [RuntimeFlags.node, RuntimeFlags.layer({ disableDefaultPlugins: true })],
  ]),
)

const stoppingHook = "session.stopping"

function pluginSource(body: string) {
  return ["export default async () => ({", body, "})", ""].join("\n")
}

function stoppingPlugin(listenerBody: string) {
  return pluginSource(`  ${JSON.stringify(stoppingHook)}: async (_input, output) => { ${listenerBody} },`)
}

function withPlugins<A, E, R>(sources: string[], self: Effect.Effect<A, E, R>) {
  return Effect.gen(function* () {
    const test = yield* TestInstance
    const files = sources.map((source, index) => ({
      name: path.join(test.directory, `plugin-${index}.ts`),
      source,
    }))
    yield* Effect.all(
      [
        ...files.map((file) => Effect.promise(() => Bun.write(file.name, file.source))),
        Effect.promise(() =>
          Bun.write(
            path.join(test.directory, "opencode.json"),
            JSON.stringify(
              {
                $schema: "https://opencode.ai/config.json",
                plugin: files.map((file) => pathToFileURL(file.name).href),
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
  })
}

function withProject<A, E, R>(source: string, self: Effect.Effect<A, E, R>) {
  return withPlugins([source], self)
}

const triggerStopping = Effect.fn("StopHookTest.triggerStopping")(function* () {
  const plugin = yield* Plugin.Service
  const out = { stop: true, message: undefined as string | undefined }
  yield* plugin.trigger(stoppingHook, { sessionID: "test-session" }, out)
  return out
})

// Captures Effect log output (the same lines the runtime would write to stderr)
// so tests can assert the user-visible diagnostic + its structured payload.
function capturedLogs<R>(effect: Effect.Effect<unknown, never, R>) {
  const logs: Array<unknown> = []
  const capture = Logger.make<unknown, void>((options) =>
    logs.push({
      level: String(options.logLevel) as string,
      message: options.message,
    }),
  )
  return effect
    .pipe(Effect.provide(Logger.layer([capture])))
    .pipe(Effect.as(logs))
}

describe("session.stopping hook", () => {
  it.instance("plugin with session.stopping hook loads and trigger returns mutated output", () =>
    withProject(
      pluginSource(`  ${JSON.stringify(stoppingHook)}: async (_input, output) => {\n    output.stop = false\n    output.message = "workflow gate"\n  },`),
      Effect.gen(function* () {
        const out = yield* triggerStopping()
        expect(out.stop).toBe(false)
        expect(out.message).toBe("workflow gate")
      }),
    ),
  )

  it.instance("no plugin installed — stop stays true", () =>
    withProject(
      pluginSource(""),
      Effect.gen(function* () {
        const out = yield* triggerStopping()
        expect(out.stop).toBe(true)
        expect(out.message).toBeUndefined()
      }),
    ),
  )

  it.instance("stop=false without message does not satisfy continuation condition", () =>
    withProject(
      stoppingPlugin(`output.stop = false`),
      Effect.gen(function* () {
        const out = yield* triggerStopping()
        expect(out.stop).toBe(false)
        expect(out.message).toBeUndefined()
        expect(!out.stop && !!out.message).toBe(false)
      }),
    ),
  )

  it.instance("two listeners run sequentially in registration order over one shared output", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const marker = path.join(test.directory, "stopping-order")
      yield* withPlugins(
        [
          stoppingPlugin(`await Bun.write(${JSON.stringify(marker)}, "first"); output.stop = false; output.message = "one"`),
          stoppingPlugin(`await Bun.write(${JSON.stringify(marker)}, "second"); output.stop = false; output.message = "two"`),
        ],
        Effect.gen(function* () {
          const out = yield* triggerStopping()
          expect(out.stop).toBe(false)
          expect(out.message).toBe("two")
        }),
      )
      const text = yield* Effect.promise(() => Bun.file(marker).text())
      expect(text).toBe("second")
    }),
  )

  it.instance("replacement: later listener's message replaces the earlier one", () =>
    withPlugins(
      [
        stoppingPlugin(`output.stop = false; output.message = "first"`),
        stoppingPlugin(`output.stop = false; output.message = "second"`),
      ],
      Effect.gen(function* () {
        const out = yield* triggerStopping()
        expect(out.stop).toBe(false)
        expect(out.message).toBe("second")
      }),
    ),
  )

  it.instance("precedence: later stop=false cannot override a prior stop=true", () =>
    withPlugins(
      [
        pluginSource(
          `  ${JSON.stringify(stoppingHook)}: async (_input, output) => {\n    output.stop = false\n    output.message = "continue"\n  },`,
        ),
        pluginSource(
          `  ${JSON.stringify(stoppingHook)}: (_input, output) => {\n    output.stop = true\n  },`,
        ),
        stoppingPlugin(`output.stop = false; output.message = "override"`),
      ],
      Effect.gen(function* () {
        const out = yield* triggerStopping()
        expect(out.stop).toBe(true)
        expect(out.message).toBeUndefined()
      }),
    ),
  )

  it.instance("sync throw isolates the failing listener; later listeners still run and hook fails closed", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const later = path.join(test.directory, "stopping-later-ran")
      const captured = yield* capturedLogs(
        withPlugins(
          [
            pluginSource(
              `  ${JSON.stringify(stoppingHook)}: () => {\n    throw new Error("simulated hook failure")\n  },`,
            ),
            stoppingPlugin(`await Bun.write(${JSON.stringify(later)}, "later"); output.stop = false; output.message = "still-ran"`),
          ],
          Effect.gen(function* () {
            const out = yield* triggerStopping()
            expect(out.stop).toBe(true)
            expect(out.message).toBeUndefined()
          }),
        ),
      )
      const text = yield* Effect.promise(() => Bun.file(later).text())
      expect(text).toBe("later")

      // SH-2: a throwing listener produces a user-visible diagnostic (what the
      // runtime logs to stderr) whose structured payload carries the sessionID,
      // hook key, and the failing listener's index.
      const failure = (captured as Array<{ level: string; message: unknown }>).find(
        (entry) => Array.isArray(entry.message) && entry.message[0] === "session.stopping hook error; failing closed",
      )
      expect(failure).toBeDefined()
      if (failure && Array.isArray(failure.message)) {
        expect(failure.level).toBe("Error")
        const payload = failure.message[1] as Record<string, unknown>
        expect(payload["session.id"]).toBe("test-session")
        expect(payload["hook"]).toBe("session.stopping")
        expect(typeof payload["listener"]).toBe("number")
        expect(typeof payload["error"]).toBe("string")
      }
    }),
  )

  it.instance("async rejection isolates the failing listener; later listeners still run and hook fails closed", () =>
    withPlugins(
      [
        pluginSource(
          `  ${JSON.stringify(stoppingHook)}: async () => {\n    throw new Error("simulated async failure")\n  },`,
        ),
        pluginSource(
          `  ${JSON.stringify(stoppingHook)}: async (_input, output) => {\n    output.stop = false\n    output.message = "still-ran"\n  },`,
        ),
      ],
      Effect.gen(function* () {
        const captured = yield* capturedLogs(triggerStopping())
        // SH-2: a rejecting listener emits the same user-visible diagnostic
        // (Error level) whose structured payload carries the sessionID, hook
        // key, and the failing listener's index.
        const failure = (captured as Array<{ level: string; message: unknown }>).find(
          (entry) => Array.isArray(entry.message) && entry.message[0] === "session.stopping hook error; failing closed",
        )
        expect(failure).toBeDefined()
        if (failure && Array.isArray(failure.message)) {
          expect(failure.level).toBe("Error")
          const payload = failure.message[1] as Record<string, unknown>
          expect(payload["session.id"]).toBe("test-session")
          expect(payload["hook"]).toBe("session.stopping")
          expect(typeof payload["listener"]).toBe("number")
          expect(typeof payload["error"]).toBe("string")
        }
      }),
    ),
  )
})