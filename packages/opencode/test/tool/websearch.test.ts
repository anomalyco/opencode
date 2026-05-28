import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { parseResponse } from "../../src/tool/mcp-websearch"
import {
  resolveProviders,
  selectWebSearchProvider,
  webSearchModelName,
  webSearchProviderLabel,
} from "../../src/tool/websearch"
import { webSearchEnabled } from "../../src/tool/registry"
import { it } from "../lib/effect"
import { ProviderV2 } from "@opencode-ai/core/provider"

const SESSION_ID = "ses_0196aabbccddeeff001122334455"

function resolved(ids: string[], weights?: Record<string, number>) {
  return ids.map((id) => ({
    id,
    label: `${id} label`,
    url: `https://${id}.example/mcp`,
    tool: "search",
    weight: weights?.[id] ?? 1,
    headers: () => ({}),
    buildArgs: () => ({}),
  }))
}

describe("websearch provider selection", () => {
  test("returns undefined when no providers are enabled", () => {
    expect(selectWebSearchProvider(SESSION_ID, [])).toBeUndefined()
  })

  test("selects a stable provider per session", () => {
    const providers = resolved(["exa", "parallel"])
    expect(selectWebSearchProvider(SESSION_ID, providers)?.id).toBe(
      selectWebSearchProvider(SESSION_ID, providers)?.id,
    )
  })

  test("supports an operational env override for any provider id", () => {
    const original = process.env.OPENCODE_WEBSEARCH_PROVIDER
    const providers = resolved(["exa", "parallel", "acme"])
    try {
      process.env.OPENCODE_WEBSEARCH_PROVIDER = "acme"
      expect(selectWebSearchProvider(SESSION_ID, providers)?.id).toBe("acme")

      process.env.OPENCODE_WEBSEARCH_PROVIDER = "parallel"
      expect(selectWebSearchProvider(SESSION_ID, providers)?.id).toBe("parallel")
    } finally {
      if (original === undefined) delete process.env.OPENCODE_WEBSEARCH_PROVIDER
      else process.env.OPENCODE_WEBSEARCH_PROVIDER = original
    }
  })

  test("ignores env override when the id is not in the enabled set", () => {
    const original = process.env.OPENCODE_WEBSEARCH_PROVIDER
    try {
      process.env.OPENCODE_WEBSEARCH_PROVIDER = "ghost"
      const providers = resolved(["exa"])
      expect(selectWebSearchProvider(SESSION_ID, providers)?.id).toBe("exa")
    } finally {
      if (original === undefined) delete process.env.OPENCODE_WEBSEARCH_PROVIDER
      else process.env.OPENCODE_WEBSEARCH_PROVIDER = original
    }
  })

  test("honors websearch.default when no env override", () => {
    const providers = resolved(["exa", "parallel"])
    expect(selectWebSearchProvider(SESSION_ID, providers, { default: "parallel" })?.id).toBe("parallel")
  })

  test("weights bias the deterministic split", () => {
    // With weight 1000 for "exa" vs 1 for "parallel", a single bucket out of
    // 1001 hits parallel — over a few different session ids we should see
    // exa dominate.
    const providers = resolved(["exa", "parallel"], { exa: 1000, parallel: 1 })
    let exa = 0
    for (let i = 0; i < 50; i++) {
      const id = selectWebSearchProvider(`ses_${i}`, providers)?.id
      if (id === "exa") exa++
    }
    expect(exa).toBeGreaterThan(45)
  })
})

describe("resolveProviders", () => {
  test("env flags enable built-ins", () => {
    const list = resolveProviders({ exa: true, parallel: false }, undefined)
    expect(list.map((p) => p.id)).toEqual(["exa"])
  })

  test("config enabled flag flips built-in state", () => {
    const list = resolveProviders(
      { exa: false, parallel: false },
      { providers: { parallel: { enabled: true } } },
    )
    expect(list.map((p) => p.id)).toEqual(["parallel"])
  })

  test("config can disable a built-in that env enabled", () => {
    const list = resolveProviders(
      { exa: true, parallel: false },
      { providers: { exa: { enabled: false } } },
    )
    expect(list).toEqual([])
  })

  test("registers user-defined providers with url + tool", () => {
    const list = resolveProviders(
      { exa: false, parallel: false },
      {
        providers: {
          acme: { url: "https://acme.example/mcp", tool: "search", weight: 3 },
        },
      },
    )
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe("acme")
    expect(list[0].weight).toBe(3)
    expect(list[0].label).toBe("Acme Web Search")
  })

  test("skips user-defined providers missing url or tool", () => {
    const list = resolveProviders(
      { exa: false, parallel: false },
      { providers: { broken: { url: "https://broken.example/mcp" } } },
    )
    expect(list).toEqual([])
  })
})

describe("websearch tool gating", () => {
  test("is only enabled for opencode or when at least one provider is resolved", () => {
    expect(webSearchEnabled(ProviderV2.ID.opencode, false)).toBe(true)
    expect(webSearchEnabled(ProviderV2.ID.openai, false)).toBe(false)
    expect(webSearchEnabled(ProviderV2.ID.openai, true)).toBe(true)
  })
})

describe("labels and model names", () => {
  test("uses branded labels for built-ins and titlecases unknown ids", () => {
    expect(webSearchProviderLabel("parallel")).toBe("Parallel Web Search")
    expect(webSearchProviderLabel("exa")).toBe("Exa Web Search")
    expect(webSearchProviderLabel("acme")).toBe("Acme Web Search")
    expect(webSearchProviderLabel(undefined)).toBe("Web Search")
  })

  test("uses the provider API model id for analytics", () => {
    expect(
      webSearchModelName({
        model: {
          id: "claude-opus-4-7",
          api: { id: "claude-opus-4.7" },
        },
      }),
    ).toBe("claude-opus-4.7")
  })
})

describe("websearch MCP response parser", () => {
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    result: {
      content: [
        {
          type: "text",
          text: "search results",
        },
      ],
    },
  })

  it.effect("parses plain JSON-RPC responses", () =>
    Effect.gen(function* () {
      const result = yield* parseResponse(payload)
      expect(result).toBe("search results")
    }),
  )

  it.effect("parses SSE JSON-RPC responses", () =>
    Effect.gen(function* () {
      const result = yield* parseResponse(`event: message\ndata: ${payload}\n\n`)
      expect(result).toBe("search results")
    }),
  )

  it.effect("ignores non-JSON SSE data frames", () =>
    Effect.gen(function* () {
      const result = yield* parseResponse(`data: [DONE]\ndata: ${payload}\n\n`)
      expect(result).toBe("search results")
    }),
  )
})
