import { describe, test, expect } from "bun:test"
import serverPlugin from "../src/server.js"
import tuiPlugin from "../src/tui.js"
import { Orchestrator } from "../src/orchestrator/index.js"
import type { MessageEnvelope, MessageType, AgentInfo } from "../src/protocol/messages.js"
import { parseTeamConfig, TeamConfigSchema } from "../src/config.js"

describe("Package exports", () => {
  test("server entry has correct shape", () => {
    expect(serverPlugin.id).toBe("agent-team")
    expect(typeof serverPlugin.server).toBe("function")
  })

  test("tui entry has correct shape", () => {
    expect(tuiPlugin.id).toBe("agent-team")
    expect(typeof tuiPlugin.tui).toBe("function")
  })

  test("Orchestrator class is exported", () => {
    expect(typeof Orchestrator).toBe("function")
    expect(Orchestrator.prototype.start).toBeDefined()
    expect(Orchestrator.prototype.stop).toBeDefined()
    expect(Orchestrator.prototype.spawn).toBeDefined()
    expect(Orchestrator.prototype.list).toBeDefined()
    expect(Orchestrator.prototype.getInfo).toBeDefined()
  })

  test("protocol types are available", () => {
    const envelope: MessageEnvelope = {
      id: "test",
      type: "message" as MessageType,
      from: "a",
      to: "b",
      timestamp: Date.now(),
      hop_count: 0,
      idempotency_key: "key",
      priority: "normal",
      protocol_version: 1,
      payload: {},
    }
    expect(envelope.type).toBe("message")
  })

  test("config module is exported", () => {
    const cfg = parseTeamConfig({ enabled: true })
    expect(cfg.enabled).toBe(true)
    expect(typeof TeamConfigSchema).toBe("object")
  })
})
