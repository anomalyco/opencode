import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import { Effect, Layer } from "effect"
import { logLines } from "effect/testing/TestConsole"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { parseResponse } from "../../src/tool/mcp-websearch"
import { selectWebSearchProvider, webSearchModelName, webSearchProviderLabel } from "../../src/tool/websearch"

import { ToolRegistry } from "@/tool/registry"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { InstanceState } from "@/effect/instance-state"
import { disposeAllInstances } from "../fixture/fixture"
import { it, testEffect } from "../lib/effect"
import { TestConfig } from "../fixture/config"

const SESSION_ID = "ses_0196aabbccddeeff001122334455"

const configLayer = (info: Record<string, unknown>) =>
  TestConfig.layer({
    directories: () => InstanceState.directory.pipe(Effect.map((dir) => [path.join(dir, ".opencode")])),
    get: () => Effect.succeed(info as ConfigV1.Info),
  })

const root = LayerNode.group([ToolRegistry.node, Agent.node])

const runner = (info: Record<string, unknown> = {}, flags: Record<string, unknown> = {}) =>
  testEffect(
    LayerNode.compile(root, [
      [Config.node, configLayer(info)],
      [RuntimeFlags.node, RuntimeFlags.layer(flags as never)],
    ] as const),
  )

const itDefault = runner()
const itDisabled = runner({ websearch: { enabled: false } })
const itEnabled = runner({ websearch: { enabled: true } })
const itLegacyExaFlag = runner({}, { enableExa: true })

afterEach(async () => {
  await disposeAllInstances()
})

const toolsFor = (providerID: ProviderV2.ID) =>
  Effect.gen(function* () {
    const registry = yield* ToolRegistry.Service
    const agents = yield* Agent.Service
    const agent = yield* agents.defaultInfo()
    const tools = yield* registry.tools({ providerID, modelID: ModelV2.ID.make("test"), agent })
    return tools.map((tool) => tool.id)
  })

describe("websearch tool availability", () => {
  // B1 — default-on for every provider, whitelisted or not
  itDefault.instance("is included for arbitrary providers without any config", () =>
    Effect.gen(function* () {
      const ids = yield* toolsFor(ProviderV2.ID.make("ollama-local"))
      expect(ids).toContain("websearch")
    }),
  )

  // B5 — explicit opt-in keeps the tool
  itEnabled.instance("stays included when websearch.enabled is explicitly true", () =>
    Effect.gen(function* () {
      const ids = yield* toolsFor(ProviderV2.ID.openai)
      expect(ids).toContain("websearch")
    }),
  )

  // B2 — opt-out hides the tool for non-managed providers
  itDisabled.instance("is hidden when websearch.enabled is false", () =>
    Effect.gen(function* () {
      const ids = yield* toolsFor(ProviderV2.ID.make("ollama-local"))
      expect(ids).not.toContain("websearch")
    }),
  )

  // B3 — config wins over managed-provider status
  itDisabled.instance("is hidden even for managed providers when websearch.enabled is false", () =>
    Effect.gen(function* () {
      const ids = yield* toolsFor(ProviderV2.ID.opencode)
      expect(ids).not.toContain("websearch")
    }),
  )

  // B7 — legacy OPENCODE_ENABLE_EXA no longer gates inclusion but warns once
  itLegacyExaFlag.instance("warns once that legacy enablement env vars are deprecated", () =>
    Effect.gen(function* () {
      const ids = yield* toolsFor(ProviderV2.ID.make("ollama-local"))
      expect(ids).toContain("websearch")

      const lines = yield* logLines
      expect(JSON.stringify(lines)).toContain("OPENCODE_ENABLE_EXA")
    }),
  )
})

describe("websearch backend selection", () => {
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

  // B4 — config pin is honored
  test("honors an explicit config pin", () => {
    expect(selectWebSearchProvider(SESSION_ID, { provider: "exa" })).toBe("exa")
    expect(selectWebSearchProvider(SESSION_ID, { provider: "parallel" })).toBe("parallel")
  })

  // B4/"auto" — the default value must behave like no pin at all
  test("treats provider 'auto' like no pin", () => {
    expect(selectWebSearchProvider(SESSION_ID, { provider: "auto" })).toBe(selectWebSearchProvider(SESSION_ID))
  })

  // B6/#44343 review note — an invalid env pin must not crash and must fall
  // back to the same result as no pin
  test("ignores an invalid OPENCODE_WEBSEARCH_PROVIDER value", () => {
    const original = process.env.OPENCODE_WEBSEARCH_PROVIDER

    try {
      process.env.OPENCODE_WEBSEARCH_PROVIDER = "bogus"
      const withBogus = selectWebSearchProvider(SESSION_ID)

      delete process.env.OPENCODE_WEBSEARCH_PROVIDER
      expect(withBogus).toBe(selectWebSearchProvider(SESSION_ID))
    } finally {
      if (original === undefined) delete process.env.OPENCODE_WEBSEARCH_PROVIDER
      else process.env.OPENCODE_WEBSEARCH_PROVIDER = original
    }
  })

  // B8/D3 — config pin beats the env var, which beats legacy flags
  test("ranks config pin over the env var and legacy flags", () => {
    const original = process.env.OPENCODE_WEBSEARCH_PROVIDER

    try {
      process.env.OPENCODE_WEBSEARCH_PROVIDER = "exa"
      expect(selectWebSearchProvider(SESSION_ID, { provider: "parallel" })).toBe("parallel")
      expect(selectWebSearchProvider(SESSION_ID, { parallel: true })).toBe("exa")

      delete process.env.OPENCODE_WEBSEARCH_PROVIDER
      expect(selectWebSearchProvider(SESSION_ID, { exa: true, parallel: true })).toBe("parallel")
    } finally {
      if (original === undefined) delete process.env.OPENCODE_WEBSEARCH_PROVIDER
      else process.env.OPENCODE_WEBSEARCH_PROVIDER = original
    }
  })

  // D3 — legacy flags remain pure backend pins
  test("routes to Exa when the Exa flag is set", () => {
    expect(selectWebSearchProvider(SESSION_ID, { exa: true })).toBe("exa")
  })

  test("routes to Parallel when the Parallel flag is set", () => {
    expect(selectWebSearchProvider(SESSION_ID, { parallel: true })).toBe("parallel")
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
