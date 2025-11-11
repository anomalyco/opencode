import { test, expect } from "bun:test"
import { Config } from "../src/config/config"
import { Instance } from "../src/project/instance"
import path from "path"

test("debug config loading", async () => {
  // Set test config
  const testConfig = JSON.stringify({
    model: "test/model",
    plugin: [`file://${path.join(process.cwd(), "examples/plugin-ui-demo/index.ts")}`]
  })
  
  const originalConfigContent = process.env.OPENCODE_CONFIG_CONTENT
  process.env.OPENCODE_CONFIG_CONTENT = testConfig
  
  try {
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        const config = await Config.get()
        console.log("Loaded config plugins:", config.plugin)
        console.log("Process env config content:", process.env.OPENCODE_CONFIG_CONTENT)
        expect(config.plugin).toBeDefined()
        expect(config.plugin?.length).toBeGreaterThan(0)
      }
    })
  } finally {
    // Restore original config
    if (originalConfigContent !== undefined) {
      process.env.OPENCODE_CONFIG_CONTENT = originalConfigContent
    } else {
      delete process.env.OPENCODE_CONFIG_CONTENT
    }
  }
})