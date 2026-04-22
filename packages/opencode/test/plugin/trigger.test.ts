import { afterAll, afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import path from "path"
import { pathToFileURL } from "url"
import { tmpdir } from "../fixture/fixture"

const disableDefault = process.env.OPENCODE_DISABLE_DEFAULT_PLUGINS
process.env.OPENCODE_DISABLE_DEFAULT_PLUGINS = "1"

const { Plugin } = await import("../../src/plugin/index")
const { Instance } = await import("../../src/project/instance")

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

describe("plugin.trigger", () => {
  test("runs synchronous hooks without crashing", async () => {
    await using tmp = await project(
      [
        "export default async () => ({",
        '  "experimental.chat.system.transform": (_input, output) => {',
        '    output.system.unshift("sync")',
        "  },",
        "})",
        "",
      ].join("\n"),
    )

    const out = await Instance.provide({
      directory: tmp.path,
      fn: async () =>
        Effect.gen(function* () {
          const plugin = yield* Plugin.Service
          const out = { system: [] as string[] }
          yield* plugin.trigger(
            "experimental.chat.system.transform",
            {
              model: {
                providerID: "anthropic",
                modelID: "claude-sonnet-4-6",
              } as any,
            },
            out,
          )
          return out
        }).pipe(Effect.provide(Plugin.defaultLayer), Effect.runPromise),
    })

    expect(out.system).toEqual(["sync"])
  })

  test("awaits asynchronous hooks", async () => {
    await using tmp = await project(
      [
        "export default async () => ({",
        '  "experimental.chat.system.transform": async (_input, output) => {',
        "    await Bun.sleep(1)",
        '    output.system.unshift("async")',
        "  },",
        "})",
        "",
      ].join("\n"),
    )

    const out = await Instance.provide({
      directory: tmp.path,
      fn: async () =>
        Effect.gen(function* () {
          const plugin = yield* Plugin.Service
          const out = { system: [] as string[] }
          yield* plugin.trigger(
            "experimental.chat.system.transform",
            {
              model: {
                providerID: "anthropic",
                modelID: "claude-sonnet-4-6",
              } as any,
            },
            out,
          )
          return out
        }).pipe(Effect.provide(Plugin.defaultLayer), Effect.runPromise),
    })

    expect(out.system).toEqual(["async"])
  })

  test("chat.headers receives assistantMessageID and parentSessionID", async () => {
    await using tmp = await project(
      [
        "export default async () => ({",
        '  "chat.headers": async (input, output) => {',
        '    output.headers["x-assistant-message-id"] = input.assistantMessageID',
        '    if (input.parentSessionID) output.headers["x-parent-session-id"] = input.parentSessionID',
        "  },",
        "})",
        "",
      ].join("\n"),
    )

    const out = await Instance.provide({
      directory: tmp.path,
      fn: async () =>
        Effect.gen(function* () {
          const plugin = yield* Plugin.Service
          const out = { headers: {} as Record<string, string> }
          yield* plugin.trigger(
            "chat.headers",
            {
              sessionID: "ses_test",
              agent: "build",
              model: { providerID: "test", modelID: "test-model" } as any,
              provider: {} as any,
              message: {} as any,
              assistantMessageID: "msg_abc123",
              parentSessionID: "ses_parent456",
            },
            out,
          )
          return out
        }).pipe(Effect.provide(Plugin.defaultLayer), Effect.runPromise),
    })

    expect(out.headers["x-assistant-message-id"]).toBe("msg_abc123")
    expect(out.headers["x-parent-session-id"]).toBe("ses_parent456")
  })
})
