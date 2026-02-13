import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Tool } from "../../src/tool/tool"

function stateful(hooks: string) {
  return [
    "const plugin = async (input) => {",
    "  const calls = []",
    "  return {",
    hooks,
    "  }",
    "}",
    "export default plugin",
  ].join("\n")
}

function capture(hook: string, file: string, push: string) {
  return [
    `    "${hook}": async (hookInput, output) => {`,
    `      calls.push(${push})`,
    '      const fs = await import("fs/promises")',
    '      const path = await import("path")',
    `      await fs.writeFile(path.join(input.directory, "${file}"), JSON.stringify(calls))`,
    "    },",
  ].join("\n")
}

async function setup(dir: string, hooks: string) {
  const plugins = path.join(dir, ".opencode", "plugins")
  await fs.mkdir(plugins, { recursive: true })
  await Bun.write(path.join(plugins, "capture.ts"), stateful(hooks))
}

async function read(dir: string, file: string) {
  return JSON.parse(await fs.readFile(path.join(dir, file), "utf-8"))
}

describe("Tool.invoke parallel", () => {
  test("concurrent calls each fire before and after hooks", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {},
      init: (dir) =>
        setup(
          dir,
          [
            capture("tool.execute.before", ".hooks.json", "{ type: 'before', tool: hookInput.tool }"),
            capture(
              "tool.execute.after",
              ".hooks.json",
              "{ type: 'after', tool: hookInput.tool, output: output.output }",
            ),
          ].join("\n"),
        ),
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Promise.all([
          Tool.invoke({
            tool: "read",
            args: { file: "a.txt" },
            ctx: { sessionID: "s1", callID: "c1", agent: "build" },
            fn: async () => ({ title: "Read a", output: "aaa", metadata: {} }),
          }),
          Tool.invoke({
            tool: "grep",
            args: { pattern: "foo" },
            ctx: { sessionID: "s1", callID: "c2", agent: "build" },
            fn: async () => ({ title: "Grep", output: "bbb", metadata: {} }),
          }),
        ])

        const hooks: { type: string; tool: string }[] = await read(tmp.path, ".hooks.json")
        expect(hooks).toHaveLength(4)
        expect(hooks.filter((h) => h.type === "before")).toHaveLength(2)
        expect(hooks.filter((h) => h.type === "after")).toHaveLength(2)

        const tools = hooks
          .filter((h) => h.type === "before")
          .map((h) => h.tool)
          .sort()
        expect(tools).toEqual(["grep", "read"])
      },
    })
  })

  test("failed call still fires after hook", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {},
      init: (dir) =>
        setup(
          dir,
          [
            capture("tool.execute.before", ".hooks.json", "{ type: 'before', tool: hookInput.tool }"),
            capture(
              "tool.execute.after",
              ".hooks.json",
              "{ type: 'after', tool: hookInput.tool, metadata: output.metadata }",
            ),
          ].join("\n"),
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
              throw new Error("not found")
            },
          }),
        ).rejects.toThrow("not found")

        const hooks: { type: string; tool: string; metadata?: Record<string, unknown> }[] = await read(
          tmp.path,
          ".hooks.json",
        )
        expect(hooks).toHaveLength(2)
        expect(hooks[0].type).toBe("before")
        expect(hooks[1].type).toBe("after")
        expect(hooks[1].metadata?.error).toBe("not found")
      },
    })
  })
})
