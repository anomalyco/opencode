import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { ConfigAgentV1 } from "@opencode-ai/core/v1/config/agent"

const decode = Schema.decodeUnknownSync(ConfigAgentV1.Info)

describe("ConfigAgentV1 tool_choice", () => {
  test("keeps tool_choice as a known top-level field", () => {
    const agent = decode({ tool_choice: "required" })
    expect(agent.tool_choice).toBe("required")
    expect(agent.options?.["tool_choice"]).toBeUndefined()
  })

  test("rejects an unknown tool_choice value", () => {
    expect(() => decode({ tool_choice: "sometimes" })).toThrow()
  })
})
