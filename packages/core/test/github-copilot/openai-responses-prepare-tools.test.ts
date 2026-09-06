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

const duplicateHostedToolCases = [
  { id: "openai.web_search", responseType: "web_search", args: {} },
  { id: "openai.web_search_preview", responseType: "web_search", args: {} },
  { id: "openai.file_search", responseType: "file_search", args: { vectorStoreIds: ["store_1"] } },
  { id: "openai.code_interpreter", responseType: "code_interpreter", args: {} },
  { id: "openai.image_generation", responseType: "image_generation", args: {} },
] as const

function duplicateHostedTools(testCase: (typeof duplicateHostedToolCases)[number], sameName = false) {
  return [
    { type: "provider" as const, id: testCase.id, name: `${testCase.responseType}_one`, args: testCase.args },
    {
      type: "provider" as const,
      id: testCase.id,
      name: sameName ? `${testCase.responseType}_one` : `${testCase.responseType}_two`,
      args: testCase.args,
    },
  ]
}

test.each(
  duplicateHostedToolCases.flatMap((testCase) =>
    [undefined, { type: "auto" as const }, { type: "required" as const }].flatMap((toolChoice) => {
      const tools = duplicateHostedTools(testCase)
      return [
        { testCase, tools, toolChoice, selection: toolChoice?.type ?? "default" },
        { testCase, tools: tools.toReversed(), toolChoice, selection: toolChoice?.type ?? "default" },
      ]
    }),
  ),
)(
  "rejects differently named duplicate $testCase.id responses for $selection selection",
  ({ testCase, tools, toolChoice }) => {
    expect(() => prepareResponsesTools({ tools, toolChoice, strictJsonSchema: false })).toThrow(
      `ambiguous ${testCase.responseType} response for hosted tools`,
    )
  },
)

test.each(
  duplicateHostedToolCases.flatMap((testCase) => {
    const tools = duplicateHostedTools(testCase, true)
    return [
      { testCase, tools },
      { testCase, tools: tools.toReversed() },
    ]
  }),
)("allows duplicate $testCase.id responses with the same logical name", ({ tools }) => {
  expect(
    prepareResponsesTools({ tools, toolChoice: { type: "required" }, strictJsonSchema: false }).hostedTools.map(
      (tool) => tool.name,
    ),
  ).toEqual([tools[0].name, tools[0].name])
})

test.each(
  duplicateHostedToolCases.flatMap((testCase) => {
    const tools = duplicateHostedTools(testCase)
    return [
      { testCase, tools },
      { testCase, tools: tools.toReversed() },
    ]
  }),
)("rejects a forced $testCase.id wire choice with multiple logical identities", ({ testCase, tools }) => {
  expect(() =>
    prepareResponsesTools({
      tools,
      toolChoice: { type: "tool", toolName: `${testCase.responseType}_one` },
      strictJsonSchema: false,
    }),
  ).toThrow(`ambiguous ${tools[0].id.replace("openai.", "")} tool choice for hosted tools`)
})

test.each(
  duplicateHostedToolCases.flatMap((testCase) => {
    const tools = duplicateHostedTools(testCase, true)
    return [{ tools }, { tools: tools.toReversed() }]
  }),
)("rejects a forced logical name shared by duplicate same-wire definitions", ({ tools }) => {
  expect(() =>
    prepareResponsesTools({
      tools,
      toolChoice: { type: "tool", toolName: tools[0].name },
      strictJsonSchema: false,
    }),
  ).toThrow("multiple tool definitions share this name")
})

test.each([...duplicateHostedToolCases])("skips ambiguous $id responses when tool choice is none", (testCase) => {
  expect(
    prepareResponsesTools({
      tools: duplicateHostedTools(testCase),
      toolChoice: { type: "none" },
      strictJsonSchema: false,
    }).toolChoice,
  ).toBe("none")
})

test.each([...duplicateHostedToolCases])("skips ambiguous $id responses for a uniquely forced function", (testCase) => {
  expect(
    prepareResponsesTools({
      tools: [...duplicateHostedTools(testCase), { type: "function", name: "local", inputSchema: { type: "object" } }],
      toolChoice: { type: "tool", toolName: "local" },
      strictJsonSchema: false,
    }).toolChoice,
  ).toEqual({ type: "function", name: "local" })
})

test.each([{ ambiguousWebTools: duplicateHostedTools(duplicateHostedToolCases[0]) }, { ambiguousWebTools: webTools }])(
  "validates only the selected wire choice for a forced unrelated hosted tool",
  ({ ambiguousWebTools }) => {
    const selected = duplicateHostedTools(duplicateHostedToolCases[2], true)[0]
    const result = prepareResponsesTools({
      tools: [...ambiguousWebTools, selected],
      toolChoice: { type: "tool", toolName: selected.name },
      strictJsonSchema: false,
    })

    expect(result.toolChoice).toEqual({ type: "file_search" })
    expect(result.selectedHostedTool).toMatchObject({ name: selected.name, type: "file_search" })
  },
)
