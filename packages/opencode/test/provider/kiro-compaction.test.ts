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

describe("kiro fitKiroPayload: overflow reduction", () => {
  const modelId = "claude-opus-4.6"

  // Generate a tool with a large JSON schema to inflate byte size
  function bigTool(name: string, sizeKB: number) {
    const props: Record<string, unknown> = {}
    const count = Math.ceil((sizeKB * 1024) / 40)
    for (let i = 0; i < count; i++) props[`field_${i}`] = { type: "string", description: `Field ${i}` }
    return {
      type: "function" as const,
      name,
      description: `Tool ${name}`,
      inputSchema: { type: "object", properties: props },
    }
  }

  // Build a prompt that exceeds 600KB byte limit via many history turns
  // Uses short repeated strings to keep tiktoken fast while inflating byte size
  function buildOverflowByTokens() {
    // ~700 chars per filler × 2 (assistant+tool) × 200 turns ≈ 280KB of filler alone
    // plus JSON overhead pushes well over 600KB
    const filler = "abcdefghij ".repeat(70)
    const msgs: any[] = [
      { role: "system" as const, content: "You are a helpful assistant" },
    ]
    for (let i = 0; i < 200; i++) {
      msgs.push(
        { role: "user" as const, content: [{ type: "text", text: `Step ${i}` }] },
        {
          role: "assistant" as const,
          content: [
            { type: "text", text: filler },
            { type: "tool-call", toolCallId: `tc_${i}`, toolName: "bash", input: { command: "ls" } },
          ],
        },
        {
          role: "tool" as const,
          content: [
            { type: "tool-result", toolCallId: `tc_${i}`, toolName: "bash", output: { type: "text", value: filler } },
          ],
        },
      )
    }
    msgs.push(
      { role: "assistant" as const, content: [{ type: "text", text: "Done." }] },
      { role: "user" as const, content: [{ type: "text", text: "Continue" }] },
    )
    return msgs
  }

  // Build a prompt where tool schemas push byte size over 600KB but tokens stay low
  function buildOverflowByBytes() {
    const tools = Array.from({ length: 30 }, (_, i) => bigTool(`tool_${i}`, 25))
    const msgs: any[] = [
      { role: "system" as const, content: "You are a helpful assistant" },
      { role: "user" as const, content: [{ type: "text", text: "Hello" }] },
      { role: "assistant" as const, content: [{ type: "text", text: "Hi there" }] },
      { role: "user" as const, content: [{ type: "text", text: "Do something" }] },
    ]
    return { msgs, tools }
  }

  test("token overflow: payload is reduced to fit within limits", () => {
    const prompt = buildOverflowByTokens()
    const tools = [
      { type: "function" as const, name: "bash", description: "Run bash", inputSchema: { type: "object", properties: { command: { type: "string" } } } },
    ]
    const result = convertToKiroPayload(prompt as any, modelId, tools as any)
    const bytes = JSON.stringify(result).length
    // fitKiroPayload should have reduced it
    expect(bytes).toBeLessThanOrEqual(600_000)
  })

  test("byte overflow: payload with large history is reduced below byte limit", () => {
    // Build history that exceeds 600KB in bytes but stays under token limit
    // by using many turns with moderate-size tool results
    const chunk = "data_value ".repeat(500)
    const tools = [
      { type: "function" as const, name: "bash", description: "Run bash", inputSchema: { type: "object", properties: { command: { type: "string" } } } },
    ]
    const msgs: any[] = [
      { role: "system" as const, content: "You are a helpful assistant" },
    ]
    for (let i = 0; i < 80; i++) {
      msgs.push(
        { role: "user" as const, content: [{ type: "text", text: `Do step ${i}` }] },
        {
          role: "assistant" as const,
          content: [
            { type: "text", text: chunk },
            { type: "tool-call", toolCallId: `tc_${i}`, toolName: "bash", input: { command: "ls" } },
          ],
        },
        {
          role: "tool" as const,
          content: [
            { type: "tool-result", toolCallId: `tc_${i}`, toolName: "bash", output: { type: "text", value: chunk } },
          ],
        },
      )
    }
    msgs.push(
      { role: "assistant" as const, content: [{ type: "text", text: "Done." }] },
      { role: "user" as const, content: [{ type: "text", text: "Continue" }] },
    )
    const result = convertToKiroPayload(msgs as any, modelId, tools as any)
    const bytes = JSON.stringify(result).length
    expect(bytes).toBeLessThanOrEqual(600_000)
  })

  test("small payload is not modified by fitKiroPayload", () => {
    const msgs: any[] = [
      { role: "user" as const, content: [{ type: "text", text: "Hello" }] },
      { role: "assistant" as const, content: [{ type: "text", text: "Hi" }] },
      { role: "user" as const, content: [{ type: "text", text: "How are you?" }] },
    ]
    const result = convertToKiroPayload(msgs as any, modelId)
    // History should still contain the conversation
    expect(result.conversationState.history.length).toBeGreaterThanOrEqual(2)
  })

  test("overflow reduction preserves first 2 history items (system context)", () => {
    const prompt = buildOverflowByTokens()
    const result = convertToKiroPayload(prompt as any, modelId)
    // System prompt becomes first 2 history items (user instruction + assistant ack)
    expect(result.conversationState.history.length).toBeGreaterThanOrEqual(2)
    expect(result.conversationState.history[0].userInputMessage?.content).toContain(
      "SYSTEM INSTRUCTIONS",
    )
  })

  test("overflow reduction keeps valid alternation", () => {
    const prompt = buildOverflowByTokens()
    const result = convertToKiroPayload(prompt as any, modelId)
    const history = result.conversationState.history
    for (let i = 1; i < history.length; i++) {
      const prev = history[i - 1]
      const curr = history[i]
      const prevUser = !!prev.userInputMessage && !prev.assistantResponseMessage
      const currUser = !!curr.userInputMessage && !curr.assistantResponseMessage
      const prevAssist = !!prev.assistantResponseMessage && !prev.userInputMessage
      const currAssist = !!curr.assistantResponseMessage && !curr.userInputMessage
      expect(prevUser && currUser).toBe(false)
      expect(prevAssist && currAssist).toBe(false)
    }
  })

  test("tool-result compaction happens before history drop", () => {
    const big = "abcdefghij ".repeat(60_000)
    const tools = [
      { type: "function" as const, name: "bash", description: "Run bash", inputSchema: { type: "object", properties: { command: { type: "string" } } } },
    ]
    const msgs: any[] = [
      { role: "system" as const, content: "System" },
      { role: "user" as const, content: [{ type: "text", text: "Go" }] },
      {
        role: "assistant" as const,
        content: [
          { type: "text", text: "Running" },
          { type: "tool-call", toolCallId: "tc_big", toolName: "bash", input: { command: "cat big" } },
        ],
      },
      {
        role: "tool" as const,
        content: [
          { type: "tool-result", toolCallId: "tc_big", toolName: "bash", output: { type: "text", value: big } },
        ],
      },
      { role: "assistant" as const, content: [{ type: "text", text: "Got it" }] },
      { role: "user" as const, content: [{ type: "text", text: "Summarize" }] },
    ]
    const result = convertToKiroPayload(msgs as any, modelId, tools as any)
    const bytes = JSON.stringify(result).length
    expect(bytes).toBeLessThanOrEqual(600_000)
    expect(JSON.stringify(result)).toContain("[content compacted]")
  })
})
