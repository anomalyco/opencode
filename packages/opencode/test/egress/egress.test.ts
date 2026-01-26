import { describe, expect, test } from "bun:test"
import { isEgressBlocked, hostAllowed, packageAllowed } from "../../src/net/egress-policy"

describe("egress policy", () => {
  test("blocks external hosts when enabled", () => {
    process.env.OPENCODE_BLOCK_EXTERNAL_APIS = "1"
    expect(isEgressBlocked()).toBe(true)
    expect(hostAllowed("https://api.github.com/")).toBe(true)
    expect(hostAllowed("https://localhost:3000")).toBe(true)
    expect(hostAllowed("https://127.0.0.1:3000")).toBe(true)
    expect(hostAllowed("https://api.stripe.com/")).toBe(false)
    delete process.env.OPENCODE_BLOCK_EXTERNAL_APIS
  })

  test("packageAllowed respects whitelist", () => {
    process.env.OPENCODE_BLOCK_EXTERNAL_APIS = "1"
    expect(packageAllowed("@ai-sdk/github-copilot")).toBe(true)
    expect(packageAllowed("@ai-sdk/openai-compatible")).toBe(true)
    expect(packageAllowed("stripe")).toBe(false)
    delete process.env.OPENCODE_BLOCK_EXTERNAL_APIS
  })
})
