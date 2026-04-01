import { test, expect } from "bun:test"
import { ContextViz } from "../../src/session/ctx-viz"

test("estimateSystemPromptTokens returns 0 for empty input", () => {
  const result = ContextViz.estimateSystemPromptTokens({
    header: "",
    provider: "",
    environment: "",
    custom: [],
  })

  expect(result.tokens).toBe(0)
  expect(result.breakdown).toHaveLength(4)
  expect(result.breakdown.every((b) => b.tokens === 0)).toBe(true)
})

test("estimateSystemPromptTokens estimates token counts for each section", () => {
  const result = ContextViz.estimateSystemPromptTokens({
    header: "You are a helpful assistant.",
    provider: "Use the best tools available.",
    environment: "Node.js environment with Bun runtime.",
    custom: ["Rule 1: Be concise", "Rule 2: Follow best practices"],
  })

  expect(result.tokens).toBeGreaterThan(0)
  expect(result.breakdown).toHaveLength(4)

  const providerHeader = result.breakdown.find((b) => b.label === "Provider Header")
  const systemPrompt = result.breakdown.find((b) => b.label === "System Prompt")
  const environment = result.breakdown.find((b) => b.label === "Environment")
  const customRules = result.breakdown.find((b) => b.label === "Custom Rules")

  expect(providerHeader).toBeDefined()
  expect(systemPrompt).toBeDefined()
  expect(environment).toBeDefined()
  expect(customRules).toBeDefined()

  expect(providerHeader!.tokens).toBeGreaterThan(0)
  expect(systemPrompt!.tokens).toBeGreaterThan(0)
  expect(environment!.tokens).toBeGreaterThan(0)
  expect(customRules!.tokens).toBeGreaterThan(0)
})

test("estimateMessagesTokens classifies user and assistant messages", () => {
  const messages = [
    { role: "user" as const, content: "Hello, can you help me?" },
    { role: "assistant" as const, content: "Of course! What do you need?" },
    { role: "user" as const, content: "I need to fix a bug." },
    { role: "assistant" as const, content: "Sure, let me look at it." },
  ]

  const result = ContextViz.estimateMessagesTokens(messages)

  expect(result.userTokens).toBeGreaterThan(0)
  expect(result.assistantTokens).toBeGreaterThan(0)
  expect(result.totalTokens).toBe(result.userTokens + result.assistantTokens)
  expect(result.messageCount).toBe(4)
})

test("estimateToolDefinitionsTokens returns 0 for no tools", () => {
  const result = ContextViz.estimateToolDefinitionsTokens([])

  expect(result.tokens).toBe(0)
  expect(result.count).toBe(0)
})

test("estimateToolDefinitionsTokens estimates based on tool schemas", () => {
  const tools = [
    {
      name: "read_file",
      description: "Read contents of a file",
      schema: '{"type": "object", "properties": {"path": {"type": "string"}}}',
    },
    {
      name: "write_file",
      description: "Write content to a file",
      schema: '{"type": "object", "properties": {"path": {"type": "string"}, "content": {"type": "string"}}}',
    },
  ]

  const result = ContextViz.estimateToolDefinitionsTokens(tools)

  expect(result.tokens).toBeGreaterThan(0)
  expect(result.count).toBe(2)
})

test("buildReport assembles full context breakdown", () => {
  const report = ContextViz.buildReport({
    systemPromptTokens: 500,
    userMessageTokens: 200,
    assistantMessageTokens: 300,
    toolDefinitionTokens: 100,
    contextLimit: 128000,
    modelID: "claude-3-5-sonnet",
  })

  expect(report.modelID).toBe("claude-3-5-sonnet")
  expect(report.contextLimit).toBe(128000)
  expect(report.totalTokens).toBe(1100)
  expect(report.usagePercent).toBeCloseTo(0.0086, 4)
  expect(report.segments).toHaveLength(4)

  const systemSegment = report.segments.find((s) => s.label === "System Prompt")
  const userSegment = report.segments.find((s) => s.label === "User Messages")
  const assistantSegment = report.segments.find((s) => s.label === "Assistant Messages")
  const toolSegment = report.segments.find((s) => s.label === "Tool Definitions")

  expect(systemSegment).toBeDefined()
  expect(userSegment).toBeDefined()
  expect(assistantSegment).toBeDefined()
  expect(toolSegment).toBeDefined()

  expect(systemSegment!.tokens).toBe(500)
  expect(userSegment!.tokens).toBe(200)
  expect(assistantSegment!.tokens).toBe(300)
  expect(toolSegment!.tokens).toBe(100)

  expect(report.generatedAt).toBeDefined()
})
