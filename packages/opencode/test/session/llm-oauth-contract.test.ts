import { describe, expect, test } from "bun:test"
import path from "path"

const llmPath = path.join(import.meta.dir, "../../src/session/llm.ts")

describe("anthropic oauth contract", () => {
  test("includes Claude Code identity, beta headers, and oauth guardrails", async () => {
    const src = await Bun.file(llmPath).text()
    expect(src).toContain("You are Claude Code, Anthropic's official CLI for Claude.")
    expect(src).toContain("claude-code-20250219,oauth-2025-04-20,fine-grained-tool-streaming-2025-05-14,interleaved-thinking-2025-05-14")
    expect(src).toContain("\"anthropic-dangerous-direct-browser-access\": \"true\"")
    expect(src).toContain("isAnthropicOauth")
  })

  test("maps outbound tool names to PascalCase in Anthropic OAuth mode", async () => {
    const src = await Bun.file(llmPath).text()
    expect(src).toContain("mapToolsToPascalCase")
    expect(src).toContain("split(/[^a-zA-Z0-9]+/)")
    expect(src).toContain("transformed[toPascalCase(name)] = value")
  })
})
