import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { parseResponse } from "../../src/tool/mcp-websearch"
import {
  selectWebSearchProvider,
  WebSearchTool,
  webSearchModelName,
  webSearchProviderLabel,
} from "../../src/tool/websearch"

import { webSearchEnabled } from "../../src/tool/registry"
import { it, testEffect } from "../lib/effect"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { MessageID, SessionID } from "../../src/session/schema"
import { Tool } from "@/tool/tool"
import { withEnv, withIflowServer } from "./iflow-test-util"
import { Truncate } from "@/tool/truncate"
import { Agent } from "../../src/agent/agent"

const SESSION_ID = "ses_0196aabbccddeeff001122334455"
const toolIt = testEffect(Layer.mergeAll(FetchHttpClient.layer, RuntimeFlags.layer(), Truncate.defaultLayer, Agent.defaultLayer))

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_message"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const exec = Effect.fn("WebSearchToolTest.exec")(function* (args: Tool.InferParameters<typeof WebSearchTool>) {
  const info = yield* WebSearchTool
  const tool = yield* info.init()
  return yield* tool.execute(args, ctx)
})

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

      process.env.OPENCODE_WEBSEARCH_PROVIDER = "iflow"
      expect(selectWebSearchProvider(SESSION_ID)).toBe("iflow")
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
    expect(webSearchEnabled(ProviderV2.ID.openai, { exa: false, parallel: false, iflow: true })).toBe(true)
  })

  test("is enabled when iFlow is explicitly selected", () => {
    const original = process.env.OPENCODE_WEBSEARCH_PROVIDER

    try {
      process.env.OPENCODE_WEBSEARCH_PROVIDER = "iflow"
      expect(webSearchEnabled(ProviderV2.ID.openai, { exa: false, parallel: false })).toBe(true)
    } finally {
      if (original === undefined) delete process.env.OPENCODE_WEBSEARCH_PROVIDER
      else process.env.OPENCODE_WEBSEARCH_PROVIDER = original
    }
  })

  test("uses branded labels", () => {
    expect(webSearchProviderLabel("iflow")).toBe("iFlow Search")
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

  toolIt.instance("calls iFlow webSearch when iFlow provider is explicitly configured", () =>
    Effect.gen(function* () {
      let called = false

      const result = yield* withIflowServer(
        async (request) => {
          called = true
          expect(new URL(request.url).pathname).toBe("/api/search/webSearch")
          const body = (await request.json()) as Record<string, unknown>
          expect(body.keywords).toBe("opencode iflow")
          expect(body.num).toBe(2)
          return new Response(
            JSON.stringify({
              success: true,
              data: {
                organic: [{ title: "iFlow Result", link: "https://example.com", snippet: "from iFlow" }],
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          )
        },
        (url) =>
          withEnv(
            {
              OPENCODE_WEBSEARCH_PROVIDER: "iflow",
              IFLOW_API_KEY: "mock-credential",
              IFLOW_BASE_URL: url.toString(),
            },
            exec({ query: "opencode iflow", numResults: 2 }),
          ),
      )

      expect(called).toBe(true)
      expect(result.metadata.provider).toBe("iflow")
      expect(result.output).toContain("1. iFlow Result")
      expect(result.output).toContain("Snippet: from iFlow")
    }),
  )
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
