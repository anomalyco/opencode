import { afterEach, describe, expect, test } from "bun:test"
import { ToolEnableTool } from "../../src/cache"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Cache } from "../../src/cache"
import type { Tool } from "../../src/tool/tool"

const ctx: Tool.Context = {
  sessionID: "test",
  messageID: "test",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

describe("cache.tool-enable-tool", () => {
  afterEach(() => {
    Cache.close()
  })

  test("promotes a known tool", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        experimental: {
          cache: {
            enabled: true,
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      async fn() {
        await Cache.registerTool({ id: "x", name: "x", description: "tool x", schema_json: "{}" })
        const tool = await ToolEnableTool.init()
        const out = await tool.execute({ id: "x" }, ctx)
        expect(out.output).toContain("now active")
        const l1 = await Cache.l1Tools()
        expect(l1.has("x")).toBe(true)
      },
    })
  })

  test("returns message for unknown tool", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        experimental: {
          cache: {
            enabled: true,
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      async fn() {
        const tool = await ToolEnableTool.init()
        const out = await tool.execute({ id: "missing" }, ctx)
        expect(out.output).toContain("not found")
      },
    })
  })
})
