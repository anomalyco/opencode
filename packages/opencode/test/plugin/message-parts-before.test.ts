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

describe("message.parts.before", () => {
  test("plugin can modify file parts in place", async () => {
    await using tmp = await project(
      [
        "export default async () => ({",
        '  "message.parts.before": async (_input, output) => {',
        "    for (const part of output.parts) {",
        '      if (part.type === "file" && typeof part.mime === "string" && part.mime.startsWith("image/")) {',
        '        part.url = "data:image/jpeg;base64,optimized"',
        '        part.mime = "image/jpeg"',
        "      }",
        "    }",
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
          const parts = [
            { type: "text" as const, text: "describe this" },
            { type: "file" as const, mime: "image/png", url: "data:image/png;base64,huge-payload" },
          ]
          yield* plugin.trigger(
            "message.parts.before",
            { sessionID: "test-session", agent: "assistant" },
            { parts },
          )
          return parts
        }).pipe(Effect.provide(Plugin.defaultLayer), Effect.runPromise),
    })

    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({ type: "text", text: "describe this" })
    expect((out[1] as any).url).toBe("data:image/jpeg;base64,optimized")
    expect((out[1] as any).mime).toBe("image/jpeg")
  })

  test("non-file parts pass through unchanged", async () => {
    await using tmp = await project(
      [
        "export default async () => ({",
        '  "message.parts.before": async (_input, output) => {',
        "    for (const part of output.parts) {",
        '      if (part.type === "file") {',
        '        part.url = "modified"',
        "      }",
        "    }",
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
          const parts = [
            { type: "text" as const, text: "hello" },
            { type: "agent" as const, name: "coder" },
          ]
          yield* plugin.trigger(
            "message.parts.before",
            { sessionID: "test-session" },
            { parts },
          )
          return parts
        }).pipe(Effect.provide(Plugin.defaultLayer), Effect.runPromise),
    })

    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({ type: "text", text: "hello" })
    expect(out[1]).toEqual({ type: "agent", name: "coder" })
  })

  test("plugin receives correct input context", async () => {
    await using tmp = await project(
      [
        "let captured = null",
        "export default async () => ({",
        '  "message.parts.before": async (input, output) => {',
        "    captured = { ...input }",
        "    output.parts.push({ type: 'text', text: JSON.stringify(captured) })",
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
          const parts: any[] = []
          yield* plugin.trigger(
            "message.parts.before",
            {
              sessionID: "ses_123",
              agent: "coder",
              model: { providerID: "anthropic", modelID: "claude-sonnet-4-6" },
              messageID: "msg_456",
              variant: "default",
            },
            { parts },
          )
          return parts
        }).pipe(Effect.provide(Plugin.defaultLayer), Effect.runPromise),
    })

    expect(out).toHaveLength(1)
    const captured = JSON.parse((out[0] as any).text)
    expect(captured.sessionID).toBe("ses_123")
    expect(captured.agent).toBe("coder")
    expect(captured.model.providerID).toBe("anthropic")
    expect(captured.model.modelID).toBe("claude-sonnet-4-6")
    expect(captured.messageID).toBe("msg_456")
    expect(captured.variant).toBe("default")
  })

  test("plugin can add new parts to the array", async () => {
    await using tmp = await project(
      [
        "export default async () => ({",
        '  "message.parts.before": async (_input, output) => {',
        '    output.parts.push({ type: "text", text: "injected by plugin" })',
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
          const parts = [{ type: "text" as const, text: "original" }]
          yield* plugin.trigger(
            "message.parts.before",
            { sessionID: "test-session" },
            { parts },
          )
          return parts
        }).pipe(Effect.provide(Plugin.defaultLayer), Effect.runPromise),
    })

    expect(out).toHaveLength(2)
    expect((out[0] as any).text).toBe("original")
    expect((out[1] as any).text).toBe("injected by plugin")
  })

  test("plugin can remove parts from the array", async () => {
    await using tmp = await project(
      [
        "export default async () => ({",
        '  "message.parts.before": async (_input, output) => {',
        '    const filtered = output.parts.filter(p => p.type !== "file")',
        "    output.parts.length = 0",
        "    output.parts.push(...filtered)",
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
          const parts = [
            { type: "text" as const, text: "keep me" },
            { type: "file" as const, mime: "image/png", url: "data:image/png;base64,drop-me" },
            { type: "text" as const, text: "keep me too" },
          ]
          yield* plugin.trigger(
            "message.parts.before",
            { sessionID: "test-session" },
            { parts },
          )
          return parts
        }).pipe(Effect.provide(Plugin.defaultLayer), Effect.runPromise),
    })

    expect(out).toHaveLength(2)
    expect((out[0] as any).text).toBe("keep me")
    expect((out[1] as any).text).toBe("keep me too")
  })

  test("hook is a no-op when no plugin is registered", async () => {
    await using tmp = await project(
      [
        "export default async () => ({})",
        "",
      ].join("\n"),
    )

    const out = await Instance.provide({
      directory: tmp.path,
      fn: async () =>
        Effect.gen(function* () {
          const plugin = yield* Plugin.Service
          const parts = [
            { type: "text" as const, text: "unchanged" },
            { type: "file" as const, mime: "image/png", url: "data:image/png;base64,big" },
          ]
          yield* plugin.trigger(
            "message.parts.before",
            { sessionID: "test-session" },
            { parts },
          )
          return parts
        }).pipe(Effect.provide(Plugin.defaultLayer), Effect.runPromise),
    })

    expect(out).toHaveLength(2)
    expect((out[0] as any).text).toBe("unchanged")
    expect((out[1] as any).url).toBe("data:image/png;base64,big")
  })
})
