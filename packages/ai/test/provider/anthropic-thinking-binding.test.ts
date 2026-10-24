import { expect } from "bun:test"
import { Effect } from "effect"
import { LLM } from "../../src/index.js"
import { AnthropicMessages } from "../../src/protocols/anthropic-messages.js"
import { compileRequest } from "../../src/route/client.js"
import { it } from "../lib/effect.js"

const binding = { block_binding: { prefix_mismatch_behavior: "drop_block" } }
const summarized = { display: "summarized" }

for (const [id, enabled, progress] of [
  ["claude-fable-5-1", true, true],
  ["claude-mythos-5-1", true, true],
  ["claude-fable-5.1", true, true],
  ["anthropic/claude-fable-5.1", true, true],
  ["claude-fable-5-1@default", true, true],
  ["claude-fable-5-1@20260901", true, true],
  ["claude-sonnet-5-5", true, true],
  ["claude-opus-5-5", true, true],
  ["claude-sonnet-6", true, true],
  ["claude-sonnet-5-2", true, false],
  ["claude-opus-5-20260901", false, false],
  ["claude-opus-4-8", false, false],
  ["anthropic/claude-opus-4.8", false, false],
  ["claude-fable-5@default", false, true],
  ["kimi-k2.5", false, false],
] as const) {
  it.effect(`thinking defaults for ${id}`, () =>
    Effect.gen(function* () {
      const request = LLM.request({
        model: AnthropicMessages.route.model({ id }),
        prompt: "Hello",
        http: { headers: { "anthropic-beta": "existing-beta" } },
      })
      const compiled = yield* compileRequest(request)
      const prepared = yield* AnthropicMessages.route.prepareTransport(compiled.body, request)
      expect(compiled.body.thinking).toEqual(
        enabled || progress
          ? { type: "adaptive", ...(progress ? summarized : {}), ...(enabled ? binding : {}) }
          : undefined,
      )
      expect(prepared.request.headers["anthropic-beta"]).toBe(
        enabled
          ? "existing-beta,interleaved-thinking-2025-05-14,thinking-binding-controls-2026-08-01"
          : "existing-beta,interleaved-thinking-2025-05-14",
      )
    }),
  )
}

it.effect("preserves explicit thinking settings and combines required beta headers", () =>
  Effect.gen(function* () {
    for (const thinking of [
      { type: "disabled" },
      { type: "between_tools" },
      { type: "adaptive", display: "omitted", block_binding: { prefix_mismatch_behavior: "error" } },
    ] as const) {
      const request = LLM.request({
        model: AnthropicMessages.route.model({ id: "claude-fable-5-1" }),
        prompt: "Hello",
        providerOptions: { thinking, contextManagement: { edits: [{ type: "compact_20260112" }] } },
      })
      const compiled = yield* compileRequest(request)
      const prepared = yield* AnthropicMessages.route.prepareTransport(compiled.body, request)
      expect(compiled.body.thinking).toEqual(thinking)
      expect(prepared.request.headers["anthropic-beta"]).toBe(
        thinking.type === "disabled" || thinking.type === "between_tools"
          ? "interleaved-thinking-2025-05-14,compact-2026-01-12"
          : "interleaved-thinking-2025-05-14,compact-2026-01-12,thinking-binding-controls-2026-08-01",
      )
    }
  }),
)

it.effect("requests summarized display on explicit adaptive thinking without a display", () =>
  Effect.gen(function* () {
    const request = LLM.request({
      model: AnthropicMessages.route.model({ id: "claude-sonnet-5-5" }),
      prompt: "Hello",
      providerOptions: { thinking: { type: "adaptive" }, effort: "high" },
    })
    const compiled = yield* compileRequest(request)
    expect(compiled.body.thinking).toEqual({ type: "adaptive", ...summarized, ...binding })
  }),
)
