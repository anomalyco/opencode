import { afterEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import path from "path"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { startTradeMemoryHttpServer } from "../../../../.opencode/mcp/http"
import { createTradeMemoryService } from "../../../../.opencode/mcp/service"
import { createTradeHandoffBridgeHooks, parseServiceCommand, readModelSwitchedEvent } from "../../../../.opencode/plugins/trade-handoff-bridge"
import { tmpdir } from "../fixture/fixture"
import type { Model } from "../../src/provider/provider"

const baseEnv = {
  db: process.env.OPENCODE_DB,
  url: process.env.OPENCODE_TRADE_MEMORY_SERVICE_URL,
  port: process.env.OPENCODE_TRADE_MEMORY_SERVICE_PORT,
  autostart: process.env.OPENCODE_TRADE_MEMORY_SERVICE_AUTOSTART,
  token: process.env.OPENCODE_TRADE_MEMORY_SERVICE_TOKEN,
}

afterEach(() => {
  process.env.OPENCODE_DB = baseEnv.db
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

  test("event -> sync -> handoff -> ack clears pending", async () => {
    await using tmp = await tmpdir()
    const sourceDbPath = path.join(tmp.path, "opencode.db")
    const indexDbPath = path.join(tmp.path, "memory.sqlite3")
    seedSourceDb(sourceDbPath)
    process.env.OPENCODE_DB = sourceDbPath
    process.env.OPENCODE_TRADE_MEMORY_SERVICE_AUTOSTART = "false"
    process.env.OPENCODE_TRADE_MEMORY_SERVICE_TOKEN = "test-token"

    const service = createTradeMemoryService({ indexDbPath, sourceDbPath })
    const server = startTradeMemoryHttpServer({ service, port: 0 })
    process.env.OPENCODE_TRADE_MEMORY_SERVICE_PORT = String(server.port)
    process.env.OPENCODE_TRADE_MEMORY_SERVICE_URL = `http://127.0.0.1:${server.port}`
    const hooks = createTradeHandoffBridgeHooks(tmp.path)

    try {
      await hooks.event?.({
        event: {
          type: "session.next.model.switched",
          properties: { sessionID: "ses_test", model: { id: "gpt-5.4", providerID: "openai" } },
        } as never,
      })
      const output = { system: [] as string[] }
      await hooks["experimental.chat.system.transform"]?.({ sessionID: "ses_test", model: makeModel("gpt-5.4") }, output)

      expect(output.system.join("\n")).toContain("## Trade Memory Handoff")
      expect(output.system.join("\n")).toContain("hello handoff")

      const state = service.buildHandoffContext({ sessionID: "ses_test", modelID: "gpt-5.4" })
      expect(state.pendingSince).toBeNull()
      expect(state.fresh).toBe(true)
    } finally {
      await hooks.dispose?.()
      void server.stop(true)
    }
  })

  test("sync failure keeps pending and warns", async () => {
    await using tmp = await tmpdir()
    const indexDbPath = path.join(tmp.path, "memory.sqlite3")
    process.env.OPENCODE_TRADE_MEMORY_SERVICE_AUTOSTART = "false"
    process.env.OPENCODE_TRADE_MEMORY_SERVICE_TOKEN = "test-token"
    const originalError = console.error
    console.error = () => undefined

    const service = createTradeMemoryService({ indexDbPath, sourceDbPath: path.join(tmp.path, "missing.db") })
    const server = startTradeMemoryHttpServer({ service, port: 0 })
    process.env.OPENCODE_TRADE_MEMORY_SERVICE_PORT = String(server.port)
    process.env.OPENCODE_TRADE_MEMORY_SERVICE_URL = `http://127.0.0.1:${server.port}`
    const hooks = createTradeHandoffBridgeHooks(tmp.path)

    try {
      await hooks.event?.({
        event: {
          type: "session.next.model.switched",
          properties: { sessionID: "ses_test", model: { id: "gpt-5.4", providerID: "openai" } },
        } as never,
      })
      const output = { system: [] as string[] }
      await hooks["experimental.chat.system.transform"]?.({ sessionID: "ses_test", model: makeModel("gpt-5.4") }, output)

      expect(output.system).toContain("trade memory handoff may be stale")

      const state = service.buildHandoffContext({ sessionID: "ses_test", modelID: "gpt-5.4" })
      expect(state.pendingSince).not.toBeNull()
      expect(state.fresh).toBe(false)
    } finally {
      console.error = originalError
      await hooks.dispose?.()
      void server.stop(true)
    }
  })

  test("compaction uses the same freshness path", async () => {
    await using tmp = await tmpdir()
    const sourceDbPath = path.join(tmp.path, "opencode.db")
    const indexDbPath = path.join(tmp.path, "memory.sqlite3")
    seedSourceDb(sourceDbPath)
    process.env.OPENCODE_DB = sourceDbPath
    process.env.OPENCODE_TRADE_MEMORY_SERVICE_AUTOSTART = "false"
    process.env.OPENCODE_TRADE_MEMORY_SERVICE_TOKEN = "test-token"

    const service = createTradeMemoryService({ indexDbPath, sourceDbPath })
    const server = startTradeMemoryHttpServer({ service, port: 0 })
    process.env.OPENCODE_TRADE_MEMORY_SERVICE_PORT = String(server.port)
    process.env.OPENCODE_TRADE_MEMORY_SERVICE_URL = `http://127.0.0.1:${server.port}`
    const hooks = createTradeHandoffBridgeHooks(tmp.path)

    try {
      await hooks.event?.({
        event: {
          type: "session.next.model.switched",
          properties: { sessionID: "ses_test", model: { id: "gpt-5.4", providerID: "openai" } },
        } as never,
      })
      const output = { context: [] as string[] }
      await hooks["experimental.session.compacting"]?.({ sessionID: "ses_test" }, output)

      expect(output.context.join("\n")).toContain("## Trade Memory Handoff")
      expect(service.buildHandoffContext({ sessionID: "ses_test" }).pendingSince).toBeNull()
    } finally {
      await hooks.dispose?.()
      void server.stop(true)
    }
  })

  test("system transform acks fresh DB pending even without local pending state", async () => {
    await using tmp = await tmpdir()
    const sourceDbPath = path.join(tmp.path, "opencode.db")
    const indexDbPath = path.join(tmp.path, "memory.sqlite3")
    seedSourceDb(sourceDbPath)
    process.env.OPENCODE_DB = sourceDbPath
    process.env.OPENCODE_TRADE_MEMORY_SERVICE_AUTOSTART = "false"
    process.env.OPENCODE_TRADE_MEMORY_SERVICE_TOKEN = "test-token"

    const service = createTradeMemoryService({ indexDbPath, sourceDbPath })
    service.markModelSwitched({ sessionID: "ses_test", modelID: "gpt-5.4", pendingSince: 100 })
    service.sync()
    const server = startTradeMemoryHttpServer({ service, port: 0 })
    process.env.OPENCODE_TRADE_MEMORY_SERVICE_PORT = String(server.port)
    process.env.OPENCODE_TRADE_MEMORY_SERVICE_URL = `http://127.0.0.1:${server.port}`
    const hooks = createTradeHandoffBridgeHooks(tmp.path)

    try {
      const output = { system: [] as string[] }
      await hooks["experimental.chat.system.transform"]?.({ sessionID: "ses_test", model: makeModel("gpt-5.4") }, output)
      expect(output.system.join("\n")).toContain("hello handoff")
      expect(service.buildHandoffContext({ sessionID: "ses_test", modelID: "gpt-5.4" }).pendingSince).toBeNull()
    } finally {
      await hooks.dispose?.()
      void server.stop(true)
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

function makeModel(id: string): Model {
  return {
    id: ModelV2.ID.make(id),
    providerID: ProviderV2.ID.openai,
    api: { id: "openai", url: "https://api.openai.com", npm: "@ai-sdk/openai" },
    name: id,
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

function seedSourceDb(file: string) {
  const db = new Database(file)
  try {
    db.exec("create table session_message (id text primary key, session_id text not null, type text not null, seq integer not null, time_created integer not null, data text not null)")
    db.query("insert into session_message (id, session_id, type, seq, time_created, data) values (?, ?, ?, ?, ?, ?)").run(
      "msg-1",
      "ses_test",
      "user",
      1,
      Date.now(),
      JSON.stringify({ type: "user", text: "hello handoff" }),
    )
  } finally {
    db.close(false)
  }
}
