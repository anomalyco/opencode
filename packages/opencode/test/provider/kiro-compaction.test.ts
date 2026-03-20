import { describe, expect, test } from "bun:test"
import { convertToKiroPayload } from "../../src/provider/sdk/kiro/src/converters"

describe("kiro compaction: tool calls in history + no tools", () => {
  const modelId = "claude-opus-4.6"

  function buildCompactionPrompt() {
    return [
      { role: "system" as const, content: "You are a helpful assistant" },
      { role: "user" as const, content: [{ type: "text" as const, text: "List files in current directory" }] },
      {
        role: "assistant" as const,
        content: [
          { type: "text" as const, text: "I'll list the files for you." },
          { type: "tool-call" as const, toolCallId: "call_001", toolName: "bash", input: { command: "ls" } },
        ],
      },
      {
        role: "tool" as const,
        content: [
          {
            type: "tool-result" as const,
            toolCallId: "call_001",
            toolName: "bash",
            output: { type: "text" as const, value: "file1.txt\nfile2.txt\nREADME.md" },
          },
        ],
      },
      {
        role: "assistant" as const,
        content: [{ type: "text" as const, text: "Found 3 files: file1.txt, file2.txt, README.md" }],
      },
      { role: "user" as const, content: [{ type: "text" as const, text: "Now read README.md" }] },
      {
        role: "assistant" as const,
        content: [
          { type: "tool-call" as const, toolCallId: "call_002", toolName: "read", input: { path: "README.md" } },
        ],
      },
      {
        role: "tool" as const,
        content: [
          {
            type: "tool-result" as const,
            toolCallId: "call_002",
            toolName: "read",
            output: { type: "text" as const, value: "# My Project\nThis is a readme." },
          },
        ],
      },
      {
        role: "assistant" as const,
        content: [{ type: "text" as const, text: "The README contains project documentation." }],
      },
      { role: "user" as const, content: [{ type: "text" as const, text: "What did we do so far?" }] },
      {
        role: "user" as const,
        content: [
          {
            type: "text" as const,
            text: "Provide a detailed prompt for continuing our conversation above.",
          },
        ],
      },
    ]
  }

  function assertValidHistory(history: any[]) {
    for (const item of history) {
      expect(!!item.userInputMessage || !!item.assistantResponseMessage).toBe(true)
      expect(item.assistantResponseMessage?.toolUses).toBeUndefined()
      expect(item.userInputMessage?.userInputMessageContext?.toolResults).toBeUndefined()
    }
    for (let i = 1; i < history.length; i++) {
      const prev = history[i - 1]
      const curr = history[i]
      const prevIsUserOnly = !!prev.userInputMessage && !prev.assistantResponseMessage
      const currIsUserOnly = !!curr.userInputMessage && !curr.assistantResponseMessage
      const prevIsAssistantOnly = !!prev.assistantResponseMessage && !prev.userInputMessage
      const currIsAssistantOnly = !!curr.assistantResponseMessage && !curr.userInputMessage
      if (prevIsUserOnly && currIsUserOnly) throw new Error(`Consecutive user-only at ${i - 1},${i}`)
      if (prevIsAssistantOnly && currIsAssistantOnly) throw new Error(`Consecutive assistant-only at ${i - 1},${i}`)
    }
  }

  test("payload has non-empty currentMessage content", () => {
    const result = convertToKiroPayload(buildCompactionPrompt() as any, modelId)
    const content = result.conversationState.currentMessage.userInputMessage.content
    expect(content).not.toBe(".")
    expect(content.length).toBeGreaterThan(10)
  })

  test("history is valid after stripping tools", () => {
    const result = convertToKiroPayload(buildCompactionPrompt() as any, modelId)
    assertValidHistory(result.conversationState.history)
  })

  test("no (empty) assistant content remains after stripping", () => {
    const result = convertToKiroPayload(buildCompactionPrompt() as any, modelId)
    for (const item of result.conversationState.history) {
      if (item.assistantResponseMessage) {
        expect(item.assistantResponseMessage.content).not.toBe("(empty)")
      }
    }
  })

  test("currentMessage has no toolResults when no tools defined", () => {
    const result = convertToKiroPayload(buildCompactionPrompt() as any, modelId)
    expect(
      result.conversationState.currentMessage.userInputMessage.userInputMessageContext?.toolResults,
    ).toBeUndefined()
  })

  test("tool-call-only assistant turn is properly handled", () => {
    const prompt = [
      { role: "user" as const, content: [{ type: "text" as const, text: "Do something" }] },
      {
        role: "assistant" as const,
        content: [
          { type: "tool-call" as const, toolCallId: "call_x", toolName: "bash", input: { command: "echo hi" } },
        ],
      },
      {
        role: "tool" as const,
        content: [
          {
            type: "tool-result" as const,
            toolCallId: "call_x",
            toolName: "bash",
            output: { type: "text" as const, value: "hi" },
          },
        ],
      },
      {
        role: "assistant" as const,
        content: [{ type: "text" as const, text: "Done!" }],
      },
      { role: "user" as const, content: [{ type: "text" as const, text: "Summarize" }] },
    ]

    const result = convertToKiroPayload(prompt as any, modelId)
    assertValidHistory(result.conversationState.history)
  })

  test("multiple consecutive tool calls are handled", () => {
    const prompt = [
      { role: "user" as const, content: [{ type: "text" as const, text: "Set up the project" }] },
      {
        role: "assistant" as const,
        content: [
          { type: "text" as const, text: "I'll set up the project." },
          { type: "tool-call" as const, toolCallId: "call_a", toolName: "bash", input: { command: "mkdir src" } },
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
        ],
      },
      {
        role: "assistant" as const,
        content: [
          {
            type: "tool-call" as const,
            toolCallId: "call_b",
            toolName: "bash",
            input: { command: "touch src/index.ts" },
          },
        ],
      },
      {
        role: "tool" as const,
        content: [
          {
            type: "tool-result" as const,
            toolCallId: "call_b",
            toolName: "bash",
            output: { type: "text" as const, value: "" },
          },
        ],
      },
      {
        role: "assistant" as const,
        content: [{ type: "text" as const, text: "Project structure created." }],
      },
      { role: "user" as const, content: [{ type: "text" as const, text: "Compact this conversation" }] },
    ]

    const result = convertToKiroPayload(prompt as any, modelId)
    assertValidHistory(result.conversationState.history)
    expect(result.conversationState.currentMessage.userInputMessage.content).not.toBe(".")
  })

  test("compaction with minimal user content before tool-heavy history", () => {
    const prompt = [
      { role: "system" as const, content: "System prompt" },
      { role: "user" as const, content: [{ type: "text" as const, text: "." }] },
      {
        role: "assistant" as const,
        content: [
          { type: "tool-call" as const, toolCallId: "call_z", toolName: "bash", input: { command: "ls" } },
        ],
      },
      {
        role: "tool" as const,
        content: [
          {
            type: "tool-result" as const,
            toolCallId: "call_z",
            toolName: "bash",
            output: { type: "text" as const, value: "output" },
          },
        ],
      },
      {
        role: "assistant" as const,
        content: [{ type: "text" as const, text: "Here are the results." }],
      },
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: "Provide a detailed prompt for continuing our conversation above." },
        ],
      },
    ]

    const result = convertToKiroPayload(prompt as any, modelId)
    expect(result.conversationState.currentMessage.userInputMessage.content).toContain("Provide a detailed prompt")
    assertValidHistory(result.conversationState.history)
  })
})
