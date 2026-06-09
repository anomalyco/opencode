import { describe, it, expect } from "bun:test"
import { MessageV2 } from "@/session/message-v2"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { message as transformMessage } from "@/provider/transform"

const anthropicModel = {
  id: "anthropic/claude-test",
  providerID: "anthropic",
  api: {
    id: "claude-test",
    url: "https://api.anthropic.com",
    npm: "@ai-sdk/anthropic",
  },
  name: "Claude Test",
  capabilities: {
    temperature: true,
    reasoning: true,
    attachment: true,
    toolcall: true,
    input: { text: true, audio: false, image: true, video: false, pdf: true },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  cost: { input: 0.015, output: 0.075, cache: { read: 0.0015, write: 0.01875 } },
  limit: { context: 200000, output: 32000 },
  status: "active",
  options: {},
  headers: {},
} as any

describe("Compaction tool orphan scenario", () => {
  it("should produce tool-result for completed tools in nested compaction scenario", async () => {
    // Simulate the exact production scenario:
    // After filterCompacted reordering for the second compaction, selected.head contains:
    // [0] tail-assistant (from first compaction) with completed tool
    // [1] continue-user
    // [2...] more messages
    
    const internalMessages: SessionV1.WithParts[] = [
      // Tail-assistant with completed tool (was at filterCompacted[2], now at head[0])
      {
        info: {
          id: "msg_tail",
          role: "assistant",
          parentID: "msg_prev_user",
          sessionID: "ses_test",
          providerID: "anthropic",
          modelID: "claude-test-other",
          finish: "tool-calls",
        } as any,
        parts: [
          { type: "text", text: "Continuing the cleanup." } as any,
          { 
            type: "tool",
            tool: "edit",
            callID: "toolu_test_completed_tool",
            state: {
              status: "completed",
              input: { filePath: "/test.md", oldString: "old", newString: "new" },
              output: "Edit applied successfully",
              time: { start: 1000, end: 2000 },
            },
          } as any,
        ],
      },
      // Continue-user
      {
        info: {
          id: "msg_continue",
          role: "user",
          parentID: "msg_tail",
          sessionID: "ses_test",
        } as any,
        parts: [
          { type: "text", text: "Continue" } as any,
        ],
      },
      // Another assistant (for more context)
      {
        info: {
          id: "msg_assistant2",
          role: "assistant",
          parentID: "msg_continue",
          sessionID: "ses_test",
          providerID: "anthropic",
          modelID: "claude-test",
          finish: "stop",
        } as any,
        parts: [
          { type: "text", text: "Done with the task." } as any,
        ],
      },
    ]

    // Run toModelMessagesEffect
    const modelMessages = await MessageV2.toModelMessages(internalMessages, anthropicModel, {
      stripMedia: true,
      toolOutputMaxChars: 2000,
    })

    // Verify tool-result is produced
    const hasToolResult = modelMessages.some(
      (msg) => msg.role === "tool" && 
        Array.isArray(msg.content) && 
        msg.content.some((p: any) => p.type === "tool-result" && p.toolCallId === "toolu_test_completed_tool")
    )
    expect(hasToolResult).toBe(true)

    // Apply ProviderTransform.message (which calls ensureToolIntegrity)
    const transformed = transformMessage(modelMessages, anthropicModel, {})

    // Verify no orphaned tool-calls after transform
    const toolResultIds = new Set<string>()
    for (const msg of transformed) {
      if (msg.role === "tool" && Array.isArray(msg.content)) {
        for (const part of msg.content as any[]) {
          if (part.type === "tool-result") {
            toolResultIds.add(part.toolCallId)
          }
        }
      }
    }

    const orphanedCalls: string[] = []
    for (const msg of transformed) {
      if (msg.role === "assistant" && Array.isArray(msg.content)) {
        for (const part of msg.content as any[]) {
          if (part.type === "tool-call" && !toolResultIds.has(part.toolCallId)) {
            orphanedCalls.push(part.toolCallId)
          }
        }
      }
    }

    expect(orphanedCalls).toEqual([])
  })

  it("should flush orphans when user message follows assistant with orphan tool-call", async () => {
    const modelMessages = [
      { role: "user" as const, content: [{ type: "text" as const, text: "Start" }] },
      { 
        role: "assistant" as const, 
        content: [
          { type: "text" as const, text: "Working..." },
          { type: "tool-call" as const, toolCallId: "toolu_orphan", toolName: "edit", input: {} }
        ] 
      },
      { role: "user" as const, content: [{ type: "text" as const, text: "Summarize" }] },
    ]

    const transformed = transformMessage(modelMessages as any, anthropicModel, {})

    const toolMsg = transformed.find(
      (msg) => msg.role === "tool" && 
        Array.isArray(msg.content) && 
        msg.content.some((p: any) => p.type === "tool-result" && p.toolCallId === "toolu_orphan")
    )
    expect(toolMsg).toBeDefined()

    const syntheticResult = (toolMsg?.content as any[])?.find((p: any) => p.toolCallId === "toolu_orphan")
    expect(syntheticResult?.output?.value).toBe("[Tool result lost during session recovery]")
    expect(syntheticResult?.toolName).toBe("edit")

    const toolIndex = transformed.indexOf(toolMsg!)
    const lastUserIndex = transformed.length - 1
    expect(toolIndex).toBeLessThan(lastUserIndex)
    expect(transformed[toolIndex + 1]?.role).toBe("user")
  })

  it("should handle different model scenario (differentModel flag)", async () => {
    const internalMessages: SessionV1.WithParts[] = [
      {
        info: {
          id: "msg_tail",
          role: "assistant",
          parentID: "msg_prev_user",
          sessionID: "ses_test",
          providerID: "anthropic",
          modelID: "claude-test-other",
          finish: "tool-calls",
        } as any,
        parts: [
          { type: "text", text: "Cleanup." } as any,
          { 
            type: "tool",
            tool: "edit",
            callID: "toolu_different_model",
            state: {
              status: "completed",
              input: { filePath: "/test.md" },
              output: "Done",
              time: { start: 1000, end: 2000 },
            },
          } as any,
        ],
      },
      {
        info: {
          id: "msg_user",
          role: "user",
          parentID: "msg_tail",
          sessionID: "ses_test",
        } as any,
        parts: [
          { type: "text", text: "Continue" } as any,
        ],
      },
    ]

    const modelMessages = await MessageV2.toModelMessages(internalMessages, anthropicModel, {})

    const hasToolResult = modelMessages.some(
      (msg) => msg.role === "tool" && 
        Array.isArray(msg.content) && 
        msg.content.some((p: any) => p.type === "tool-result" && p.toolCallId === "toolu_different_model")
    )
    expect(hasToolResult).toBe(true)
  })

  it("should NOT inject synthetic tool-result when last message is assistant with in-progress tool-call", () => {
    const modelMessages = [
      { role: "user" as const, content: [{ type: "text" as const, text: "Start" }] },
      { 
        role: "assistant" as const, 
        content: [
          { type: "text" as const, text: "Working..." },
          { type: "tool-call" as const, toolCallId: "toolu_in_progress", toolName: "bash", input: {} }
        ] 
      },
    ]

    const transformed = transformMessage(modelMessages as any, anthropicModel, {})

    const hasSyntheticTool = transformed.some(
      (msg) => msg.role === "tool" && 
        Array.isArray(msg.content) && 
        msg.content.some((p: any) => p.toolCallId === "toolu_in_progress")
    )
    expect(hasSyntheticTool).toBe(false)

    expect(transformed[transformed.length - 1]?.role).toBe("assistant")
  })

  it("should augment existing tool message when orphan precedes it", () => {
    const modelMessages = [
      { role: "user" as const, content: [{ type: "text" as const, text: "Start" }] },
      { 
        role: "assistant" as const, 
        content: [
          { type: "tool-call" as const, toolCallId: "toolu_orphan", toolName: "read", input: {} },
          { type: "tool-call" as const, toolCallId: "toolu_resolved", toolName: "write", input: {} }
        ] 
      },
      { 
        role: "tool" as const, 
        content: [
          { type: "tool-result" as const, toolCallId: "toolu_resolved", toolName: "write", output: { type: "text", value: "ok" } }
        ] 
      },
      { role: "user" as const, content: [{ type: "text" as const, text: "Continue" }] },
    ]

    const transformed = transformMessage(modelMessages as any, anthropicModel, {})

    const toolMsgs = transformed.filter((msg) => msg.role === "tool")
    expect(toolMsgs.length).toBe(1)

    const toolContent = toolMsgs[0]?.content as any[]
    expect(toolContent.length).toBe(2)

    const orphanResult = toolContent.find((p: any) => p.toolCallId === "toolu_orphan")
    expect(orphanResult).toBeDefined()
    expect(orphanResult?.output?.value).toBe("[Tool result lost during session recovery]")

    const resolvedResult = toolContent.find((p: any) => p.toolCallId === "toolu_resolved")
    expect(resolvedResult).toBeDefined()
  })

  it("should flush orphan when adjacent assistant follows assistant with orphan tool-call", () => {
    const modelMessages = [
      { role: "user" as const, content: [{ type: "text" as const, text: "Start" }] },
      { 
        role: "assistant" as const, 
        content: [
          { type: "text" as const, text: "Let me check..." },
          { type: "tool-call" as const, toolCallId: "toolu_orphan", toolName: "read", input: {} }
        ] 
      },
      { 
        role: "assistant" as const, 
        content: [{ type: "text" as const, text: "Here is the result." }]
      },
    ]

    const transformed = transformMessage(modelMessages as any, anthropicModel, {})

    const toolMsg = transformed.find(
      (msg) => msg.role === "tool" && 
        Array.isArray(msg.content) && 
        msg.content.some((p: any) => p.toolCallId === "toolu_orphan")
    )
    expect(toolMsg).toBeDefined()

    const syntheticResult = (toolMsg?.content as any[])?.find((p: any) => p.toolCallId === "toolu_orphan")
    expect(syntheticResult?.output?.value).toBe("[Tool result lost during session recovery]")

    const toolIndex = transformed.findIndex((msg) => msg === toolMsg)
    const secondAssistantIndex = transformed.findIndex(
      (msg, i) => i > 0 && msg.role === "assistant" && 
        Array.isArray(msg.content) && 
        msg.content.some((p: any) => p.text === "Here is the result.")
    )
    expect(toolIndex).toBeLessThan(secondAssistantIndex)
  })
})
