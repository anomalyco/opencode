import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { parseResponse } from "../../src/tool/mcp-websearch"
import {
  selectWebSearchProvider,
  webSearchModelName,
  webSearchProviderLabel,
} from "../../src/tool/websearch"
import { ProviderID } from "../../src/provider/schema"
import { webSearchEnabled } from "../../src/tool/registry"

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
    expect(webSearchEnabled(ProviderID.opencode, { exa: false, parallel: false })).toBe(true)
    expect(webSearchEnabled(ProviderID.openai, { exa: false, parallel: false })).toBe(false)
    expect(webSearchEnabled(ProviderID.openai, { exa: true, parallel: false })).toBe(true)
    expect(webSearchEnabled(ProviderID.openai, { exa: false, parallel: true })).toBe(true)
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

  test("parses plain JSON-RPC responses", async () => {
    await expect(Effect.runPromise(parseResponse(payload))).resolves.toBe("search results")
  })

  test("parses SSE JSON-RPC responses", async () => {
    await expect(Effect.runPromise(parseResponse(`event: message\ndata: ${payload}\n\n`))).resolves.toBe("search results")
  })

  test("ignores non-JSON SSE data frames", async () => {
    await expect(Effect.runPromise(parseResponse(`data: [DONE]\ndata: ${payload}\n\n`))).resolves.toBe("search results")
  })
})
