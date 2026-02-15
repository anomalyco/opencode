import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { ToolRegistry } from "../../src/tool/registry"

async function ids(client: string, flag?: string) {
  const originalClient = process.env["OPENCODE_CLIENT"]
  const originalFlag = process.env["OPENCODE_EXPERIMENTAL_QUESTION_TOOL"]

  try {
    process.env["OPENCODE_CLIENT"] = client
    if (flag === undefined) delete process.env["OPENCODE_EXPERIMENTAL_QUESTION_TOOL"]
    if (flag !== undefined) process.env["OPENCODE_EXPERIMENTAL_QUESTION_TOOL"] = flag

    await using tmp = await tmpdir()
    return await Instance.provide({
      directory: tmp.path,
      fn: async () => ToolRegistry.ids(),
    })
  } finally {
    if (originalClient === undefined) delete process.env["OPENCODE_CLIENT"]
    if (originalClient !== undefined) process.env["OPENCODE_CLIENT"] = originalClient

    if (originalFlag === undefined) delete process.env["OPENCODE_EXPERIMENTAL_QUESTION_TOOL"]
    if (originalFlag !== undefined) process.env["OPENCODE_EXPERIMENTAL_QUESTION_TOOL"] = originalFlag
  }
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

  test("excludes question tool for acp when experimental flag is unset", async () => {
    expect(await ids("acp")).not.toContain("question")
  })

  test("excludes question tool for acp when experimental flag is 0", async () => {
    expect(await ids("acp", "0")).not.toContain("question")
  })

  test("includes question tool for acp when experimental flag is enabled", async () => {
    expect(await ids("acp", "1")).toContain("question")
    expect(await ids("acp", "true")).toContain("question")
  })

  test("keeps question tool for app, cli, and desktop", async () => {
    expect(await ids("app", "0")).toContain("question")
    expect(await ids("cli", "0")).toContain("question")
    expect(await ids("desktop", "0")).toContain("question")
  })
})
