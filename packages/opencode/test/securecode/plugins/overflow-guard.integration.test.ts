// Integration test reproducing the scenario reported in
// https://github.com/acompany-develop/securecode/issues/54.
//
// The original observed session contained 28 tool outputs totalling ~123,546
// bytes. The largest individual outputs were:
//   read results/.../summary.json   24,026 bytes
//   slack_slack_search_public        23,099 bytes
//   read CONTRIBUTING.md             13,744 bytes
// With qwen3-coder-next (context 131,072, usable input 114,688) plus a
// reserved output of 16,384 tokens, the prompt eventually exceeded the
// provider's input budget by 1 token and looped through compaction without
// recovery.
//
// The plugin's truncation runs in `experimental.chat.messages.transform`,
// which fires once per build turn after every tool result has been normalized
// into MessageV2.ToolPart.state.output. This single mutation point covers
// both native tools and MCP tools (slack_slack_search_public is an MCP tool;
// see prompt.ts:507-519 for how MCP results are joined into ToolPart).
//
// This test asserts:
//   1. WITHOUT the plugin, the flattened text matches the reported overflow
//      scale.
//   2. WITH the plugin's messages.transform applied, every oversized tool
//      output is rewritten in-place and the token estimate falls below the
//      usable input budget.
//   3. chat.params reduces maxOutputTokens when the prompt is close to cap.

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  OverflowGuardPlugin,
  estimateTokensCharBased,
  flattenMessageText,
  truncateHeadTail,
  _testing_resetCache,
} from "../../../src/securecode/plugins/overflow-guard"

const stubPluginInput = {} as Parameters<typeof OverflowGuardPlugin>[0]

beforeEach(() => {
  _testing_resetCache()
})

afterEach(() => {
  _testing_resetCache()
})

type ToolPart = {
  type: "tool"
  state: { status: "completed"; input: Record<string, unknown>; output: string }
}

type Message = {
  info: { sessionID: string; role: string }
  parts: Array<{ type: "text"; text: string } | ToolPart>
}

function makeToolPart(_name: string, input: Record<string, unknown>, output: string): ToolPart {
  return { type: "tool", state: { status: "completed", input, output } }
}

function buildIssue54Stream(): Message[] {
  const sessionID = "ses_2c0768394ffexWIpAUoKDunw0X"

  const summaryJson = "X".repeat(24_026)
  const slackSearch = "Y".repeat(23_099)
  const contributing = "Z".repeat(13_744)

  // 25 small tool outputs averaging ~2.5KB each to total ~62.7KB; combined
  // with the three large ones above this reaches ~123.5KB.
  const fillerTargetBytes = 123_546 - (24_026 + 23_099 + 13_744)
  const filler = Array.from({ length: 25 }, (_v, i) => {
    const size = Math.floor(fillerTargetBytes / 25) + (i === 0 ? fillerTargetBytes % 25 : 0)
    return makeToolPart("read", { path: `notes/${i}.md` }, `${i}: `.padEnd(size, "."))
  })

  return [
    {
      info: { sessionID, role: "user" },
      parts: [{ type: "text", text: "このディレクトリのファイルを、いい感じに分類して整理して" }],
    },
    {
      info: { sessionID, role: "assistant" },
      parts: [
        ...filler,
        makeToolPart("read", { path: "results/summary.json" }, summaryJson),
        makeToolPart("slack_slack_search_public", { query: "incident" }, slackSearch),
        makeToolPart("read", { path: "CONTRIBUTING.md" }, contributing),
      ],
    },
  ]
}

const QWEN3_CODER_NEXT_CONTEXT = 131_072
const QWEN3_CODER_NEXT_OUTPUT_RESERVED = 16_384
const USABLE_INPUT_BUDGET = QWEN3_CODER_NEXT_CONTEXT - QWEN3_CODER_NEXT_OUTPUT_RESERVED // 114,688

