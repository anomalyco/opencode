import { OpenAICompatibleChatLanguageModel } from "@/provider/sdk/copilot/chat/openai-compatible-chat-language-model"
import { describe, test, expect, mock } from "bun:test"
import type { LanguageModelV2Prompt } from "@ai-sdk/provider"

async function convertReadableStreamToArray<T>(stream: ReadableStream<T>): Promise<T[]> {
  const reader = stream.getReader()
  const result: T[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    result.push(value)
  }
  return result
}

const TEST_PROMPT: LanguageModelV2Prompt = [{ role: "user", content: [{ type: "text", text: "Hello" }] }]

// Fixtures from copilot_test.exs
const FIXTURES = {
  basicText: [
    `data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1677652288,"model":"gemini-2.0-flash-001","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"},"finish_reason":null}]}`,
    `data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1677652288,"model":"gemini-2.0-flash-001","choices":[{"index":0,"delta":{"content":" world"},"finish_reason":null}]}`,
    `data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1677652288,"model":"gemini-2.0-flash-001","choices":[{"index":0,"delta":{"content":"!"},"finish_reason":"stop"}]}`,
    `data: [DONE]`,
  ],

  reasoningWithToolCalls: [
    `data: {"choices":[{"index":0,"delta":{"content":null,"role":"assistant","reasoning_text":"**Understanding Dayzee's Purpose**\\n\\nI'm starting to get a better handle on \`dayzee\`.\\n\\n"}}],"created":1764940861,"id":"OdwyabKMI9yel7oPlbzgwQM","usage":{"completion_tokens":0,"prompt_tokens":0,"prompt_tokens_details":{"cached_tokens":0},"total_tokens":0,"reasoning_tokens":0},"model":"gemini-3-pro-preview"}`,
    `data: {"choices":[{"index":0,"delta":{"content":null,"role":"assistant","reasoning_text":"**Assessing Dayzee's Functionality**\\n\\nI've reviewed the files.\\n\\n"}}],"created":1764940862,"id":"OdwyabKMI9yel7oPlbzgwQM","usage":{"completion_tokens":0,"prompt_tokens":0,"prompt_tokens_details":{"cached_tokens":0},"total_tokens":0,"reasoning_tokens":0},"model":"gemini-3-pro-preview"}`,
    `data: {"choices":[{"index":0,"delta":{"content":null,"role":"assistant","tool_calls":[{"function":{"arguments":"{\\"filePath\\":\\"/README.md\\"}","name":"read_file"},"id":"call_abc123","index":0,"type":"function"}],"reasoning_opaque":"4CUQ6696CwSXOdQ5rtvDimqA91tBzfmga4ieRbmZ5P67T2NLW3"}}],"created":1764940862,"id":"OdwyabKMI9yel7oPlbzgwQM","usage":{"completion_tokens":0,"prompt_tokens":0,"prompt_tokens_details":{"cached_tokens":0},"total_tokens":0,"reasoning_tokens":0},"model":"gemini-3-pro-preview"}`,
    `data: {"choices":[{"finish_reason":"tool_calls","index":0,"delta":{"content":null,"role":"assistant","tool_calls":[{"function":{"arguments":"{\\"filePath\\":\\"/mix.exs\\"}","name":"read_file"},"id":"call_def456","index":1,"type":"function"}]}}],"created":1764940862,"id":"OdwyabKMI9yel7oPlbzgwQM","usage":{"completion_tokens":53,"prompt_tokens":19581,"prompt_tokens_details":{"cached_tokens":17068},"total_tokens":19768,"reasoning_tokens":134},"model":"gemini-3-pro-preview"}`,
    `data: [DONE]`,
  ],

  reasoningWithOpaqueAtEnd: [
    `data: {"choices":[{"index":0,"delta":{"content":null,"role":"assistant","reasoning_text":"**Analyzing the Inquiry's Nature**\\n\\nI'm currently parsing the user's question.\\n\\n"}}],"created":1765201729,"id":"Ptc2afqsCIHqlOoP653UiAI","usage":{"completion_tokens":0,"prompt_tokens":0,"prompt_tokens_details":{"cached_tokens":0},"total_tokens":0,"reasoning_tokens":0},"model":"gemini-3-pro-preview"}`,
    `data: {"choices":[{"index":0,"delta":{"content":null,"role":"assistant","reasoning_text":"**Reconciling User's Input**\\n\\nI'm grappling with the context.\\n\\n"}}],"created":1765201730,"id":"Ptc2afqsCIHqlOoP653UiAI","usage":{"completion_tokens":0,"prompt_tokens":0,"prompt_tokens_details":{"cached_tokens":0},"total_tokens":0,"reasoning_tokens":0},"model":"gemini-3-pro-preview"}`,
    `data: {"choices":[{"index":0,"delta":{"content":"I am Tidewave, a highly skilled AI coding agent.\\n\\n","role":"assistant"}}],"created":1765201730,"id":"Ptc2afqsCIHqlOoP653UiAI","usage":{"completion_tokens":0,"prompt_tokens":0,"prompt_tokens_details":{"cached_tokens":0},"total_tokens":0,"reasoning_tokens":0},"model":"gemini-3-pro-preview"}`,
    `data: {"choices":[{"finish_reason":"stop","index":0,"delta":{"content":"How can I help you?","role":"assistant","reasoning_opaque":"/PMlTqxqSJZnUBDHgnnJKLVI4eZQ"}}],"created":1765201730,"id":"Ptc2afqsCIHqlOoP653UiAI","usage":{"completion_tokens":59,"prompt_tokens":5778,"prompt_tokens_details":{"cached_tokens":0},"total_tokens":5932,"reasoning_tokens":95},"model":"gemini-3-pro-preview"}`,
    `data: [DONE]`,
  ],

  // Case where reasoning_opaque and content come in the SAME chunk
  reasoningWithOpaqueAndContentSameChunk: [
    `data: {"choices":[{"index":0,"delta":{"content":null,"role":"assistant","reasoning_text":"**Understanding the Query's Nature**\\n\\nI'm currently grappling with the user's philosophical query.\\n\\n"}}],"created":1766062103,"id":"FPhDacixL9zrlOoPqLSuyQ4","usage":{"completion_tokens":0,"prompt_tokens":0,"prompt_tokens_details":{"cached_tokens":0},"total_tokens":0,"reasoning_tokens":0},"model":"gemini-2.5-pro"}`,
    `data: {"choices":[{"index":0,"delta":{"content":null,"role":"assistant","reasoning_text":"**Framing the Response's Core**\\n\\nNow, I'm structuring my response.\\n\\n"}}],"created":1766062103,"id":"FPhDacixL9zrlOoPqLSuyQ4","usage":{"completion_tokens":0,"prompt_tokens":0,"prompt_tokens_details":{"cached_tokens":0},"total_tokens":0,"reasoning_tokens":0},"model":"gemini-2.5-pro"}`,
    `data: {"choices":[{"index":0,"delta":{"content":"Of course. I'm thinking right now.","role":"assistant","reasoning_opaque":"ExXaGwW7jBo39OXRe9EPoFGN1rOtLJBx"}}],"created":1766062103,"id":"FPhDacixL9zrlOoPqLSuyQ4","usage":{"completion_tokens":0,"prompt_tokens":0,"prompt_tokens_details":{"cached_tokens":0},"total_tokens":0,"reasoning_tokens":0},"model":"gemini-2.5-pro"}`,
    `data: {"choices":[{"finish_reason":"stop","index":0,"delta":{"content":" What's on your mind?","role":"assistant"}}],"created":1766062103,"id":"FPhDacixL9zrlOoPqLSuyQ4","usage":{"completion_tokens":78,"prompt_tokens":3767,"prompt_tokens_details":{"cached_tokens":0},"total_tokens":3915,"reasoning_tokens":70},"model":"gemini-2.5-pro"}`,
    `data: [DONE]`,
  ],

  // Case where reasoning_opaque and content come in same chunk, followed by tool calls
  reasoningWithOpaqueContentAndToolCalls: [
    `data: {"choices":[{"index":0,"delta":{"content":null,"role":"assistant","reasoning_text":"**Analyzing the Structure**\\n\\nI'm currently trying to get a handle on the project's layout. My initial focus is on the file structure itself, specifically the directory organization. I'm hoping this will illuminate how different components interact. I'll need to identify the key modules and their dependencies.\\n\\n\\n"}}],"created":1766066995,"id":"MQtEafqbFYTZsbwPwuCVoAg","usage":{"completion_tokens":0,"prompt_tokens":0,"prompt_tokens_details":{"cached_tokens":0},"total_tokens":0,"reasoning_tokens":0},"model":"gemini-2.5-pro"}`,
    `data: {"choices":[{"index":0,"delta":{"content":"Okay, I need to check out the project's file structure.","role":"assistant","reasoning_opaque":"WHOd3dYFnxEBOsKUXjbX6c2rJa0fS214FHbsj+A3Q+i63SFo7H/92RsownAzyo0h2qEy3cOcrvAatsMx51eCKiMSqt4dYWZhd5YVSgF0CehkpDbWBP/SoRqLU1dhCmUJV/6b5uYFBOzKLBGNadyhI7T1gWFlXntwc6SNjH6DujnFPeVr+L8DdOoUJGJrw2aOfm9NtkXA6wZh9t7dt+831yIIImjD9MHczuXoXj8K7tyLpIJ9KlVXMhnO4IKSYNdKRtoHlGTmudAp5MgH/vLWb6oSsL+ZJl/OdF3WBOeanGhYNoByCRDSvR7anAR/9m5zf9yUax+u/nFg+gzmhFacnzZGtSmcvJ4/4HWKNtUkRASTKeN94DXB8j1ptB/i6ldaMAz2ZyU+sbjPWI8aI4fKJ2MuO01u3uE87xVwpWiM+0rahIzJsllI5edwOaOFtF4tnlCTQafbxHwCZR62uON2E+IjGzW80MzyfYrbLBJKS5zTeHCgPYQSNaKzPfpzkQvdwo3JUnJYcEHgGeKzkq5sbvS5qitCYI7Xue0V98S6/KnUSPnDQBjNnas2i6BqJV2vuCEU/Y3ucrlKVbuRIFCZXCyLzrsGeRLRKlrf5S/HDAQ04IOPQVQhBPvhX0nDjhZB"}}],"created":1766066995,"id":"MQtEafqbFYTZsbwPwuCVoAg","usage":{"completion_tokens":0,"prompt_tokens":0,"prompt_tokens_details":{"cached_tokens":0},"total_tokens":0,"reasoning_tokens":0},"model":"gemini-2.5-pro"}`,
    `data: {"choices":[{"finish_reason":"tool_calls","index":0,"delta":{"content":null,"role":"assistant","tool_calls":[{"function":{"arguments":"{}","name":"list_project_files"},"id":"call_MHxqRDd5WVo3NU8wUXRaMmc0MFE","index":0,"type":"function"}]}}],"created":1766066995,"id":"MQtEafqbFYTZsbwPwuCVoAg","usage":{"completion_tokens":19,"prompt_tokens":3767,"prompt_tokens_details":{"cached_tokens":0},"total_tokens":3797,"reasoning_tokens":11},"model":"gemini-2.5-pro"}`,
    `data: [DONE]`,
  ],

  // Case where reasoning goes directly to tool_calls with NO content
  // reasoning_opaque and tool_calls come in the same chunk
  reasoningDirectlyToToolCalls: [
    `data: {"choices":[{"index":0,"delta":{"content":null,"role":"assistant","reasoning_text":"**Executing and Analyzing HTML**\\n\\nI've successfully captured the HTML snapshot using the \`browser_eval\` tool, giving me a solid understanding of the page structure. Now, I'm shifting focus to Elixir code execution with \`project_eval\` to assess my ability to work within the project's environment.\\n\\n\\n"}}],"created":1766068643,"id":"oBFEaafzD9DVlOoPkY3l4Qs","usage":{"completion_tokens":0,"prompt_tokens":0,"prompt_tokens_details":{"cached_tokens":0},"total_tokens":0,"reasoning_tokens":0},"model":"gemini-3-pro-preview"}`,
    `data: {"choices":[{"index":0,"delta":{"content":null,"role":"assistant","reasoning_text":"**Testing Project Contexts**\\n\\nI've got the HTML body snapshot from \`browser_eval\`, which is a helpful reference. Next, I'm testing my ability to run Elixir code in the project with \`project_eval\`. I'm starting with a simple sum: \`1 + 1\`. This will confirm I'm set up to interact with the project's codebase.\\n\\n\\n"}}],"created":1766068644,"id":"oBFEaafzD9DVlOoPkY3l4Qs","usage":{"completion_tokens":0,"prompt_tokens":0,"prompt_tokens_details":{"cached_tokens":0},"total_tokens":0,"reasoning_tokens":0},"model":"gemini-3-pro-preview"}`,
    `data: {"choices":[{"finish_reason":"tool_calls","index":0,"delta":{"content":null,"role":"assistant","tool_calls":[{"function":{"arguments":"{\\"code\\":\\"1 + 1\\"}","name":"project_eval"},"id":"call_MHw3RDhmT1J5Z3B6WlhpVjlveTc","index":0,"type":"function"}],"reasoning_opaque":"ytGNWFf2doK38peANDvm7whkLPKrd+Fv6/k34zEPBF6Qwitj4bTZT0FBXleydLb6"}}],"created":1766068644,"id":"oBFEaafzD9DVlOoPkY3l4Qs","usage":{"completion_tokens":12,"prompt_tokens":8677,"prompt_tokens_details":{"cached_tokens":3692},"total_tokens":8768,"reasoning_tokens":79},"model":"gemini-3-pro-preview"}`,
    `data: [DONE]`,
  ],
}

