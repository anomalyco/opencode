import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { ToolRegistry } from "../../src/tool/registry"

const projectRoot = path.join(__dirname, "../..")

describe("tool.registry", () => {
  test("includes list tool", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const ids = await ToolRegistry.ids()
        expect(ids).toContain("list")
      },
    })
  })
})

