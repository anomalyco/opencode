import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { createTradeMemoryService } from "../../../../.opencode/mcp/service"
import { startTradeMemoryHttpServer } from "../../../../.opencode/mcp/http"
import { createTradeHandoffBridgeHooks, parseServiceCommand, readModelSwitchedEvent } from "../../../../.opencode/plugins/trade-handoff-bridge"
import { tmpdir } from "../fixture/fixture"
import type { Model } from "../../src/provider/provider"

const baseEnv = {
  url: process.env.OPENCODE_TRADE_MEMORY_SERVICE_URL,
  port: process.env.OPENCODE_TRADE_MEMORY_SERVICE_PORT,
  autostart: process.env.OPENCODE_TRADE_MEMORY_SERVICE_AUTOSTART,
  token: process.env.OPENCODE_TRADE_MEMORY_SERVICE_TOKEN,
}

afterEach(() => {
  process.env.OPENCODE_TRADE_MEMORY_SERVICE_URL = baseEnv.url
  process.env.OPENCODE_TRADE_MEMORY_SERVICE_PORT = baseEnv.port
  process.env.OPENCODE_TRADE_MEMORY_SERVICE_AUTOSTART = baseEnv.autostart
  process.env.OPENCODE_TRADE_MEMORY_SERVICE_TOKEN = baseEnv.token
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

  test("readModelSwitchedEvent matches current event schema", () => {
    expect(
      readModelSwitchedEvent({
        type: "session.next.model.switched",
        properties: {
          sessionID: "ses_test",
          model: { id: "gpt-5.5", providerID: "openai" },
        },
      }),
    ).toEqual({ sessionID: "ses_test", model: { id: "gpt-5.5", providerID: "openai" } })
  })

  test("system transform injects handoff block from service", async () => {
    await using tmp = await tmpdir()
    const indexDbPath = path.join(tmp.path, "memory.sqlite3")
    process.env.OPENCODE_TRADE_MEMORY_SERVICE_AUTOSTART = "false"
    process.env.OPENCODE_TRADE_MEMORY_SERVICE_TOKEN = "test-token"

    const service = createTradeMemoryService({ indexDbPath })
    const server = startTradeMemoryHttpServer({ service, port: 0 })
    process.env.OPENCODE_TRADE_MEMORY_SERVICE_PORT = String(server.port)
    process.env.OPENCODE_TRADE_MEMORY_SERVICE_URL = `http://127.0.0.1:${server.port}`
    const hooks = createTradeHandoffBridgeHooks(tmp.path)
    const model = makeModel()

    try {
      service.markModelSwitched({ sessionID: "ses_test", providerID: "openai", modelID: "gpt-5.4" })
      const output = { system: [] as string[] }
      await hooks["experimental.chat.system.transform"]?.({ sessionID: "ses_test", model }, output)
      expect(output.system.join("\n")).toContain("## Trade Memory Handoff")
      expect(output.system.join("\n")).toContain("ses_test")
    } finally {
      await hooks.dispose?.()
      void server.stop(true)
    }
  })

  test("system transform injects warning when service is unavailable", async () => {
    await using tmp = await tmpdir()
    process.env.OPENCODE_TRADE_MEMORY_SERVICE_URL = "http://127.0.0.1:1"
    process.env.OPENCODE_TRADE_MEMORY_SERVICE_PORT = "1"
    process.env.OPENCODE_TRADE_MEMORY_SERVICE_AUTOSTART = "false"

    const hooks = createTradeHandoffBridgeHooks(tmp.path)
    const output = { system: [] as string[] }

    try {
      await hooks["experimental.chat.system.transform"]?.({ sessionID: "ses_test", model: makeModel() }, output)
      expect(output.system).toContain("trade memory handoff unavailable")
    } finally {
      await hooks.dispose?.()
    }
  })

  test("autostart attempts to spawn local service when enabled", async () => {
    await using tmp = await tmpdir()
    process.env.OPENCODE_TRADE_MEMORY_SERVICE_URL = "http://127.0.0.1:1"
    process.env.OPENCODE_TRADE_MEMORY_SERVICE_PORT = "1"
    process.env.OPENCODE_TRADE_MEMORY_SERVICE_AUTOSTART = "true"

    let started = 0
    const hooks = createTradeHandoffBridgeHooks(tmp.path, {
      startService: () => {
        started += 1
        return {
          kill() {},
          exited: Promise.resolve(0),
          exitCode: 0,
        }
      },
    })
    const output = { context: [] as string[] }

    try {
      await hooks["experimental.session.compacting"]?.({ sessionID: "ses_test" }, output)
      expect(started).toBe(1)
      expect(output.context).toContain("trade memory handoff unavailable")
    } finally {
      await hooks.dispose?.()
    }
  })
})

function makeModel(): Model {
  return {
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
}
