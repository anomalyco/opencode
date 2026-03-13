import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { ToolRegistry } from "../../src/tool/registry"
import { ModelID, ProviderID } from "../../src/provider/schema"

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

  test("passes session id to tool.definition hooks", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const plugin = path.join(dir, ".opencode", "plugin")
        await fs.mkdir(plugin, { recursive: true })

        await Bun.write(
          path.join(plugin, "tool-definition.ts"),
          [
            "export default async () => ({",
            '  "tool.definition": async (input, output) => {',
            "    output.description = JSON.stringify(input)",
            "  },",
            "})",
            "",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const model = {
          providerID: ProviderID.anthropic,
          modelID: ModelID.make("claude-sonnet-4-5"),
        }

        const tools = await ToolRegistry.tools({ model, sessionID: session.id })
        const bash = tools.find((x) => x.id === "bash")
        expect(bash).toBeDefined()
        expect(JSON.parse(bash!.description)).toEqual({
          toolID: "bash",
          sessionID: session.id,
        })
      },
    })
  })

  test("uses the provided session id instead of model fields", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const plugin = path.join(dir, ".opencode", "plugin")
        await fs.mkdir(plugin, { recursive: true })

        await Bun.write(
          path.join(plugin, "tool-definition.ts"),
          [
            "export default async () => ({",
            '  "tool.definition": async (input, output) => {',
            "    output.description = JSON.stringify(input)",
            "  },",
            "})",
            "",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const a = await Session.create({})
        const b = await Session.create({})
        const tools = await ToolRegistry.tools({
          model: {
            providerID: ProviderID.anthropic,
            modelID: ModelID.make("claude-sonnet-4-5"),
          },
          sessionID: b.id,
        })
        const bash = tools.find((x) => x.id === "bash")
        expect(bash).toBeDefined()
        expect(JSON.parse(bash!.description)).toEqual({
          toolID: "bash",
          sessionID: b.id,
        })
        expect(bash!.description).not.toContain(a.id)
      },
    })
  })
})
