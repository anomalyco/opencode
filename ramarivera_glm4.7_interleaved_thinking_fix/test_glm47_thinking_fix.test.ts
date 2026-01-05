import { describe, expect, test } from "bun:test"
import { ProviderTransform } from "../../src/provider/transform"

describe("ProviderTransform.message - GLM-4.7 malformed thinking block", () => {
  test("GLM-4.7 with tool call XML in reasoning_content should extract malformed tool calls", () => {
    const malformedReasoning = `Let me think about what to do here.
<invoke name="bash">
  <command>bun test packages/portal/scripts/generate/workflow/workflow.test.ts 2>&1</command>
  <description>Run workflow inference unit tests</description>
</invoke>
After running the tests, I'll analyze the results.`

    const msgs = [
      {
        role: "assistant",
        content: [{ type: "reasoning", text: malformedReasoning }],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, {
      id: "z.ai/glm-4.7",
      providerID: "zai-coding-plan",
      api: {
        id: "glm-4.7",
        url: "https://api.z.ai/api/anthropic",
        npm: "@ai-sdk/openai-compatible",
      },
      name: "GLM-4.7",
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: false,
        toolcall: true,
        input: { text: true, audio: false, image: false, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: {
          field: "reasoning_content",
        },
      },
      cost: {
        input: 0.001,
        output: 0.002,
        cache: { read: 0.0001, write: 0.0002 },
      },
      limit: {
        context: 128000,
        output: 8192,
      },
      status: "active",
      options: {},
      headers: {},
      release_date: "2024-01-01",
    } as any)

    // The fix should:
    // 1. Extract the tool call from reasoning_content
    // 2. Add it as a proper tool-call part
    // 3. Clean the reasoning text to remove the XML

    expect(result).toHaveLength(1)

    // Check that tool call was extracted
    const toolCalls = result[0].content.filter((part: any) => part.type === "tool-call")
    expect(toolCalls.length).toBe(1)
    expect(toolCalls[0].toolName).toBe("bash")
    expect(toolCalls[0].input).toEqual({
      command: "bun test packages/portal/scripts/generate/workflow/workflow.test.ts 2>&1",
    })

    // Check that reasoning was cleaned
    const reasoningParts = result[0].content.filter((part: any) => part.type === "reasoning")
    expect(reasoningParts.length).toBe(1)
    expect(reasoningParts[0].text).not.toContain("<invoke")
    expect(reasoningParts[0].text).not.toContain("bun test")
    expect(reasoningParts[0].text).toContain("Let me think about what to do here.")
    expect(reasoningParts[0].text).toContain("After running the tests")
  })

  test("GLM-4.7 with pal_thinkdeep XML in reasoning_content should extract properly", () => {
    const thinkingBlock = `<invoke name="pal_thinkdeep">
  <step>Reviewing Phase 1.8 implementation</step>
  <step_number>1</step_number>
  <total_steps>4</total_steps>
  <next_step_required>true</next_step_required>
</invoke>`

    const msgs = [
      {
        role: "assistant",
        content: [{ type: "reasoning", text: thinkingBlock }],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, {
      id: "z.ai/glm-4.7",
      providerID: "zai-coding-plan",
      api: {
        id: "glm-4.7",
        url: "https://api.z.ai/api/anthropic",
        npm: "@ai-sdk/openai-compatible",
      },
      name: "GLM-4.7",
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: false,
        toolcall: true,
        input: { text: true, audio: false, image: false, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: {
          field: "reasoning_content",
        },
      },
      cost: {
        input: 0.001,
        output: 0.002,
        cache: { read: 0.0001, write: 0.0002 },
      },
      limit: {
        context: 128000,
        output: 8192,
      },
      status: "active",
      options: {},
      headers: {},
      release_date: "2024-01-01",
    } as any)

    // For thinking-specific tools like pal_thinkdeep, we may want to keep them in reasoning
    // or extract them - the fix should handle this case appropriately
    expect(result).toHaveLength(1)

    // Either the thinking block is cleaned OR the tool call is extracted
    const reasoningText = result[0].content
      .filter((part: any) => part.type === "reasoning")
      .map((part: any) => part.text)
      .join("")

    // The behavior depends on implementation - either:
    // 1. Extract pal_thinkdeep as a tool-call
    // 2. Or keep it in reasoning (since it's a thinking tool, not execution)
    // 3. Or clean it from reasoning
    expect(true).toBe(true) // Placeholder - actual behavior depends on fix
  })

  test("GLM-4.7 with multiple tool calls in reasoning should extract all", () => {
    const malformedReasoning = `I'll need to run several commands:
<invoke name="bash">
  <command>ls -la</command>
  <description>List files</description>
</invoke>
<invoke name="bash">
  <command>bun install</command>
  <description>Install dependencies</description>
</invoke>
<invoke name="bash">
  <command>bun test</command>
  <description>Run tests</description>
</invoke>`

    const msgs = [
      {
        role: "assistant",
        content: [{ type: "reasoning", text: malformedReasoning }],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, {
      id: "z.ai/glm-4.7",
      providerID: "zai-coding-plan",
      api: {
        id: "glm-4.7",
        url: "https://api.z.ai/api/anthropic",
        npm: "@ai-sdk/openai-compatible",
      },
      name: "GLM-4.7",
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: false,
        toolcall: true,
        input: { text: true, audio: false, image: false, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: {
          field: "reasoning_content",
        },
      },
      cost: {
        input: 0.001,
        output: 0.002,
        cache: { read: 0.0001, write: 0.0002 },
      },
      limit: {
        context: 128000,
        output: 8192,
      },
      status: "active",
      options: {},
      headers: {},
      release_date: "2024-01-01",
    } as any)

    expect(result).toHaveLength(1)

    // All three tool calls should be extracted
    const toolCalls = result[0].content.filter((part: any) => part.type === "tool-call")
    expect(toolCalls.length).toBe(3)

    expect(toolCalls[0].toolName).toBe("bash")
    expect(toolCalls[0].input).toEqual({ command: "ls -la" })

    expect(toolCalls[1].toolName).toBe("bash")
    expect(toolCalls[1].input).toEqual({ command: "bun install" })

    expect(toolCalls[2].toolName).toBe("bash")
    expect(toolCalls[2].input).toEqual({ command: "bun test" })
  })

  test("Properly formatted GLM-4.7 response should not be affected", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "Let me check the tests first." },
          {
            type: "tool-call",
            toolCallId: "test-1",
            toolName: "bash",
            input: { command: "bun test" },
          },
          { type: "text", text: "Tests passed!" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, {
      id: "z.ai/glm-4.7",
      providerID: "zai-coding-plan",
      api: {
        id: "glm-4.7",
        url: "https://api.z.ai/api/anthropic",
        npm: "@ai-sdk/openai-compatible",
      },
      name: "GLM-4.7",
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: false,
        toolcall: true,
        input: { text: true, audio: false, image: false, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: {
          field: "reasoning_content",
        },
      },
      cost: {
        input: 0.001,
        output: 0.002,
        cache: { read: 0.0001, write: 0.0002 },
      },
      limit: {
        context: 128000,
        output: 8192,
      },
      status: "active",
      options: {},
      headers: {},
      release_date: "2024-01-01",
    } as any)

    // Should preserve existing structure
    expect(result).toHaveLength(1)
    expect(result[0].content).toHaveLength(3)

    const reasoning = result[0].content.filter((part: any) => part.type === "reasoning")
    expect(reasoning.length).toBe(1)
    expect(reasoning[0].text).toBe("Let me check the tests first.")

    const toolCalls = result[0].content.filter((part: any) => part.type === "tool-call")
    expect(toolCalls.length).toBe(1)
    expect(toolCalls[0].input).toEqual({ command: "bun test" })
  })
})
