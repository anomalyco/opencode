import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { ToolRegistry } from "../../src/tool/registry"

describe("tool.registry hashline routing", () => {
  test("keeps edit and apply_patch for GPT models", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tools = await ToolRegistry.tools({
          providerID: "openai",
          modelID: "gpt-5",
        })
        const ids = tools.map((tool) => tool.id)
        expect(ids).toContain("edit")
        expect(ids).toContain("write")
        expect(ids).toContain("apply_patch")
      },
    })
  })

  test("keeps edit and removes apply_patch for non-GPT models", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tools = await ToolRegistry.tools({
          providerID: "anthropic",
          modelID: "claude-3-7-sonnet",
        })
        const ids = tools.map((tool) => tool.id)
        expect(ids).toContain("edit")
        expect(ids).toContain("write")
        expect(ids).not.toContain("apply_patch")
      },
    })
  })
})
