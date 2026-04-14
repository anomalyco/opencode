import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { Orchestrator } from "../../src/orchestrator/index.js"
import { generateIdempotencyKey } from "../../src/protocol/schema.js"
import { tmpdir, cleanup } from "../fixture/workspace.js"

let msgCounter = 0
function makeEnvelope(from: string, to: string, payload = {}) {
  return {
    id: crypto.randomUUID(),
    type: "message" as const,
    from,
    to,
    timestamp: Date.now(),
    hop_count: 0,
    idempotency_key: generateIdempotencyKey(`${from}-${to}-${msgCounter++}`, from, "message"),
    priority: "normal" as const,
    protocol_version: 1,
    payload,
  }
}

describe("E2E: message routing", () => {
  let dir: string
  let orch: Orchestrator

  beforeEach(async () => {
    msgCounter = 0
    dir = await tmpdir()
    orch = new Orchestrator(dir)
    await orch.start()
    await orch.spawn({ agent_id: "alice", role: "coder", capabilities: {} })
    await orch.spawn({ agent_id: "bob", role: "reviewer", capabilities: {} })
    await orch.spawn({ agent_id: "carol", role: "tester", capabilities: {} })
  })

  afterEach(async () => {
    orch.stop()
    await cleanup(dir)
  })

  test("agent sends message to another agent", () => {
    const env = makeEnvelope("alice", "bob", { content: "please review" })
    const result = orch.router.route(env)
    expect(result.ok).toBe(true)
    expect(orch.router.getInboxSize("bob")).toBe(1)
  })

  test("agent cannot send to itself", () => {
    const env = makeEnvelope("alice", "alice")
    const result = orch.router.route(env)
    expect(result.ok).toBe(false)
  })

  test("message to dead agent → dead letter", async () => {
    await orch.terminate("carol", "done")
    const env = makeEnvelope("alice", "carol", { content: "hello" })
    const result = orch.router.route(env)
    expect(result.ok).toBe(false)
    const dead = orch.router.getDeadLetters()
    expect(dead.length).toBe(1)
    expect(dead[0].dead_reason).toContain("not found")
  })

  test("message to unknown agent → dead letter", () => {
    const env = makeEnvelope("alice", "nonexistent", { content: "hello" })
    const result = orch.router.route(env)
    expect(result.ok).toBe(false)
    expect(orch.router.getDeadLetters().length).toBe(1)
  })

  test("duplicate message rejected (idempotency)", () => {
    const env = makeEnvelope("alice", "bob")
    expect(orch.router.route(env).ok).toBe(true)
    expect(orch.router.route(env).ok).toBe(false)
  })

  test("broadcast sends to all agents except sender", () => {
    const env = makeEnvelope("alice", "broadcast", { content: "standup in 5" })
    const result = orch.router.broadcast(env)
    expect(result.ok).toBe(true)
    expect(orch.router.getInboxSize("bob")).toBe(1)
    expect(orch.router.getInboxSize("carol")).toBe(1)
    expect(orch.router.getInboxSize("alice")).toBe(0)
  })

  test("drain dequeues from inbox when agent is idle", () => {
    const env = makeEnvelope("alice", "bob", { content: "ping" })
    orch.router.route(env)
    expect(orch.router.getInboxSize("bob")).toBe(1)
    const msg = orch.router.drain("bob")
    expect(msg).toBeTruthy()
    expect(msg?.payload).toEqual({ content: "ping" })
    expect(orch.router.getInboxSize("bob")).toBe(0)
  })

  test("drain returns undefined when agent is busy", () => {
    const env = makeEnvelope("alice", "bob", { content: "ping" })
    orch.router.route(env)
    orch.registry.updateStatus("bob", "busy")
    expect(orch.router.drain("bob")).toBeUndefined()
  })

  test("clearInbox removes all messages", () => {
    orch.router.route(makeEnvelope("alice", "bob"))
    orch.router.route(makeEnvelope("carol", "bob"))
    expect(orch.router.getInboxSize("bob")).toBe(2)
    orch.router.clearInbox("bob")
    expect(orch.router.getInboxSize("bob")).toBe(0)
  })

  test("rate limit enforced after max messages per minute", () => {
    for (let i = 0; i < 30; i++) {
      const env = makeEnvelope("alice", "bob", { i })
      orch.router.route(env)
    }
    const over = makeEnvelope("alice", "bob", { content: "overflow" })
    const result = orch.router.route(over)
    expect(result.ok).toBe(false)
  })

  test("max hop count enforced", () => {
    const env = {
      ...makeEnvelope("alice", "bob"),
      hop_count: 11,
    }
    const result = orch.router.route(env)
    expect(result.ok).toBe(false)
  })

  test("TTL expired message → dead letter", () => {
    const env = {
      ...makeEnvelope("alice", "bob"),
      ttl: -1,
    }
    const result = orch.router.route(env)
    expect(result.ok).toBe(false)
    expect(orch.router.getDeadLetters().length).toBe(1)
  })

  test("dead letter sender gets notified", () => {
    const env = makeEnvelope("alice", "nonexistent")
    orch.router.route(env)
    const senderInbox = orch.router.getInboxSize("alice")
    expect(senderInbox).toBe(1)
  })

  test("multiple messages queue in inbox", () => {
    for (let i = 0; i < 5; i++) {
      orch.router.route(makeEnvelope("alice", "bob", { i }))
    }
    expect(orch.router.getInboxSize("bob")).toBe(5)
  })
})
