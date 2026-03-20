import { describe, expect, test } from "bun:test"
import { convertToKiroPayload } from "../../src/provider/sdk/kiro/src/converters"

/**
 * Validates that every toolUse in history has a matching toolResult and vice versa.
 * This is what Kiro API enforces — any mismatch causes 400 "Improperly formed request".
 */
function assertToolPairing(payload: ReturnType<typeof convertToKiroPayload>) {
  const history = payload.conversationState.history
  const current = payload.conversationState.currentMessage

  for (let i = 0; i < history.length; i++) {
    const item = history[i]
    const uses = item.assistantResponseMessage?.toolUses ?? []
    if (uses.length === 0) continue

    // Find the next user message (should be i+1 in alternating structure)
    const next = history[i + 1]
    const results = next?.userInputMessage?.userInputMessageContext?.toolResults ?? []

    // Every toolUse must have a matching toolResult
    for (const use of uses) {
      const match = results.find((r) => r.toolUseId === use.toolUseId)
      if (!match) {
        // Check if it's the last history item and results are in currentMessage
        if (i === history.length - 1) {
          const currentResults = current.userInputMessage.userInputMessageContext?.toolResults ?? []
          const currentMatch = currentResults.find((r) => r.toolUseId === use.toolUseId)
          if (!currentMatch) throw new Error(`toolUse ${use.toolUseId} at history[${i}] has no matching toolResult`)
        } else {
          throw new Error(`toolUse ${use.toolUseId} at history[${i}] has no matching toolResult in history[${i + 1}]`)
        }
      }
    }

    // Every toolResult must have a matching toolUse
    for (const result of results) {
      const match = uses.find((u) => u.toolUseId === result.toolUseId)
      if (!match) throw new Error(`toolResult ${result.toolUseId} at history[${i + 1}] has no matching toolUse`)
    }
  }

  // Validate currentMessage toolResults against last history assistant
  const currentResults = current.userInputMessage.userInputMessageContext?.toolResults ?? []
  if (currentResults.length > 0) {
    const last = history[history.length - 1]
    const lastUses = last?.assistantResponseMessage?.toolUses ?? []
    for (const result of currentResults) {
      const match = lastUses.find((u) => u.toolUseId === result.toolUseId)
      if (!match)
        throw new Error(`currentMessage toolResult ${result.toolUseId} has no matching toolUse in last history item`)
    }
  }
}

const modelId = "claude-opus-4.6"
const tools = [
  {
    type: "function" as const,
    name: "bash",
    description: "Run bash",
    inputSchema: {
      type: "object" as const,
      properties: { command: { type: "string" as const } },
      required: ["command"],
    },
  },
]

