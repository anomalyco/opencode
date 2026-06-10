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
 *   - Catalog miss (provider OR model not found): falls back to "<providerID>/<modelID>"
 *     e.g. ("openai","gpt-5") -> "openai/gpt-5"
 *   - Format rule: single forward slash, NO surrounding spaces ("a/b", never "a / b").
 * @edge-cases
 *   - Provider resolves but model does not -> full raw-ID fallback "<providerID>/<modelID>".
 *   - undefined catalog -> "<providerID>/<modelID>".
 * @invariants
 *   - Model.name(...) MUST remain unchanged (other callers depend on model-name-only output).
 *     This file does not test Model.name; existing model/transcript tests guard it.
 * @call-sites-to-switch  (Kou — implementation step, NOT covered here)
 *   - packages/tui/src/routes/session/index.tsx:1473  (model memo: Model.name -> Model.providerModel)
 *     rendered at index.tsx:1557. SolidJS route component is not unit-tested here; the
 *     formatter + transcript tests below cover the observable behavior.
 *   - packages/tui/src/util/transcript.ts:79-81  (formatAssistantHeader: Model.name -> Model.providerModel)
 * @see packages/tui/src/util/model.ts
 * @see packages/tui/src/util/transcript.ts
 */
import { describe, expect, test } from "bun:test"
import { providerModel } from "../../src/util/model"
import { formatAssistantHeader } from "../../src/util/transcript"
import type { AssistantMessage, Provider } from "@opencode-ai/sdk/v2"

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

  test("partial miss (known provider, unknown model): falls back to providerID/modelID", () => {
    expect(providerModel(providers, "anthropic", "claude-unknown")).toBe("anthropic/claude-unknown")
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
