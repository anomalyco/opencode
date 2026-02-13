import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Tool } from "../../src/tool/tool"

function plugin(hooks: string) {
  return ["const plugin = async (input) => ({", hooks, "})", "export default plugin"].join("\n")
}

function capture(hook: string, file: string, fields: string) {
  return [
    `  "${hook}": async (hookInput, output) => {`,
    '    const fs = await import("fs/promises")',
    '    const path = await import("path")',
    `    await fs.writeFile(path.join(input.directory, "${file}"), JSON.stringify(${fields}))`,
    "  },",
  ].join("\n")
}

async function setup(dir: string, hooks: string) {
  const plugins = path.join(dir, ".opencode", "plugins")
  await fs.mkdir(plugins, { recursive: true })
  await Bun.write(path.join(plugins, "capture.ts"), plugin(hooks))
}

async function read(dir: string, file: string) {
  return JSON.parse(await fs.readFile(path.join(dir, file), "utf-8"))
}

describe("Tool.invoke", () => {
  test("fires before and after hooks on success", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {},
      init: (dir) =>
        setup(
          dir,
          [
            capture(
              "tool.execute.before",
              ".before.json",
              "{ tool: hookInput.tool, agent: hookInput.agent, callID: hookInput.callID, args: output.args }",
            ),
            capture(
              "tool.execute.after",
              ".after.json",
              "{ tool: hookInput.tool, agent: hookInput.agent, title: output.title, output: output.output, status: output.status }",
            ),
          ].join("\n"),
        ),
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await Tool.invoke({
          tool: "read",
          args: { file: "foo.ts" },
          ctx: { sessionID: "s1", callID: "c1", agent: "build" },
          fn: async () => ({ title: "Read", output: "contents", metadata: {} }),
        })

        expect(result.title).toBe("Read")
        expect(result.output).toBe("contents")

        const before = await read(tmp.path, ".before.json")
        expect(before.tool).toBe("read")
        expect(before.agent).toBe("build")
        expect(before.callID).toBe("c1")
        expect(before.args).toEqual({ file: "foo.ts" })

        const after = await read(tmp.path, ".after.json")
        expect(after.tool).toBe("read")
        expect(after.title).toBe("Read")
        expect(after.output).toBe("contents")
        expect(after.status).toBe("success")
      },
    })
  })

  test("fires after hook with error metadata when fn throws", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {},
      init: (dir) =>
        setup(
          dir,
          capture(
            "tool.execute.after",
            ".after.json",
            "{ tool: hookInput.tool, metadata: output.metadata, status: output.status }",
          ),
        ),
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(
          Tool.invoke({
            tool: "edit",
            args: {},
            ctx: { sessionID: "s1", callID: "c1", agent: "build" },
            fn: async () => {
              throw new Error("disk full")
            },
          }),
        ).rejects.toThrow("disk full")

        const after = await read(tmp.path, ".after.json")
        expect(after.tool).toBe("edit")
        expect(after.status).toBe("error")
        expect(after.metadata.error).toBe("disk full")
      },
    })
  })

  test("passes parentAgent through to hooks", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {},
      init: (dir) =>
        setup(
          dir,
          capture(
            "tool.execute.before",
            ".before.json",
            "{ agent: hookInput.agent, parentAgent: hookInput.parentAgent ?? null }",
          ),
        ),
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Tool.invoke({
          tool: "bash",
          args: {},
          ctx: { sessionID: "s1", callID: "c1", agent: "explore", parentAgent: "build" },
          fn: async () => ({ title: "", output: "", metadata: {} }),
        })

        const before = await read(tmp.path, ".before.json")
        expect(before.agent).toBe("explore")
        expect(before.parentAgent).toBe("build")
      },
    })
  })

  test("defaults callID to empty string", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {},
      init: (dir) => setup(dir, capture("tool.execute.before", ".before.json", "{ callID: hookInput.callID }")),
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Tool.invoke({
          tool: "read",
          args: {},
          ctx: { sessionID: "s1", agent: "build" },
          fn: async () => ({ title: "", output: "", metadata: {} }),
        })

        const before = await read(tmp.path, ".before.json")
        expect(before.callID).toBe("")
      },
    })
  })

  test("returns result unchanged", async () => {
    await using tmp = await tmpdir({ git: true, config: {} })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await Tool.invoke({
          tool: "read",
          args: {},
          ctx: { sessionID: "s1", agent: "build" },
          fn: async () => ({ title: "t", output: "o", metadata: { x: 1 }, attachments: [] }),
        })

        expect(result.title).toBe("t")
        expect(result.output).toBe("o")
        expect(result.metadata).toEqual({ x: 1 })
        expect(result.attachments).toEqual([])
      },
    })
  })
})
