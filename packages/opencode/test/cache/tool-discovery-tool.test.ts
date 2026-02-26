import { afterEach, describe, expect, test } from "bun:test"
import { ToolDiscoveryTool } from "../../src/cache"
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

describe("cache.tool-discovery-tool", () => {
  afterEach(() => {
    Cache.close()
  })

  test("returns xml for cached tools", async () => {
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
        await Cache.registerTool({
          id: "github_create_pr",
          name: "github_create_pr",
          description: "Create GitHub pull request",
          schema_json: "{}",
        })
        const tool = await ToolDiscoveryTool.init()
        const out = await tool.execute({ query: "github pr", top_k: 5 }, ctx)
        expect(out.output).toContain("<cached_tools>")
        expect(out.output).toContain("github_create_pr")
        expect(out.output).toContain("Create GitHub pull request")
      },
    })
  })

  test("returns disabled message", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      async fn() {
        const tool = await ToolDiscoveryTool.init()
        const out = await tool.execute({ query: "x" }, ctx)
        expect(out.output).toContain("not enabled")
      },
    })
  })
})
