import { afterAll, afterEach, describe, expect, test } from "bun:test"
import { Cause, Effect, Exit, Fiber, Layer } from "effect"
import path from "path"
import { pathToFileURL } from "url"
import { Bus } from "../../src/bus"
import { Permission } from "../../src/permission"
import { Instance } from "../../src/project/instance"
import { SessionID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

const disableDefault = process.env.OPENCODE_DISABLE_DEFAULT_PLUGINS
process.env.OPENCODE_DISABLE_DEFAULT_PLUGINS = "1"

const { Plugin } = await import("../../src/plugin/index")

const env = Layer.mergeAll(Permission.layer.pipe(Layer.provide(Bus.layer)), Plugin.defaultLayer)

afterEach(async () => {
  await Instance.disposeAll()
})

afterAll(() => {
  if (disableDefault === undefined) {
    delete process.env.OPENCODE_DISABLE_DEFAULT_PLUGINS
    return
  }
  process.env.OPENCODE_DISABLE_DEFAULT_PLUGINS = disableDefault
})

async function project(source: string) {
  return tmpdir({
    git: true,
    init: async (dir) => {
      const file = path.join(dir, "plugin.ts")
      await Bun.write(file, source)
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify(
          {
            $schema: "https://opencode.ai/config.json",
            plugin: [pathToFileURL(file).href],
          },
          null,
          2,
        ),
      )
    },
  })
}

describe("permission.ask hook", () => {
  test("plugin hook denies with reason and DeniedError carries the reason", async () => {
    await using tmp = await project(
      [
        "export default async () => ({",
        '  "permission.ask": async (input, output) => {',
        '    if (input.permission === "edit" && input.patterns.some(p => p.includes("src/"))) {',
        '      output.status = "deny"',
        '      output.reason = "Cannot edit production files during RED phase"',
        "    }",
        "  },",
        "})",
        "",
      ].join("\n"),
    )

    const err = await Instance.provide({
      directory: tmp.path,
      fn: async () =>
        Effect.gen(function* () {
          const permission = yield* Permission.Service
          const exit = yield* permission
            .ask({
              sessionID: SessionID.make("session_test"),
              permission: "edit",
              patterns: ["src/services/foo.ts"],
              metadata: {},
              always: [],
              ruleset: [{ permission: "edit", pattern: "*", action: "ask" }],
            })
            .pipe(Effect.exit)

          expect(Exit.isFailure(exit)).toBe(true)
          if (!Exit.isFailure(exit)) throw new Error("expected failure")
          const error = Cause.squash(exit.cause)
          expect(error).toBeInstanceOf(Permission.DeniedError)
          expect(String(error)).toContain("Cannot edit production files during RED phase")
        }).pipe(Effect.provide(env), Effect.scoped, Effect.runPromise),
    })
  })

  test("plugin hook allows bypasses user prompt", async () => {
    await using tmp = await project(
      [
        "export default async () => ({",
        '  "permission.ask": async (input, output) => {',
        '    if (input.permission === "edit" && input.patterns.some(p => p.includes("test/"))) {',
        '      output.status = "allow"',
        "    }",
        "  },",
        "})",
        "",
      ].join("\n"),
    )

    await Instance.provide({
      directory: tmp.path,
      fn: async () =>
        Effect.gen(function* () {
          const permission = yield* Permission.Service
          const result = yield* permission.ask({
            sessionID: SessionID.make("session_test"),
            permission: "edit",
            patterns: ["test/foo.test.ts"],
            metadata: {},
            always: [],
            ruleset: [{ permission: "edit", pattern: "*", action: "ask" }],
          })
          expect(result).toBeUndefined()
        }).pipe(Effect.provide(env), Effect.scoped, Effect.runPromise),
    })
  })

  test("plugin hook leaves status as ask falls through to normal flow", async () => {
    await using tmp = await project(
      [
        "export default async () => ({",
        '  "permission.ask": async (_input, _output) => {',
        "    // no-op, leaves status as ask",
        "  },",
        "})",
        "",
      ].join("\n"),
    )

    await Instance.provide({
      directory: tmp.path,
      fn: async () =>
        Effect.gen(function* () {
          const permission = yield* Permission.Service
          const fiber = yield* permission
            .ask({
              sessionID: SessionID.make("session_test"),
              permission: "edit",
              patterns: ["src/foo.ts"],
              metadata: {},
              always: [],
              ruleset: [{ permission: "edit", pattern: "*", action: "ask" }],
            })
            .pipe(Effect.forkScoped)

          // Should still go to pending (normal ask flow)
          for (let i = 0; i < 100; i++) {
            const list = yield* permission.list()
            if (list.length === 1) break
            yield* Effect.sleep("10 millis")
          }
          const pending = yield* permission.list()
          expect(pending).toHaveLength(1)

          // Reject to clean up
          yield* permission.reply({ requestID: pending[0].id, reply: "reject" })
          yield* Fiber.await(fiber)
        }).pipe(Effect.provide(env), Effect.scoped, Effect.runPromise),
    })
  })
})