function createMockFetch(chunks: string[]) {
  return mock(async () => {
    const body = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(new TextEncoder().encode(chunk + "\n\n"))
        }
        controller.close()
      },
    })

    return new Response(body, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    })
  })
}

function createModel(fetchFn: ReturnType<typeof mock>) {
  return new OpenAICompatibleChatLanguageModel("test-model", {
    provider: "copilot.chat",
    url: () => "https://api.test.com/chat/completions",
    headers: () => ({ Authorization: "Bearer test-token" }),
    fetch: fetchFn as any,
  })
}

describe("doStream", () => {
  test("should stream text deltas", async () => {
    const mockFetch = createMockFetch(FIXTURES.basicText)
    const model = createModel(mockFetch)

    const { stream } = await model.doStream({
      prompt: TEST_PROMPT,
      includeRawChunks: false,
    })

    const parts = await convertReadableStreamToArray(stream)

    // Filter to just the key events
    const textParts = parts.filter(
      (p) => p.type === "text-start" || p.type === "text-delta" || p.type === "text-end" || p.type === "finish",
    )

    expect(textParts).toMatchObject([
      { type: "text-start", id: "txt-0" },
      { type: "text-delta", id: "txt-0", delta: "Hello" },
      { type: "text-delta", id: "txt-0", delta: " world" },
      { type: "text-delta", id: "txt-0", delta: "!" },
      { type: "text-end", id: "txt-0" },
      { type: "finish", finishReason: "stop" },
    ])
  })

  test("should stream reasoning with tool calls and capture reasoning_opaque", async () => {
    const mockFetch = createMockFetch(FIXTURES.reasoningWithToolCalls)
    const model = createModel(mockFetch)

    const { stream } = await model.doStream({
      prompt: TEST_PROMPT,
      includeRawChunks: false,
    })

    const parts = await convertReadableStreamToArray(stream)

    // Check reasoning parts
    const reasoningParts = parts.filter(
      (p) => p.type === "reasoning-start" || p.type === "reasoning-delta" || p.type === "reasoning-end",
    )

    expect(reasoningParts[0]).toEqual({
      type: "reasoning-start",
      id: "reasoning-0",
    })

    expect(reasoningParts[1]).toMatchObject({
      type: "reasoning-delta",
      id: "reasoning-0",
    })
    expect((reasoningParts[1] as { delta: string }).delta).toContain("**Understanding Dayzee's Purpose**")

    expect(reasoningParts[2]).toMatchObject({
      type: "reasoning-delta",
      id: "reasoning-0",
    })
    expect((reasoningParts[2] as { delta: string }).delta).toContain("**Assessing Dayzee's Functionality**")

    // reasoning_opaque should be in reasoning-end providerMetadata
    const reasoningEnd = reasoningParts.find((p) => p.type === "reasoning-end")
    expect(reasoningEnd).toMatchObject({
      type: "reasoning-end",
      id: "reasoning-0",
      providerMetadata: {
        copilot: {
          reasoningOpaque: "4CUQ6696CwSXOdQ5rtvDimqA91tBzfmga4ieRbmZ5P67T2NLW3",
        },
      },
    })

    // Check tool calls
    const toolParts = parts.filter(
      (p) => p.type === "tool-input-start" || p.type === "tool-call" || p.type === "tool-input-end",
    )

    expect(toolParts).toContainEqual({
      type: "tool-input-start",
      id: "call_abc123",
      toolName: "read_file",
    })

    expect(toolParts).toContainEqual(
      expect.objectContaining({
        type: "tool-call",
        toolCallId: "call_abc123",
        toolName: "read_file",
      }),
    )

    expect(toolParts).toContainEqual({
      type: "tool-input-start",
      id: "call_def456",
      toolName: "read_file",
    })

    // Check finish
    const finish = parts.find((p) => p.type === "finish")
    expect(finish).toMatchObject({
      type: "finish",
      finishReason: "tool-calls",
      usage: {
        inputTokens: 19581,
        outputTokens: 53,
      },
    })
  })

  test("should handle reasoning_opaque that comes at end with text in between", async () => {
    const mockFetch = createMockFetch(FIXTURES.reasoningWithOpaqueAtEnd)
    const model = createModel(mockFetch)

    const { stream } = await model.doStream({
      prompt: TEST_PROMPT,
      includeRawChunks: false,
    })

    const parts = await convertReadableStreamToArray(stream)

    // Check that reasoning comes first
    const reasoningStart = parts.findIndex((p) => p.type === "reasoning-start")
    const textStart = parts.findIndex((p) => p.type === "text-start")
    expect(reasoningStart).toBeLessThan(textStart)

    // Check reasoning deltas
    const reasoningDeltas = parts.filter((p) => p.type === "reasoning-delta")
    expect(reasoningDeltas).toHaveLength(2)
    expect((reasoningDeltas[0] as { delta: string }).delta).toContain("**Analyzing the Inquiry's Nature**")
    expect((reasoningDeltas[1] as { delta: string }).delta).toContain("**Reconciling User's Input**")

    // Check text deltas
    const textDeltas = parts.filter((p) => p.type === "text-delta")
    expect(textDeltas).toHaveLength(2)
    expect((textDeltas[0] as { delta: string }).delta).toContain("I am Tidewave")
    expect((textDeltas[1] as { delta: string }).delta).toContain("How can I help you?")

    // reasoning-end should be emitted before text-start
    const reasoningEndIndex = parts.findIndex((p) => p.type === "reasoning-end")
    const textStartIndex = parts.findIndex((p) => p.type === "text-start")
    expect(reasoningEndIndex).toBeGreaterThan(-1)
    expect(reasoningEndIndex).toBeLessThan(textStartIndex)

    // In this fixture, reasoning_opaque comes AFTER content has started (in chunk 4)
    // So it arrives too late to be attached to reasoning-end. But it should still
    // be captured and included in the finish event's providerMetadata.
    const reasoningEnd = parts.find((p) => p.type === "reasoning-end")
    expect(reasoningEnd).toMatchObject({
      type: "reasoning-end",
      id: "reasoning-0",
    })

    // reasoning_opaque should be in the finish event's providerMetadata
    const finish = parts.find((p) => p.type === "finish")
    expect(finish).toMatchObject({
      type: "finish",
      finishReason: "stop",
      usage: {
        inputTokens: 5778,
        outputTokens: 59,
      },
      providerMetadata: {
        copilot: {
          reasoningOpaque: "/PMlTqxqSJZnUBDHgnnJKLVI4eZQ",
        },
      },
    })
  })

  test("should handle reasoning_opaque and content in the same chunk", async () => {
    const mockFetch = createMockFetch(FIXTURES.reasoningWithOpaqueAndContentSameChunk)
    const model = createModel(mockFetch)

    const { stream } = await model.doStream({
      prompt: TEST_PROMPT,
      includeRawChunks: false,
    })

    const parts = await convertReadableStreamToArray(stream)

    // The critical test: reasoning-end should come BEFORE text-start
    const reasoningEndIndex = parts.findIndex((p) => p.type === "reasoning-end")
    const textStartIndex = parts.findIndex((p) => p.type === "text-start")
    expect(reasoningEndIndex).toBeGreaterThan(-1)
    expect(textStartIndex).toBeGreaterThan(-1)
    expect(reasoningEndIndex).toBeLessThan(textStartIndex)

    // Check reasoning deltas
    const reasoningDeltas = parts.filter((p) => p.type === "reasoning-delta")
    expect(reasoningDeltas).toHaveLength(2)
    expect((reasoningDeltas[0] as { delta: string }).delta).toContain("**Understanding the Query's Nature**")
    expect((reasoningDeltas[1] as { delta: string }).delta).toContain("**Framing the Response's Core**")

    // reasoning_opaque should be in reasoning-end even though it came with content
    const reasoningEnd = parts.find((p) => p.type === "reasoning-end")
    expect(reasoningEnd).toMatchObject({
      type: "reasoning-end",
      id: "reasoning-0",
      providerMetadata: {
        copilot: {
          reasoningOpaque: "ExXaGwW7jBo39OXRe9EPoFGN1rOtLJBx",
        },
      },
    })

    // Check text deltas
    const textDeltas = parts.filter((p) => p.type === "text-delta")
    expect(textDeltas).toHaveLength(2)
    expect((textDeltas[0] as { delta: string }).delta).toContain("Of course. I'm thinking right now.")
    expect((textDeltas[1] as { delta: string }).delta).toContain("What's on your mind?")

    // Check finish
    const finish = parts.find((p) => p.type === "finish")
    expect(finish).toMatchObject({
      type: "finish",
      finishReason: "stop",
    })
  })

  test("should handle reasoning_opaque and content followed by tool calls", async () => {
    const mockFetch = createMockFetch(FIXTURES.reasoningWithOpaqueContentAndToolCalls)
    const model = createModel(mockFetch)

    const { stream } = await model.doStream({
      prompt: TEST_PROMPT,
      includeRawChunks: false,
    })

    const parts = await convertReadableStreamToArray(stream)

    // Check that reasoning comes first, then text, then tool calls
    const reasoningEndIndex = parts.findIndex((p) => p.type === "reasoning-end")
    const textStartIndex = parts.findIndex((p) => p.type === "text-start")
    const toolStartIndex = parts.findIndex((p) => p.type === "tool-input-start")

    expect(reasoningEndIndex).toBeGreaterThan(-1)
    expect(textStartIndex).toBeGreaterThan(-1)
    expect(toolStartIndex).toBeGreaterThan(-1)
    expect(reasoningEndIndex).toBeLessThan(textStartIndex)
    expect(textStartIndex).toBeLessThan(toolStartIndex)

    // Check reasoning content
    const reasoningDeltas = parts.filter((p) => p.type === "reasoning-delta")
    expect(reasoningDeltas).toHaveLength(1)
    expect((reasoningDeltas[0] as { delta: string }).delta).toContain("**Analyzing the Structure**")

    // reasoning_opaque should be in reasoning-end (comes with content in same chunk)
    const reasoningEnd = parts.find((p) => p.type === "reasoning-end")
    expect(reasoningEnd).toMatchObject({
      type: "reasoning-end",
      id: "reasoning-0",
      providerMetadata: {
        copilot: {
          reasoningOpaque: expect.stringContaining("WHOd3dYFnxEBOsKUXjbX6c2rJa0fS214"),
        },
      },
    })

    // Check text content
    const textDeltas = parts.filter((p) => p.type === "text-delta")
    expect(textDeltas).toHaveLength(1)
    expect((textDeltas[0] as { delta: string }).delta).toContain(
      "Okay, I need to check out the project's file structure.",
    )

    // Check tool call
    const toolParts = parts.filter(
      (p) => p.type === "tool-input-start" || p.type === "tool-call" || p.type === "tool-input-end",
    )

    expect(toolParts).toContainEqual({
      type: "tool-input-start",
      id: "call_MHxqRDd5WVo3NU8wUXRaMmc0MFE",
      toolName: "list_project_files",
    })

    expect(toolParts).toContainEqual(
      expect.objectContaining({
        type: "tool-call",
        toolCallId: "call_MHxqRDd5WVo3NU8wUXRaMmc0MFE",
        toolName: "list_project_files",
      }),
    )

    // Check finish
    const finish = parts.find((p) => p.type === "finish")
    expect(finish).toMatchObject({
      type: "finish",
      finishReason: "tool-calls",
      usage: {
        inputTokens: 3767,
        outputTokens: 19,
      },
    })
  })

  test("should emit reasoning-end before tool-input-start when reasoning goes directly to tool calls", async () => {
    const mockFetch = createMockFetch(FIXTURES.reasoningDirectlyToToolCalls)
    const model = createModel(mockFetch)

    const { stream } = await model.doStream({
      prompt: TEST_PROMPT,
      includeRawChunks: false,
    })

    const parts = await convertReadableStreamToArray(stream)

    // Critical check: reasoning-end MUST come before tool-input-start
    const reasoningEndIndex = parts.findIndex((p) => p.type === "reasoning-end")
    const toolStartIndex = parts.findIndex((p) => p.type === "tool-input-start")

    expect(reasoningEndIndex).toBeGreaterThan(-1)
    expect(toolStartIndex).toBeGreaterThan(-1)
    expect(reasoningEndIndex).toBeLessThan(toolStartIndex)

    // Check reasoning parts
    const reasoningDeltas = parts.filter((p) => p.type === "reasoning-delta")
    expect(reasoningDeltas).toHaveLength(2)
    expect((reasoningDeltas[0] as { delta: string }).delta).toContain("**Executing and Analyzing HTML**")
    expect((reasoningDeltas[1] as { delta: string }).delta).toContain("**Testing Project Contexts**")

    // reasoning_opaque should be in reasoning-end providerMetadata
    const reasoningEnd = parts.find((p) => p.type === "reasoning-end")
    expect(reasoningEnd).toMatchObject({
      type: "reasoning-end",
      id: "reasoning-0",
      providerMetadata: {
        copilot: {
          reasoningOpaque: "ytGNWFf2doK38peANDvm7whkLPKrd+Fv6/k34zEPBF6Qwitj4bTZT0FBXleydLb6",
        },
      },
    })

    // No text parts should exist
    const textParts = parts.filter((p) => p.type === "text-start" || p.type === "text-delta" || p.type === "text-end")
    expect(textParts).toHaveLength(0)

    // Check tool call
    const toolCall = parts.find((p) => p.type === "tool-call")
    expect(toolCall).toMatchObject({
      type: "tool-call",
      toolCallId: "call_MHw3RDhmT1J5Z3B6WlhpVjlveTc",
      toolName: "project_eval",
    })

    // Check finish
    const finish = parts.find((p) => p.type === "finish")
    expect(finish).toMatchObject({
      type: "finish",
      finishReason: "tool-calls",
    })
  })

  test("should include response metadata from first chunk", async () => {
    const mockFetch = createMockFetch(FIXTURES.basicText)
    const model = createModel(mockFetch)

    const { stream } = await model.doStream({
      prompt: TEST_PROMPT,
      includeRawChunks: false,
    })

    const parts = await convertReadableStreamToArray(stream)

    const metadata = parts.find((p) => p.type === "response-metadata")
    expect(metadata).toMatchObject({
      type: "response-metadata",
      id: "chatcmpl-123",
      modelId: "gemini-2.0-flash-001",
    })
  })

  test("should emit stream-start with warnings", async () => {
    const mockFetch = createMockFetch(FIXTURES.basicText)
    const model = createModel(mockFetch)

    const { stream } = await model.doStream({
      prompt: TEST_PROMPT,
      includeRawChunks: false,
    })

    const parts = await convertReadableStreamToArray(stream)

    const streamStart = parts.find((p) => p.type === "stream-start")
    expect(streamStart).toEqual({
      type: "stream-start",
      warnings: [],
    })
  })

  test("should include raw chunks when requested", async () => {
    const mockFetch = createMockFetch(FIXTURES.basicText)
    const model = createModel(mockFetch)

    const { stream } = await model.doStream({
      prompt: TEST_PROMPT,
      includeRawChunks: true,
    })

    const parts = await convertReadableStreamToArray(stream)

    const rawChunks = parts.filter((p) => p.type === "raw")
    expect(rawChunks.length).toBeGreaterThan(0)
  })
})

describe("request body", () => {
  test("should send tools in OpenAI format", async () => {
    let capturedBody: unknown
    const mockFetch = mock(async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string)
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(`data: [DONE]\n\n`))
            controller.close()
          },
        }),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      )
    })

    const model = createModel(mockFetch)

    await model.doStream({
      prompt: TEST_PROMPT,
      tools: [
        {
          type: "function",
          name: "get_weather",
          description: "Get the weather for a location",
          inputSchema: {
            type: "object",
            properties: {
              location: { type: "string" },
            },
            required: ["location"],
          },
        },
      ],
      includeRawChunks: false,
    })

    expect((capturedBody as { tools: unknown[] }).tools).toEqual([
      {
        type: "function",
        function: {
          name: "get_weather",
          description: "Get the weather for a location",
          parameters: {
            type: "object",
            properties: {
              location: { type: "string" },
            },
            required: ["location"],
          },
        },
      },
    ])
  })
})
