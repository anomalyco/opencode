import { describe, test, expect } from "bun:test"
import { readFileSync } from "fs"
import { resolve } from "path"

describe("shell.env hook type alignment", () => {
  const pluginSrc = readFileSync(resolve(import.meta.dir, "../../../plugin/src/index.ts"), "utf-8")
  const bashSrc = readFileSync(resolve(import.meta.dir, "../../src/tool/bash.ts"), "utf-8")

  // Regression: bash.ts passed messageID and agent to the shell.env hook,
  // but the plugin SDK type only declared { cwd, sessionID?, callID? }.
  // Plugin authors couldn't see the new fields in their IDE.
  test("plugin SDK shell.env input type includes messageID", () => {
    const match = pluginSrc.match(/"shell\.env"\?[\s\S]*?input:\s*\{([^}]+)\}/)
    expect(match).not.toBeNull()
    expect(match![1]).toContain("messageID")
  })

  test("plugin SDK shell.env input type includes agent", () => {
    const match = pluginSrc.match(/"shell\.env"\?[\s\S]*?input:\s*\{([^}]+)\}/)
    expect(match).not.toBeNull()
    expect(match![1]).toContain("agent")
  })

  test("bash.ts passes messageID and agent to shell.env trigger", () => {
    // Verify bash.ts actually sends these fields so the types stay in sync
    const triggerMatch = bashSrc.match(/Plugin\.trigger\(\s*"shell\.env"[\s\S]*?\{([^}]+)\}/)
    expect(triggerMatch).not.toBeNull()
    expect(triggerMatch![1]).toContain("messageID")
    expect(triggerMatch![1]).toContain("agent")
  })
})
