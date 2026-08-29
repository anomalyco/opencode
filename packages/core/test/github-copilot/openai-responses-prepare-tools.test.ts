import { expect, test } from "bun:test"
import type {
  LanguageModelV3CallOptions,
  LanguageModelV3FunctionTool,
  LanguageModelV3ProviderTool,
} from "@ai-sdk/provider"
import { prepareResponsesTools } from "@opencode-ai/core/github-copilot/responses/openai-responses-prepare-tools"

function prepare(strict: boolean | undefined, strictJsonSchema: boolean) {
  const tool: LanguageModelV3FunctionTool = {
    type: "function",
    name: "lookup",
    inputSchema: { type: "object", properties: {} },
    strict,
  }
  return prepareResponsesTools({ tools: [tool], strictJsonSchema }).tools?.[0]
}

test("function tools prefer explicit strictness over the global fallback", () => {
  expect(prepare(true, false)).toMatchObject({ type: "function", strict: true })
  expect(prepare(false, true)).toMatchObject({ type: "function", strict: false })
  expect(prepare(undefined, true)).toMatchObject({ type: "function", strict: true })
  expect(prepare(undefined, false)).toMatchObject({ type: "function", strict: false })
})

const webTools: LanguageModelV3ProviderTool[] = [
  { type: "provider", id: "openai.web_search", name: "current_web", args: {} },
  { type: "provider", id: "openai.web_search_preview", name: "preview_web", args: {} },
]

test.each([
  { order: webTools, toolChoice: undefined },
  { order: webTools.toReversed(), toolChoice: undefined },
  { order: webTools, toolChoice: { type: "auto" as const } },
  { order: webTools.toReversed(), toolChoice: { type: "auto" as const } },
  { order: webTools, toolChoice: { type: "required" as const } },
  { order: webTools.toReversed(), toolChoice: { type: "required" as const } },
])("rejects differently named web variants before automatic or required selection", ({ order, toolChoice }) => {
  expect(() => prepareResponsesTools({ tools: order, toolChoice, strictJsonSchema: false })).toThrow(
    "ambiguous web_search response for hosted tools",
  )
})

test.each([
  { order: webTools, name: "current_web", wireType: "web_search" },
  { order: webTools.toReversed(), name: "current_web", wireType: "web_search" },
  { order: webTools, name: "preview_web", wireType: "web_search_preview" },
  { order: webTools.toReversed(), name: "preview_web", wireType: "web_search_preview" },
])("uses the uniquely forced web variant independent of declaration order", ({ order, name, wireType }) => {
  const result = prepareResponsesTools({
    tools: order,
    toolChoice: { type: "tool", toolName: name },
    strictJsonSchema: false,
  })

  expect(result.toolChoice).toEqual({ type: wireType })
  expect(result.selectedHostedTool).toMatchObject({ name, type: wireType, responseType: "web_search" })
})

test.each([{ order: webTools }, { order: webTools.toReversed() }])(
  "allows indistinguishable web variants when they share one logical name",
  ({ order }) => {
    const tools = order.map((tool) => ({ ...tool, name: "web" }))
    const result = prepareResponsesTools({ tools, toolChoice: { type: "required" }, strictJsonSchema: false })

    expect(result.hostedTools.map((tool) => tool.name)).toEqual(["web", "web"])
  },
)

const duplicateToolCases = [
  [
    { type: "function", name: "lookup", inputSchema: { type: "object" } },
    { type: "provider", id: "openai.web_search", name: "lookup", args: {} },
  ],
  [
    { type: "provider", id: "other.unsupported", name: "lookup", args: {} },
    { type: "provider", id: "openai.web_search", name: "lookup", args: {} },
  ],
  [
    { type: "provider", id: "openai.web_search", name: "lookup", args: {} },
    { type: "provider", id: "openai.web_search_preview", name: "lookup", args: {} },
  ],
] satisfies Array<NonNullable<LanguageModelV3CallOptions["tools"]>>

test.each(duplicateToolCases.flatMap((tools) => [{ tools }, { tools: tools.toReversed() }]))(
  "rejects duplicate forced definitions independent of type and order",
  ({ tools }) => {
    expect(() =>
      prepareResponsesTools({
        tools,
        toolChoice: { type: "tool", toolName: "lookup" },
        strictJsonSchema: false,
      }),
    ).toThrow("multiple tool definitions share this name")
  },
)
