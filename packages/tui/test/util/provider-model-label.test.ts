/**
 * @spec-handoff
 * @interface Model.providerModel(
 *     list: Provider[] | ReadonlyMap<string, Provider> | undefined,
 *     providerID: string,
 *     modelID: string,
 *   ): string
 *   NEW export added to packages/tui/src/util/model.ts.
 * @behavior
 *   - Catalog hit (provider + model both resolve): returns "<providerName>/<modelName>"
 *     e.g. ("anthropic","claude-sonnet-4-20250514") -> "Anthropic/Claude Sonnet 4"
 *   - PARTIAL miss (provider resolves, model does NOT): PER-FIELD fallback now
 *     ALIGNED to the UI helper -> "<providerName>/<modelID>"
 *     e.g. ("anthropic","claude-unknown") -> "Anthropic/claude-unknown"
 *   - FULL miss (provider not found, name unavailable): raw fallback "<providerID>/<modelID>"
 *     e.g. ("openai","gpt-5") -> "openai/gpt-5"
 *   - Format rule: single forward slash, NO surrounding spaces ("a/b", never "a / b").
 * @edge-cases
 *   - Provider resolves but model does not -> per-field "<providerName>/<modelID>"
 *     (provider DISPLAY NAME + raw model id). Matches UI formatModelLabel.
 *   - undefined catalog -> "<providerID>/<modelID>".
 * @invariants
 *   - Model.name(...) is RETAINED intentionally (export kept even though tui src
 *     callers now use Model.providerModel). It is directly guarded by the
 *     "util.model.name" describe block below: catalog hit -> model display name,
 *     miss -> raw modelID.
 * @call-sites-to-switch  (Kou — implementation step, NOT covered here)
 *   - packages/tui/src/routes/session/index.tsx:1473  (model memo: Model.name -> Model.providerModel)
 *     rendered at index.tsx:1557. SolidJS route component is not unit-tested here; the
 *     formatter + transcript tests below cover the observable behavior.
 *   - packages/tui/src/util/transcript.ts:79-81  (formatAssistantHeader: Model.name -> Model.providerModel)
 * @see packages/tui/src/util/model.ts
 * @see packages/tui/src/util/transcript.ts
 */
import { describe, expect, test } from "bun:test"
import { name, providerModel } from "../../src/util/model"
import { formatAssistantHeader } from "../../src/util/transcript"
import type { AssistantMessage, Provider } from "@opencode-ai/sdk/v2"

// NOTE (deferred cleanup): this fully-typed provider fixture is duplicated in
// test/util/transcript.test.ts. If a third consumer appears, extract a shared
// test fixture; not worth extracting for two call sites today.
const providers: Provider[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    source: "api",
    env: [],
    options: {},
    models: {
      "claude-sonnet-4-20250514": {
        id: "claude-sonnet-4-20250514",
        providerID: "anthropic",
        api: {
          id: "claude-sonnet-4-20250514",
          url: "https://example.com/claude-sonnet-4-20250514",
          npm: "@ai-sdk/anthropic",
        },
        name: "Claude Sonnet 4",
        capabilities: {
          temperature: true,
          reasoning: true,
          attachment: true,
          toolcall: true,
          input: { text: true, audio: false, image: true, video: false, pdf: true },
          output: { text: true, audio: false, image: false, video: false, pdf: false },
          interleaved: false,
        },
        cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
        limit: { context: 200_000, output: 8_192 },
        status: "active",
        options: {},
        headers: {},
        release_date: "2025-05-14",
      },
    },
  },
]

describe("util.model.providerModel", () => {
  test("catalog hit: returns providerName/modelName", () => {
    expect(providerModel(providers, "anthropic", "claude-sonnet-4-20250514")).toBe("Anthropic/Claude Sonnet 4")
  })

  test("catalog miss (unknown provider): falls back to providerID/modelID", () => {
    expect(providerModel(providers, "openai", "gpt-5")).toBe("openai/gpt-5")
  })

  test("partial miss (known provider, unknown model): per-field fallback providerName/modelID", () => {
    expect(providerModel(providers, "anthropic", "claude-unknown")).toBe("Anthropic/claude-unknown")
  })

  test("undefined catalog: falls back to providerID/modelID", () => {
    expect(providerModel(undefined, "anthropic", "claude-sonnet-4-20250514")).toBe("anthropic/claude-sonnet-4-20250514")
  })

  test("format rule: single forward slash, no surrounding spaces", () => {
    const result = providerModel(providers, "anthropic", "claude-sonnet-4-20250514")
    expect(result).not.toContain(" / ")
    expect(result.split("/")).toHaveLength(2)
  })
})

describe("util.model.name", () => {
  test("catalog hit: returns the model display name", () => {
    expect(name(providers, "anthropic", "claude-sonnet-4-20250514")).toBe("Claude Sonnet 4")
  })

  test("catalog miss (unknown model): falls back to raw modelID", () => {
    expect(name(providers, "anthropic", "claude-unknown")).toBe("claude-unknown")
  })

  test("catalog miss (unknown provider): falls back to raw modelID", () => {
    expect(name(providers, "openai", "gpt-5")).toBe("gpt-5")
  })
})

describe("transcript assistant header shows provider/model", () => {
  const baseMsg: AssistantMessage = {
    id: "msg_123",
    sessionID: "ses_123",
    role: "assistant",
    agent: "build",
    modelID: "claude-sonnet-4-20250514",
    providerID: "anthropic",
    mode: "",
    parentID: "msg_parent",
    path: { cwd: "/test", root: "/test" },
    cost: 0.001,
    tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1000000, completed: 1005400 },
  }

  test("header includes provider next to model as provider/model", () => {
    const result = formatAssistantHeader(baseMsg, true, providers)
    expect(result).toContain("Anthropic/Claude Sonnet 4")
  })

  test("header falls back to raw provider/model ids on catalog miss", () => {
    const result = formatAssistantHeader(baseMsg, true)
    expect(result).toContain("anthropic/claude-sonnet-4-20250514")
  })
})
