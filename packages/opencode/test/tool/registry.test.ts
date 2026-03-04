import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { ToolRegistry } from "../../src/tool/registry"
import type { Tool } from "../../src/tool/tool"

const ctx: Tool.Context = {
  sessionID: "test-session",
  messageID: "test-message",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

describe("tool.registry", () => {
  test("loads tools from .opencode/tool (singular)", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const opencodeDir = path.join(dir, ".opencode")
        await fs.mkdir(opencodeDir, { recursive: true })

        const toolDir = path.join(opencodeDir, "tool")
        await fs.mkdir(toolDir, { recursive: true })

        await Bun.write(
          path.join(toolDir, "hello.ts"),
          [
            "export default {",
            "  description: 'hello tool',",
            "  args: {},",
            "  execute: async () => {",
            "    return 'hello world'",
            "  },",
            "}",
            "",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ids = await ToolRegistry.ids()
        expect(ids).toContain("hello")
      },
    })
  })

  test("loads tools from .opencode/tools (plural)", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const opencodeDir = path.join(dir, ".opencode")
        await fs.mkdir(opencodeDir, { recursive: true })

        const toolsDir = path.join(opencodeDir, "tools")
        await fs.mkdir(toolsDir, { recursive: true })

        await Bun.write(
          path.join(toolsDir, "hello.ts"),
          [
            "export default {",
            "  description: 'hello tool',",
            "  args: {},",
            "  execute: async () => {",
            "    return 'hello world'",
            "  },",
            "}",
            "",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ids = await ToolRegistry.ids()
        expect(ids).toContain("hello")
      },
    })
  })

  test("loads tools with external dependencies without crashing", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const opencodeDir = path.join(dir, ".opencode")
        await fs.mkdir(opencodeDir, { recursive: true })

        const toolsDir = path.join(opencodeDir, "tools")
        await fs.mkdir(toolsDir, { recursive: true })

        await Bun.write(
          path.join(opencodeDir, "package.json"),
          JSON.stringify({
            name: "custom-tools",
            dependencies: {
              "@opencode-ai/plugin": "^0.0.0",
              cowsay: "^1.6.0",
            },
          }),
        )

        await Bun.write(
          path.join(toolsDir, "cowsay.ts"),
          [
            "import { say } from 'cowsay'",
            "export default {",
            "  description: 'tool that imports cowsay at top level',",
            "  args: { text: { type: 'string' } },",
            "  execute: async ({ text }: { text: string }) => {",
            "    return say({ text })",
            "  },",
            "}",
            "",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ids = await ToolRegistry.ids()
        expect(ids).toContain("cowsay")
      },
    })
  })

  describe("plugin metadata in completed tool result", () => {
    test("preserves title and metadata set via ctx.metadata", async () => {
      // given
      await using tmp = await tmpdir({
        init: async (dir) => {
          const opencodeDir = path.join(dir, ".opencode")
          await fs.mkdir(opencodeDir, { recursive: true })

          const toolsDir = path.join(opencodeDir, "tools")
          await fs.mkdir(toolsDir, { recursive: true })

          await Bun.write(
            path.join(toolsDir, "metadata.ts"),
            [
              "export default {",
              "  description: 'metadata tool',",
              "  args: {},",
              "  execute: async (_args, ctx) => {",
              "    ctx.metadata({ title: 'test', metadata: { sessionId: 'ses_123' } })",
              "    return 'ok'",
              "  },",
              "}",
              "",
            ].join("\n"),
          )
        },
      })

      // when
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const tools = await ToolRegistry.tools({ providerID: "openai", modelID: "gpt-5" })
          const tool = tools.find((item) => item.id === "metadata")
          expect(tool).toBeDefined()
          if (!tool) throw new Error("metadata tool not found")
          const result = await tool.execute({}, ctx)

          // then
          expect(result.title).toBe("test")
          expect(result.metadata.sessionId).toBe("ses_123")
          expect(result.metadata.truncated).toBeFalse()
        },
      })
    })

    test("keeps latest title and merges metadata across multiple ctx.metadata calls", async () => {
      // given
      await using tmp = await tmpdir({
        init: async (dir) => {
          const opencodeDir = path.join(dir, ".opencode")
          await fs.mkdir(opencodeDir, { recursive: true })

          const toolsDir = path.join(opencodeDir, "tools")
          await fs.mkdir(toolsDir, { recursive: true })

          await Bun.write(
            path.join(toolsDir, "metadata.ts"),
            [
              "export default {",
              "  description: 'metadata tool',",
              "  args: {},",
              "  execute: async (_args, ctx) => {",
              "    ctx.metadata({ title: 'first', metadata: { sessionId: 'ses_123', step: 'one' } })",
              "    ctx.metadata({ title: 'second', metadata: { durationMs: 42 } })",
              "    return 'ok'",
              "  },",
              "}",
              "",
            ].join("\n"),
          )
        },
      })

      // when
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const tools = await ToolRegistry.tools({ providerID: "openai", modelID: "gpt-5" })
          const tool = tools.find((item) => item.id === "metadata")
          expect(tool).toBeDefined()
          if (!tool) throw new Error("metadata tool not found")
          const result = await tool.execute({}, ctx)

          // then
          expect(result.title).toBe("second")
          expect(result.metadata.sessionId).toBe("ses_123")
          expect(result.metadata.step).toBe("one")
          expect(result.metadata.durationMs).toBe(42)
          expect(result.metadata.truncated).toBeFalse()
        },
      })
    })

    test("keeps backward-compatible defaults when ctx.metadata is never called", async () => {
      // given
      await using tmp = await tmpdir({
        init: async (dir) => {
          const opencodeDir = path.join(dir, ".opencode")
          await fs.mkdir(opencodeDir, { recursive: true })

          const toolsDir = path.join(opencodeDir, "tools")
          await fs.mkdir(toolsDir, { recursive: true })

          await Bun.write(
            path.join(toolsDir, "metadata.ts"),
            [
              "export default {",
              "  description: 'metadata tool',",
              "  args: {},",
              "  execute: async () => {",
              "    return 'ok'",
              "  },",
              "}",
              "",
            ].join("\n"),
          )
        },
      })

      // when
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const tools = await ToolRegistry.tools({ providerID: "openai", modelID: "gpt-5" })
          const tool = tools.find((item) => item.id === "metadata")
          expect(tool).toBeDefined()
          if (!tool) throw new Error("metadata tool not found")
          const result = await tool.execute({}, ctx)

          // then
          expect(result.title).toBe("")
          expect(result.metadata.truncated).toBeFalse()
          expect(result.metadata.outputPath).toBeUndefined()
        },
      })
    })

    test("always includes truncation metadata with plugin metadata", async () => {
      // given
      await using tmp = await tmpdir({
        init: async (dir) => {
          const opencodeDir = path.join(dir, ".opencode")
          await fs.mkdir(opencodeDir, { recursive: true })

          const toolsDir = path.join(opencodeDir, "tools")
          await fs.mkdir(toolsDir, { recursive: true })

          await Bun.write(
            path.join(toolsDir, "metadata.ts"),
            [
              "export default {",
              "  description: 'metadata tool',",
              "  args: {},",
              "  execute: async (_args, ctx) => {",
              "    ctx.metadata({ title: 'test', metadata: { sessionId: 'ses_123' } })",
              "    return 'x'.repeat(60 * 1024)",
              "  },",
              "}",
              "",
            ].join("\n"),
          )
        },
      })

      // when
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const tools = await ToolRegistry.tools({ providerID: "openai", modelID: "gpt-5" })
          const tool = tools.find((item) => item.id === "metadata")
          expect(tool).toBeDefined()
          if (!tool) throw new Error("metadata tool not found")
          const result = await tool.execute({}, ctx)

          // then
          expect(result.title).toBe("test")
          expect(result.metadata.sessionId).toBe("ses_123")
          expect(result.metadata.truncated).toBeTrue()
          expect(result.metadata.outputPath).toBeString()
        },
      })
    })
  })
})
