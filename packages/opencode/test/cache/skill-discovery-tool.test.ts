import { afterEach, describe, expect, test } from "bun:test"
import { SkillDiscoveryTool } from "../../src/cache"
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

describe("cache.skill-discovery-tool", () => {
  afterEach(() => {
    Cache.close()
  })

  test("returns names and descriptions with usage hint", async () => {
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
        await Cache.registerSkill({ name: "release-notes", description: "Write release notes", location: "/tmp" })
        const tool = await SkillDiscoveryTool.init()
        const out = await tool.execute({ query: "release notes", top_k: 5 }, ctx)
        expect(out.output).toContain("release-notes")
        expect(out.output).toContain("Write release notes")
        expect(out.output).toContain("skill({ name")
      },
    })
  })
})
