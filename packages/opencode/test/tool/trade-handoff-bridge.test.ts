import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { createTradeMemoryService } from "../../../../.opencode/mcp/service"
import { startTradeMemoryHttpServer } from "../../../../.opencode/mcp/http"
import { createTradeHandoffBridgeHooks, parseServiceCommand } from "../../../../.opencode/plugins/trade-handoff-bridge"
import type { Model } from "../../src/provider/provider"

const baseEnv = {
  url: process.env.OPENCODE_TRADE_MEMORY_SERVICE_URL,
  port: process.env.OPENCODE_TRADE_MEMORY_SERVICE_PORT,
  autostart: process.env.OPENCODE_TRADE_MEMORY_SERVICE_AUTOSTART,
}

afterEach(() => {
  process.env.OPENCODE_TRADE_MEMORY_SERVICE_URL = baseEnv.url
  process.env.OPENCODE_TRADE_MEMORY_SERVICE_PORT = baseEnv.port
  process.env.OPENCODE_TRADE_MEMORY_SERVICE_AUTOSTART = baseEnv.autostart
})

describe("trade-handoff bridge", () => {
  test("parseServiceCommand returns tokens or undefined", () => {
    expect(parseServiceCommand(undefined)).toBeUndefined()
    expect(parseServiceCommand("bun .opencode/mcp/trade-memory-server.ts --http")).toEqual([
      "bun",
      ".opencode/mcp/trade-memory-server.ts",
      "--http",
    ])
  })

  test("system transform injects handoff block from service", async () => {
    process.env.OPENCODE_TRADE_MEMORY_SERVICE_PORT = "19788"
    process.env.OPENCODE_TRADE_MEMORY_SERVICE_URL = "http://127.0.0.1:19788"
    process.env.OPENCODE_TRADE_MEMORY_SERVICE_AUTOSTART = "false"

    const service = createTradeMemoryService()
    const server = startTradeMemoryHttpServer({ service, port: 19788 })
    const hooks = createTradeHandoffBridgeHooks(path.resolve("/Users/wag/ea/opencode-trade"))
    const model: Model = {
      id: ModelV2.ID.make("gpt-5.4"),
      providerID: ProviderV2.ID.openai,
      api: { id: "openai", url: "https://api.openai.com", npm: "@ai-sdk/openai" },
      name: "GPT-5.4",
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: false,
        toolcall: true,
        input: { text: true, audio: false, image: false, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
      limit: { context: 200000, output: 32000 },
      status: "active",
      options: {},
      headers: {},
      release_date: "2026-01-01",
    }

    try {
      service.markModelSwitched({ sessionID: "ses_test", providerID: "openai", modelID: "gpt-5.4" })
      const output = { system: [] as string[] }
      await hooks["experimental.chat.system.transform"]?.(
        {
          sessionID: "ses_test",
          model,
        },
        output,
      )
      expect(output.system.join("\n")).toContain("## Trade Memory Handoff")
      expect(output.system.join("\n")).toContain("ses_test")
    } finally {
      await hooks.dispose?.()
      void server.stop(true)
    }
  })
})