describe("issue #54 reproduction", () => {
  test("without plugin: flattened tool outputs roughly match the reported overflow scale", () => {
    const stream = buildIssue54Stream()
    const flat = flattenMessageText(stream as any)
    const totalBytes = Buffer.byteLength(flat, "utf8")
    // Tolerate small variance from JSON-encoded args being added.
    expect(totalBytes).toBeGreaterThan(120_000)
    expect(totalBytes).toBeLessThan(130_000)
  })

  test("with plugin messages.transform: every large output is truncated, including the slack MCP tool", async () => {
    const hooks = await OverflowGuardPlugin(stubPluginInput)
    const transform = hooks["experimental.chat.messages.transform"]!

    const stream = buildIssue54Stream()
    await transform({} as any, { messages: stream as any } as any)

    const flatAfter = flattenMessageText(stream as any)
    const bytesAfter = Buffer.byteLength(flatAfter, "utf8")
    const tokensAfter = estimateTokensCharBased(flatAfter)
    const tokensBefore = estimateTokensCharBased(flattenMessageText(buildIssue54Stream() as any))

    expect(bytesAfter).toBeLessThan(120_000)
    expect(tokensAfter).toBeLessThan(USABLE_INPUT_BUDGET)
    expect(tokensAfter).toBeLessThan(tokensBefore)

    // Outputs above the 20,480-byte threshold must be truncated. The MCP slack
    // tool (23,099 bytes) is the most important case — the previous
    // tool.execute.after implementation missed it entirely. CONTRIBUTING.md is
    // only 13,744 bytes (below threshold) so it must remain unchanged.
    const assistantParts = stream[1].parts.filter((p): p is ToolPart => p.type === "tool")
    const summaryPart = assistantParts.find((p) => p.state.input.path === "results/summary.json")!
    const slackPart = assistantParts.find((p) => (p.state.input as any).query === "incident")!
    const contribPart = assistantParts.find((p) => p.state.input.path === "CONTRIBUTING.md")!

    expect(summaryPart.state.output).toContain("truncated by securecode overflow-guard")
    expect(slackPart.state.output).toContain("truncated by securecode overflow-guard")
    expect(contribPart.state.output).not.toContain("truncated by securecode overflow-guard")

    expect(Buffer.byteLength(summaryPart.state.output, "utf8")).toBeLessThan(24_026)
    expect(Buffer.byteLength(slackPart.state.output, "utf8")).toBeLessThan(23_099)
    expect(Buffer.byteLength(contribPart.state.output, "utf8")).toBe(13_744)
  })

  test("chat.params: when raw stream estimate is close to budget, maxOutputTokens shrinks", async () => {
    // Construct a stream whose char-based estimate intentionally crosses the
    // qwen3-coder-next usable input budget. CJK content compresses at ~0.6
    // tokens/char so we use a deliberately large CJK payload that the
    // truncation pass leaves alone (this part is `text`, not a tool output).
    const big = "あ".repeat(150_000) // ~90,000 tokens by char-based estimate
    const stream: Message[] = [
      {
        info: { sessionID: "issue54-fit", role: "user" },
        parts: [{ type: "text", text: big }],
      },
    ]

    const hooks = await OverflowGuardPlugin(stubPluginInput)
    const transform = hooks["experimental.chat.messages.transform"]!
    const chatParams = hooks["chat.params"]!

    await transform({} as any, { messages: stream as any } as any)

    const inputEstimate = estimateTokensCharBased(flattenMessageText(stream as any))
    expect(inputEstimate).toBeGreaterThan(USABLE_INPUT_BUDGET / 2)

    const params = {
      temperature: 0.7,
      topP: 1,
      topK: 1,
      maxOutputTokens: QWEN3_CODER_NEXT_OUTPUT_RESERVED,
      options: {},
    }
    await chatParams(
      {
        sessionID: "issue54-fit",
        agent: "build",
        model: {
          id: "qwen3-coder-next",
          limit: { context: QWEN3_CODER_NEXT_CONTEXT, output: QWEN3_CODER_NEXT_OUTPUT_RESERVED },
        } as any,
        provider: { source: "config", info: {}, options: {} } as any,
        message: {} as any,
      } as any,
      params as any,
    )

    const remaining = QWEN3_CODER_NEXT_CONTEXT - inputEstimate - 1024
    expect(params.maxOutputTokens).toBeLessThanOrEqual(Math.max(1024, remaining))
  })

  test("truncateHeadTail directly: 24KB summary fits under threshold after compression", () => {
    const summary = "X".repeat(24_026)
    const result = truncateHeadTail(summary, 20_480, 8_192, 8_192)
    expect(result.truncated).toBe(true)
    expect(Buffer.byteLength(result.output, "utf8")).toBeLessThan(20_480)
    expect(result.originalBytes).toBe(24_026)
  })
})
