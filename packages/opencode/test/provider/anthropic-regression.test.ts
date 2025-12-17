import { describe, expect, test } from "bun:test"
import { ProviderTransform } from "../../src/provider/transform"

// Captured from real failure session: ses_4d850e648ffeMbgrOKB414Tqg3
// The error was: tool_use ids were found without tool_result blocks immediately after
const capturedFailure = [
  {
    role: "assistant",
    content: [
      {
        type: "text",
        text: "I'll start by checking the current directory content.",
      },
      {
        type: "tool-call",
        toolCallId: "toolu_019hSrXPt81Z1PU9dfRjDDNj",
        toolName: "bash",
        args: { command: "ls -F" },
      },
      {
        type: "tool-call",
        toolCallId: "toolu_014QNwQfdnni2HdHSLozPw88",
        toolName: "bash",
        args: { command: "ls -la" },
      },
      {
        type: "tool-call",
        toolCallId: "toolu_01Fq2H7Q59Y9xZ8X2X2X2X2X",
        toolName: "bash",
        args: { command: "pwd" },
      },
    ],
  },
  {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: "toolu_019hSrXPt81Z1PU9dfRjDDNj",
        toolName: "bash",
        result: "file1.txt\nfile2.txt",
      },
      {
        type: "tool-result",
        toolCallId: "toolu_014QNwQfdnni2HdHSLozPw88",
        toolName: "bash",
        result: "total 0\n-rw-r--r-- 1 user user 0 Dec 1 00:00 file1.txt",
      },
      {
        type: "tool-result",
        toolCallId: "toolu_01Fq2H7Q59Y9xZ8X2X2X2X2X",
        toolName: "bash",
        result: "/home/user",
      },
    ],
  },
]

const mockClaudeModel = {
  id: "anthropic/claude-3-5-sonnet",
  providerID: "anthropic",
  api: {
    id: "claude-3-5-sonnet-20241022",
    url: "https://api.anthropic.com",
    npm: "@ai-sdk/anthropic",
  },
  name: "Claude 3.5 Sonnet",
  capabilities: {
    toolcall: true,
  },
} as any

describe("Anthropic Regression: Tool Interleaving", () => {
  test("should split batched tool calls into interleaved pairs", () => {
    // @ts-expect-error
    const result = ProviderTransform.message(capturedFailure, mockClaudeModel)

    // Should expand from 2 messages to 6 messages (3 pairs)
    // Pair 1: assistant(text + call 1) -> tool(result 1)
    // Pair 2: assistant(call 2) -> tool(result 2)
    // Pair 3: assistant(call 3) -> tool(result 3)

    // We expect at least more than 2 messages if interleaving happened
    expect(result.length).toBeGreaterThan(2)

    // Verify strict alternation
    for (let i = 0; i < result.length; i++) {
      const msg = result[i]
      if (msg.role === "assistant") {
        const calls = (msg.content as any[]).filter((c) => c.type === "tool-call")
        // Each assistant message should have exactly 1 tool call (except potentially the first one if it had text)
        // Actually our implementation allows text + 1 tool call, or just 1 tool call
        expect(calls.length).toBeLessThanOrEqual(1)

        if (calls.length === 1) {
          // The next message MUST be a tool result for this ID
          const callId = calls[0].toolCallId
          const nextMsg = result[i + 1]
          expect(nextMsg.role).toBe("tool")
          const results = (nextMsg.content as any[]).filter((c) => c.type === "tool-result")
          expect(results.length).toBe(1)
          expect(results[0].toolCallId).toBe(callId)
        }
      }
    }
  })
})
