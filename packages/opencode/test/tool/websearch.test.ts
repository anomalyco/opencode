import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { parseResponse } from "../../src/tool/mcp-websearch"
import {
  Parameters,
  ParallelParameters,
  selectWebSearchProvider,
  shouldExposeParallelExtras,
  webSearchModelName,
  webSearchProviderLabel,
} from "../../src/tool/websearch"
import { webSearchEnabled } from "../../src/tool/registry"
import { it } from "../lib/effect"
import { ProviderV2 } from "@opencode-ai/core/provider"

const SESSION_ID = "ses_0196aabbccddeeff001122334455"

describe("websearch provider", () => {
  test("selects a stable provider per session", () => {
    expect(selectWebSearchProvider(SESSION_ID)).toBe(selectWebSearchProvider(SESSION_ID))
  })

  test("supports an operational override", () => {
    const original = process.env.OPENCODE_WEBSEARCH_PROVIDER

    try {
      process.env.OPENCODE_WEBSEARCH_PROVIDER = "parallel"
      expect(selectWebSearchProvider(SESSION_ID)).toBe("parallel")

      process.env.OPENCODE_WEBSEARCH_PROVIDER = "exa"
      expect(selectWebSearchProvider(SESSION_ID)).toBe("exa")
    } finally {
      if (original === undefined) delete process.env.OPENCODE_WEBSEARCH_PROVIDER
      else process.env.OPENCODE_WEBSEARCH_PROVIDER = original
    }
  })

  test("routes to Exa when the Exa flag is enabled", () => {
    expect(selectWebSearchProvider(SESSION_ID, { exa: true, parallel: false })).toBe("exa")
  })

  test("routes to Parallel when the Parallel flag is enabled", () => {
    expect(selectWebSearchProvider(SESSION_ID, { exa: false, parallel: true })).toBe("parallel")
  })

  test("is only enabled for opencode or explicit websearch provider flags", () => {
    expect(webSearchEnabled(ProviderV2.ID.opencode, { exa: false, parallel: false })).toBe(true)
    expect(webSearchEnabled(ProviderV2.ID.openai, { exa: false, parallel: false })).toBe(false)
    expect(webSearchEnabled(ProviderV2.ID.openai, { exa: true, parallel: false })).toBe(true)
    expect(webSearchEnabled(ProviderV2.ID.openai, { exa: false, parallel: true })).toBe(true)
  })

  test("uses branded labels", () => {
    expect(webSearchProviderLabel("parallel")).toBe("Parallel Web Search")
    expect(webSearchProviderLabel("exa")).toBe("Exa Web Search")
    expect(webSearchProviderLabel(undefined)).toBe("Web Search")
  })

  test("uses the provider API model id for Parallel analytics", () => {
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

describe("websearch Parallel-only schema gating", () => {
  test("exposes Parallel extras when the env override forces Parallel", () => {
    expect(shouldExposeParallelExtras({ exa: false, parallel: false }, "parallel")).toBe(true)
  })

  test("hides Parallel extras when the env override forces Exa", () => {
    expect(shouldExposeParallelExtras({ exa: false, parallel: true }, "exa")).toBe(false)
  })

  test("exposes Parallel extras when the Parallel flag is on and no override", () => {
    expect(shouldExposeParallelExtras({ exa: false, parallel: true }, undefined)).toBe(true)
  })

  test("hides Parallel extras when only the Exa flag is on", () => {
    expect(shouldExposeParallelExtras({ exa: true, parallel: false }, undefined)).toBe(false)
  })

  test("hides Parallel extras in the 50/50 rollout fallback", () => {
    expect(shouldExposeParallelExtras({ exa: false, parallel: false }, undefined)).toBe(false)
  })
})

describe("websearch model-facing schema (Parallel exposed)", () => {
  const decode = Schema.decodeUnknownSync(ParallelParameters)
  const validInput = {
    query: "tesla q1 earnings",
    objective: "Compare Q1 2026 earnings for major US automakers",
    additionalQueries: ["ford q1 2026 earnings", "gm q1 2026 earnings"],
  }

  test("accepts a fully populated request", () => {
    expect(() => decode(validInput)).not.toThrow()
  })

  test("accepts the minimum batch size (1 additional query)", () => {
    expect(() => decode({ ...validInput, additionalQueries: ["ford q1 2026 earnings"] })).not.toThrow()
  })

  test("rejects more than 2 additionalQueries", () => {
    expect(() => decode({ ...validInput, additionalQueries: ["a", "b", "c"] })).toThrow()
  })

  test("rejects an empty additionalQueries array", () => {
    expect(() => decode({ ...validInput, additionalQueries: [] })).toThrow()
  })

  test("rejects a request missing objective", () => {
    const { objective: _omit, ...rest } = validInput
    expect(() => decode(rest)).toThrow()
  })

  test("rejects a request missing additionalQueries", () => {
    const { additionalQueries: _omit, ...rest } = validInput
    expect(() => decode(rest)).toThrow()
  })
})

describe("websearch execute-side schema (extras tolerated as optional)", () => {
  const decode = Schema.decodeUnknownSync(Parameters)

  test("accepts a call with only query (Exa shape)", () => {
    expect(() => decode({ query: "tesla q1 earnings" })).not.toThrow()
  })

  test("accepts a fully populated Parallel call", () => {
    expect(() =>
      decode({
        query: "tesla q1 earnings",
        objective: "Compare Q1 2026 earnings",
        additionalQueries: ["ford q1 2026 earnings"],
      }),
    ).not.toThrow()
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