describe("kiro tool pairing validation", () => {
  test("normal tool call round-trip is valid", () => {
    const prompt = [
      { role: "user" as const, content: [{ type: "text" as const, text: "Run ls" }] },
      {
        role: "assistant" as const,
        content: [
          { type: "text" as const, text: "Running ls" },
          { type: "tool-call" as const, toolCallId: "call_1", toolName: "bash", input: { command: "ls" } },
        ],
      },
      {
        role: "tool" as const,
        content: [
          {
            type: "tool-result" as const,
            toolCallId: "call_1",
            toolName: "bash",
            output: { type: "text" as const, value: "file.txt" },
          },
        ],
      },
      { role: "assistant" as const, content: [{ type: "text" as const, text: "Found file.txt" }] },
      { role: "user" as const, content: [{ type: "text" as const, text: "thanks" }] },
    ]
    const result = convertToKiroPayload(prompt as any, modelId, tools as any)
    assertToolPairing(result)
  })

  test("multiple tool calls in one assistant turn are paired", () => {
    const prompt = [
      { role: "user" as const, content: [{ type: "text" as const, text: "Setup" }] },
      {
        role: "assistant" as const,
        content: [
          { type: "text" as const, text: "Setting up" },
          { type: "tool-call" as const, toolCallId: "call_a", toolName: "bash", input: { command: "mkdir src" } },
          { type: "tool-call" as const, toolCallId: "call_b", toolName: "bash", input: { command: "mkdir test" } },
        ],
      },
      {
        role: "tool" as const,
        content: [
          {
            type: "tool-result" as const,
            toolCallId: "call_a",
            toolName: "bash",
            output: { type: "text" as const, value: "" },
          },
          {
            type: "tool-result" as const,
            toolCallId: "call_b",
            toolName: "bash",
            output: { type: "text" as const, value: "" },
          },
        ],
      },
      { role: "assistant" as const, content: [{ type: "text" as const, text: "Done" }] },
      { role: "user" as const, content: [{ type: "text" as const, text: "ok" }] },
    ]
    const result = convertToKiroPayload(prompt as any, modelId, tools as any)
    assertToolPairing(result)
  })

  test("tool call as last history item with result in currentMessage", () => {
    const prompt = [
      { role: "user" as const, content: [{ type: "text" as const, text: "Run ls" }] },
      {
        role: "assistant" as const,
        content: [{ type: "tool-call" as const, toolCallId: "call_1", toolName: "bash", input: { command: "ls" } }],
      },
      {
        role: "tool" as const,
        content: [
          {
            type: "tool-result" as const,
            toolCallId: "call_1",
            toolName: "bash",
            output: { type: "text" as const, value: "file.txt" },
          },
        ],
      },
    ]
    const result = convertToKiroPayload(prompt as any, modelId, tools as any)
    assertToolPairing(result)
  })

  test("partial toolResult mismatch — 2 uses but only 1 result", () => {
    // Simulates compaction/pruning dropping one tool result
    const prompt = [
      { role: "user" as const, content: [{ type: "text" as const, text: "Do two things" }] },
      {
        role: "assistant" as const,
        content: [
          { type: "text" as const, text: "I'll do both" },
          { type: "tool-call" as const, toolCallId: "call_x", toolName: "bash", input: { command: "echo 1" } },
          { type: "tool-call" as const, toolCallId: "call_y", toolName: "bash", input: { command: "echo 2" } },
        ],
      },
      {
        role: "tool" as const,
        content: [
          {
            type: "tool-result" as const,
            toolCallId: "call_x",
            toolName: "bash",
            output: { type: "text" as const, value: "1" },
          },
          {
            type: "tool-result" as const,
            toolCallId: "call_y",
            toolName: "bash",
            output: { type: "text" as const, value: "2" },
          },
        ],
      },
      { role: "assistant" as const, content: [{ type: "text" as const, text: "Both done" }] },
      { role: "user" as const, content: [{ type: "text" as const, text: "next" }] },
    ]
    const result = convertToKiroPayload(prompt as any, modelId, tools as any)
    assertToolPairing(result)
  })

  test("consecutive assistant tool calls (merged) with interleaved results", () => {
    // assistant(tool_call_1) -> tool(result_1) -> assistant(tool_call_2) -> tool(result_2) -> assistant(text) -> user
    // The converter merges consecutive assistants, so tool_call_1 and tool_call_2 end up in one assistant.
    // But result_1 flushes as a user message before tool_call_2's assistant.
    const prompt = [
      { role: "user" as const, content: [{ type: "text" as const, text: "Do stuff" }] },
      {
        role: "assistant" as const,
        content: [{ type: "tool-call" as const, toolCallId: "call_1", toolName: "bash", input: { command: "ls" } }],
      },
      {
        role: "tool" as const,
        content: [
          {
            type: "tool-result" as const,
            toolCallId: "call_1",
            toolName: "bash",
            output: { type: "text" as const, value: "a.txt" },
          },
        ],
      },
      {
        role: "assistant" as const,
        content: [
          { type: "tool-call" as const, toolCallId: "call_2", toolName: "bash", input: { command: "cat a.txt" } },
        ],
      },
      {
        role: "tool" as const,
        content: [
          {
            type: "tool-result" as const,
            toolCallId: "call_2",
            toolName: "bash",
            output: { type: "text" as const, value: "content" },
          },
        ],
      },
      { role: "assistant" as const, content: [{ type: "text" as const, text: "Done reading" }] },
      { role: "user" as const, content: [{ type: "text" as const, text: "ok" }] },
    ]
    const result = convertToKiroPayload(prompt as any, modelId, tools as any)
    assertToolPairing(result)
  })

  test("long chain: 5 sequential tool calls", () => {
    const prompt: any[] = [{ role: "user" as const, content: [{ type: "text" as const, text: "Do 5 things" }] }]
    for (let i = 1; i <= 5; i++) {
      prompt.push({
        role: "assistant" as const,
        content: [
          { type: "tool-call" as const, toolCallId: `call_${i}`, toolName: "bash", input: { command: `echo ${i}` } },
        ],
      })
      prompt.push({
        role: "tool" as const,
        content: [
          {
            type: "tool-result" as const,
            toolCallId: `call_${i}`,
            toolName: "bash",
            output: { type: "text" as const, value: `${i}` },
          },
        ],
      })
    }
    prompt.push({ role: "assistant" as const, content: [{ type: "text" as const, text: "All 5 done" }] })
    prompt.push({ role: "user" as const, content: [{ type: "text" as const, text: "great" }] })

    const result = convertToKiroPayload(prompt as any, modelId, tools as any)
    assertToolPairing(result)
  })

  test("tool call followed by user text (no tool result) — orphan toolUse", () => {
    // This simulates a scenario where tool execution was interrupted/cancelled
    // and the next message is a plain user message without tool results
    const prompt = [
      { role: "user" as const, content: [{ type: "text" as const, text: "Run something" }] },
      {
        role: "assistant" as const,
        content: [
          { type: "text" as const, text: "Running" },
          { type: "tool-call" as const, toolCallId: "call_orphan", toolName: "bash", input: { command: "sleep 100" } },
        ],
      },
      // No tool result — user sent a new message directly
      { role: "user" as const, content: [{ type: "text" as const, text: "Cancel that, do something else" }] },
      { role: "assistant" as const, content: [{ type: "text" as const, text: "OK, cancelled" }] },
      { role: "user" as const, content: [{ type: "text" as const, text: "thanks" }] },
    ]
    const result = convertToKiroPayload(prompt as any, modelId, tools as any)
    assertToolPairing(result)
  })

  test("compaction summary replaces tool-heavy history — no tools passed", () => {
    // After compaction, the prompt has tool calls in history but no tools definition.
    // The converter should strip all toolUses/toolResults.
    const prompt = [
      { role: "system" as const, content: "You are helpful" },
      { role: "user" as const, content: [{ type: "text" as const, text: "Run ls" }] },
      {
        role: "assistant" as const,
        content: [
          { type: "text" as const, text: "Running" },
          { type: "tool-call" as const, toolCallId: "call_c1", toolName: "bash", input: { command: "ls" } },
        ],
      },
      {
        role: "tool" as const,
        content: [
          {
            type: "tool-result" as const,
            toolCallId: "call_c1",
            toolName: "bash",
            output: { type: "text" as const, value: "files" },
          },
        ],
      },
      { role: "assistant" as const, content: [{ type: "text" as const, text: "Here are the files" }] },
      { role: "user" as const, content: [{ type: "text" as const, text: "Summarize" }] },
    ]
    // No tools = compaction mode
    const result = convertToKiroPayload(prompt as any, modelId)
    // In compaction mode, all toolUses/toolResults should be stripped
    for (const item of result.conversationState.history) {
      expect(item.assistantResponseMessage?.toolUses).toBeUndefined()
      expect(item.userInputMessage?.userInputMessageContext?.toolResults).toBeUndefined()
    }
    expect(
      result.conversationState.currentMessage.userInputMessage.userInputMessageContext?.toolResults,
    ).toBeUndefined()
  })

  test("assistant with toolUse but empty user content before next assistant — edge case merge", () => {
    // user("") -> assistant(tool_call) -> tool(result) -> assistant(text) -> user
    // The empty user content might not flush, causing merge issues
    const prompt = [
      { role: "user" as const, content: [{ type: "text" as const, text: "" }] },
      {
        role: "assistant" as const,
        content: [{ type: "tool-call" as const, toolCallId: "call_e1", toolName: "bash", input: { command: "ls" } }],
      },
      {
        role: "tool" as const,
        content: [
          {
            type: "tool-result" as const,
            toolCallId: "call_e1",
            toolName: "bash",
            output: { type: "text" as const, value: "out" },
          },
        ],
      },
      { role: "assistant" as const, content: [{ type: "text" as const, text: "Result" }] },
      { role: "user" as const, content: [{ type: "text" as const, text: "ok" }] },
    ]
    const result = convertToKiroPayload(prompt as any, modelId, tools as any)
    assertToolPairing(result)
  })

  test("tool result in user message (AI SDK format) with tool-result in content array", () => {
    // AI SDK sometimes puts tool-result parts directly in user messages
    const prompt = [
      { role: "user" as const, content: [{ type: "text" as const, text: "Run ls" }] },
      {
        role: "assistant" as const,
        content: [{ type: "tool-call" as const, toolCallId: "call_u1", toolName: "bash", input: { command: "ls" } }],
      },
      {
        role: "user" as const,
        content: [
          {
            type: "tool-result" as const,
            toolCallId: "call_u1",
            toolName: "bash",
            output: { type: "text" as const, value: "files" },
          },
          { type: "text" as const, text: "What did you find?" },
        ],
      },
    ]
    const result = convertToKiroPayload(prompt as any, modelId, tools as any)
    assertToolPairing(result)
  })

  test("3 tool calls, middle result missing — partial mismatch in history", () => {
    // Simulates pruning that drops one tool result from the middle
    const prompt = [
      { role: "user" as const, content: [{ type: "text" as const, text: "Do 3 things" }] },
      {
        role: "assistant" as const,
        content: [
          { type: "text" as const, text: "Doing 3 things" },
          { type: "tool-call" as const, toolCallId: "call_p1", toolName: "bash", input: { command: "echo 1" } },
          { type: "tool-call" as const, toolCallId: "call_p2", toolName: "bash", input: { command: "echo 2" } },
          { type: "tool-call" as const, toolCallId: "call_p3", toolName: "bash", input: { command: "echo 3" } },
        ],
      },
      {
        role: "tool" as const,
        content: [
          {
            type: "tool-result" as const,
            toolCallId: "call_p1",
            toolName: "bash",
            output: { type: "text" as const, value: "1" },
          },
          // call_p2 result missing!
          {
            type: "tool-result" as const,
            toolCallId: "call_p3",
            toolName: "bash",
            output: { type: "text" as const, value: "3" },
          },
        ],
      },
      { role: "assistant" as const, content: [{ type: "text" as const, text: "Done" }] },
      { role: "user" as const, content: [{ type: "text" as const, text: "ok" }] },
    ]
    const result = convertToKiroPayload(prompt as any, modelId, tools as any)
    assertToolPairing(result)
  })

  test("empty content user messages are filtered in no-tools mode (re-compact scenario)", () => {
    const prompt = [
      { role: "system" as const, content: "You are a helpful assistant" },
      { role: "user" as const, content: [{ type: "text" as const, text: "Do something" }] },
      { role: "assistant" as const, content: [{ type: "text" as const, text: "I'll help." }] },
      { role: "user" as const, content: [{ type: "text" as const, text: "" }] },
      { role: "assistant" as const, content: [{ type: "text" as const, text: "Done with that." }] },
      { role: "user" as const, content: [{ type: "text" as const, text: "Next question" }] },
      { role: "assistant" as const, content: [{ type: "text" as const, text: "Sure." }] },
      { role: "user" as const, content: [{ type: "text" as const, text: "" }] },
      { role: "assistant" as const, content: [{ type: "text" as const, text: "Finished." }] },
      { role: "user" as const, content: [{ type: "text" as const, text: "Summarize" }] },
    ]
    const result = convertToKiroPayload(prompt as any, modelId)
    const history = result.conversationState.history
    for (const item of history) {
      if (item.userInputMessage) {
        expect(item.userInputMessage.content).not.toBe("")
      }
    }
    for (let i = 1; i < history.length; i++) {
      const prev = history[i - 1]
      const curr = history[i]
      const prevIsUser = !!prev.userInputMessage && !prev.assistantResponseMessage
      const currIsUser = !!curr.userInputMessage && !curr.assistantResponseMessage
      const prevIsAssistant = !!prev.assistantResponseMessage && !prev.userInputMessage
      const currIsAssistant = !!curr.assistantResponseMessage && !curr.userInputMessage
      expect(prevIsUser && currIsUser).toBe(false)
      expect(prevIsAssistant && currIsAssistant).toBe(false)
    }
  })

  test("multiple consecutive empty user messages in no-tools mode", () => {
    const prompt = [
      { role: "user" as const, content: [{ type: "text" as const, text: "Start" }] },
      { role: "assistant" as const, content: [{ type: "text" as const, text: "OK" }] },
      { role: "user" as const, content: [{ type: "text" as const, text: "" }] },
      { role: "assistant" as const, content: [{ type: "text" as const, text: "Continued" }] },
      { role: "user" as const, content: [{ type: "text" as const, text: "" }] },
      { role: "assistant" as const, content: [{ type: "text" as const, text: "More" }] },
      { role: "user" as const, content: [{ type: "text" as const, text: "" }] },
      { role: "assistant" as const, content: [{ type: "text" as const, text: "Final" }] },
      { role: "user" as const, content: [{ type: "text" as const, text: "Summarize" }] },
    ]
    const result = convertToKiroPayload(prompt as any, modelId)
    const history = result.conversationState.history
    for (const item of history) {
      if (item.userInputMessage) {
        expect(item.userInputMessage.content).not.toBe("")
      }
    }
  })
})
