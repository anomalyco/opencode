import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Identifier } from "../../src/id/id"
import { BatchTool } from "../../src/tool/batch"

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

describe("batch integration", () => {
  // proves batch.ts:79 actually calls Tool.invoke — plugin hooks fire for sub-tools
  test("sub-tool calls fire plugin hooks end-to-end", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {},
      init: async (dir) => {
        const plugins = path.join(dir, ".opencode", "plugins")
        await fs.mkdir(plugins, { recursive: true })
        await Bun.write(
          path.join(plugins, "capture.ts"),
          stateful(
            [
              capture("tool.execute.before", ".hooks.json", "{ type: 'before', tool: hookInput.tool }"),
              capture(
                "tool.execute.after",
                ".hooks.json",
                "{ type: 'after', tool: hookInput.tool, status: output.status }",
              ),
            ].join("\n"),
          ),
        )
        await Bun.write(path.join(dir, "test.txt"), "hello world")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const messageID = Identifier.ascending("message")
        await Session.updateMessage({
          id: messageID,
          role: "assistant",
          sessionID: session.id,
          parentID: messageID,
          mode: "code",
          agent: "code",
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: "test/model",
          providerID: "test",
          time: { created: Date.now() },
          path: { cwd: tmp.path, root: tmp.path },
        })

        const batch = await BatchTool.init()
        const result = await batch.execute(
          {
            tool_calls: [
              {
                tool: "read",
                parameters: { filePath: path.join(tmp.path, "test.txt") },
              },
            ],
          },
          {
            sessionID: session.id,
            messageID,
            callID: "batch-call",
            agent: "code",
            abort: AbortSignal.any([]),
            messages: [],
            metadata: () => {},
            ask: async () => {},
          },
        )

        expect(result.metadata.successful).toBe(1)
        expect(result.metadata.failed).toBe(0)

        const raw = await fs.readFile(path.join(tmp.path, ".hooks.json"), "utf-8")
        const hooks: { type: string; tool: string; status?: string }[] = JSON.parse(raw)

        const before = hooks.filter((h) => h.type === "before" && h.tool === "read")
        const after = hooks.filter((h) => h.type === "after" && h.tool === "read")

        expect(before).toHaveLength(1)
        expect(after).toHaveLength(1)
        expect(after[0].status).toBe("success")

        await Session.remove(session.id)
      },
    })
  })
})
