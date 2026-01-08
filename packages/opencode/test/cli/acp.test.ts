import { describe, expect, test } from "bun:test"
import type { ACPConfig } from "../../src/acp/types"

describe("ACP command with --prompt", () => {
  test("ACPConfig should accept initialPrompt parameter", () => {
    const config: ACPConfig = {
      sdk: {} as any,
      initialPrompt: "Test prompt",
    }

    expect(config.initialPrompt).toBe("Test prompt")
  })

  test("ACPConfig should allow undefined initialPrompt", () => {
    const config: ACPConfig = {
      sdk: {} as any,
      initialPrompt: undefined,
    }

    expect(config.initialPrompt).toBeUndefined()
  })

  test("ACPConfig should allow missing initialPrompt", () => {
    const config: ACPConfig = {
      sdk: {} as any,
    }

    expect(config.initialPrompt).toBeUndefined()
  })
})
