import { describe, expect } from "bun:test"
import { Effect, Layer, Option } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"
import path from "path"
import { pathToFileURL } from "url"
import { Account } from "../../src/account/account"
import { Auth } from "../../src/auth"
import { Bus } from "../../src/bus"
import { Config } from "../../src/config/config"
import { Env } from "../../src/env"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { Plugin } from "../../src/plugin/index"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { NpmTest } from "../fake/npm"

const emptyAccount = Layer.mock(Account.Service)({
  active: () => Effect.succeed(Option.none()),
  activeOrg: () => Effect.succeed(Option.none()),
})
const emptyAuth = Layer.mock(Auth.Service)({
  all: () => Effect.succeed({}),
})
const configLayer = Config.layer.pipe(
  Layer.provide(EffectFlock.defaultLayer),
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Env.defaultLayer),
  Layer.provide(emptyAuth),
  Layer.provide(emptyAccount),
  Layer.provide(NpmTest.noop),
)
const it = testEffect(
  Layer.mergeAll(
    Plugin.layer.pipe(
      Layer.provide(Bus.layer),
      Layer.provide(configLayer),
      Layer.provide(RuntimeFlags.layer({ disableDefaultPlugins: true })),
    ),
    CrossSpawnSpawner.defaultLayer,
  ),
)

const hookName = "experimental.message.store.before"

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

describe("experimental.message.store.before", () => {
  it.live("mutates part text before storage", () =>
    withProject(
      [
        "export default async () => ({",
        `  ${JSON.stringify(hookName)}: async (_input, output) => {`,
        '    if (output.part.type === "text") {',
        '      output.part = { ...output.part, text: output.part.text.replace(/secret123/g, "***REDACTED***") }',
        "    }",
        "  },",
        "})",
        "",
      ].join("\n"),
      Effect.gen(function* () {
        const plugin = yield* Plugin.Service
        const part = {
          id: "part_test1",
          sessionID: "ses_test1",
          messageID: "msg_test1",
          type: "text" as const,
          text: "my password is secret123",
        }
        const out = yield* plugin.trigger(hookName, {
          sessionID: part.sessionID,
          messageID: part.messageID,
          partID: part.id,
        }, { part })
        expect(out.part.text).toBe("my password is ***REDACTED***")
      }),
    ),
  )

  it.live("passes input metadata to the hook", () =>
    withProject(
      [
        "export default async () => ({",
        `  ${JSON.stringify(hookName)}: async (input, output) => {`,
        '    if (output.part.type === "text") {',
        "      output.part = { ...output.part, text: `${input.sessionID}:${input.messageID}:${input.partID}` }",
        "    }",
        "  },",
        "})",
        "",
      ].join("\n"),
      Effect.gen(function* () {
        const plugin = yield* Plugin.Service
        const part = {
          id: "part_abc",
          sessionID: "ses_xyz",
          messageID: "msg_def",
          type: "text" as const,
          text: "original",
        }
        const out = yield* plugin.trigger(hookName, {
          sessionID: part.sessionID,
          messageID: part.messageID,
          partID: part.id,
        }, { part })
        expect(out.part.text).toBe("ses_xyz:msg_def:part_abc")
      }),
    ),
  )

  it.live("leaves non-text parts unmodified when hook only handles text", () =>
    withProject(
      [
        "export default async () => ({",
        `  ${JSON.stringify(hookName)}: async (_input, output) => {`,
        '    if (output.part.type === "text") {',
        '      output.part = { ...output.part, text: "REDACTED" }',
        "    }",
        "  },",
        "})",
        "",
      ].join("\n"),
      Effect.gen(function* () {
        const plugin = yield* Plugin.Service
        const part = {
          id: "part_tool1",
          sessionID: "ses_test1",
          messageID: "msg_test1",
          type: "step-start" as const,
          title: "Running build",
        }
        const out = yield* plugin.trigger(hookName, {
          sessionID: part.sessionID,
          messageID: part.messageID,
          partID: part.id,
        }, { part })
        expect(out.part).toEqual(part)
      }),
    ),
  )
})
