import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { Registry } from "../../src/orchestrator/registry.js"
import { Router } from "../../src/orchestrator/router.js"
import { tmpdir, cleanup } from "../fixture/workspace.js"

const defaultCaps = {
  tools: ["read"],
  read: true,
  write_own_workspace: true,
  share_to_team: false,
  delegate: true,
  spawn_subagents: false,
  max_delegation_depth: 2,
  disk_quota_mb: 500,
  protected_paths: [],
}

function makeEnvelope(from: string, to: string, payload?: any) {
  return {
    id: crypto.randomUUID(),
    type: "message" as const,
    from,
    to,
    timestamp: Date.now(),
    hop_count: 0,
    idempotency_key: crypto.randomUUID(),
    priority: "normal" as const,
    protocol_version: 1,
    payload: payload ?? { content: "hello" },
  }
}

describe("Router", () => {
  let dir: string
  let registry: Registry
  let router: Router

  beforeEach(async () => {
    dir = await tmpdir()
    registry = new Registry()
    registry.register({ id: "coder", role: "coder", capabilities: defaultCaps, workspace_path: "/ws/coder" })
    registry.register({ id: "reviewer", role: "reviewer", capabilities: defaultCaps, workspace_path: "/ws/reviewer" })
    registry.register({ id: "human", role: "human", capabilities: defaultCaps, workspace_path: "/ws/human" })
    router = new Router(registry, dir)
    await router.init()
  })

  afterEach(async () => {
    await cleanup(dir)
  })

  test("routes message to specific agent", () => {
    const result = router.route(makeEnvelope("coder", "reviewer"))
    expect(result.ok).toBe(true)
  })

  test("broadcast sends to all except sender", () => {
    const result = router.broadcast(makeEnvelope("coder", "broadcast"))
    expect(result.ok).toBe(true)
    expect(router.getInboxSize("reviewer")).toBe(1)
    expect(router.getInboxSize("human")).toBe(1)
    expect(router.getInboxSize("coder")).toBe(0)
  })

  test("unknown agent → dead-letter", () => {
    const result = router.route(makeEnvelope("coder", "unknown-agent"))
    expect(result.ok).toBe(false)
    expect(router.getDeadLetters().length).toBeGreaterThanOrEqual(1)
  })

  test("dead agent → dead-letter", () => {
    registry.updateStatus("reviewer", "dead")
    const result = router.route(makeEnvelope("coder", "reviewer"))
    expect(result.ok).toBe(false)
  })

  test("self-delegation rejected", () => {
    const result = router.route(makeEnvelope("coder", "coder"))
    expect(result.ok).toBe(false)
    expect(result.ok ? "" : result.error).toContain("yourself")
  })

  test("duplicate idempotency key rejected", () => {
    const env = makeEnvelope("coder", "reviewer")
    router.route(env)
    const result = router.route(env)
    expect(result.ok).toBe(false)
  })

  test("FIFO order maintained", () => {
    router.route({ ...makeEnvelope("coder", "reviewer"), payload: { content: "first" } })
    router.route({ ...makeEnvelope("coder", "reviewer"), payload: { content: "second" } })
    expect(router.getInboxSize("reviewer")).toBe(2)
  })

  test("clearInbox removes all messages", () => {
    router.route(makeEnvelope("coder", "reviewer"))
    router.route(makeEnvelope("human", "reviewer"))
    router.clearInbox("reviewer")
    expect(router.getInboxSize("reviewer")).toBe(0)
  })

  test("inbox persists to file", async () => {
    router.route(makeEnvelope("coder", "reviewer"))
    const fs = await import("fs")
    const path = await import("path")
    const content = await fs.promises.readFile(path.join(dir, "inbox", "reviewer.jsonl"), "utf-8")
    expect(content.length).toBeGreaterThan(0)
  })

  test("rate limit enforced", () => {
    for (let i = 0; i < 30; i++) {
      router.route({ ...makeEnvelope("coder", "reviewer"), idempotency_key: `key-${i}` })
    }
    const result = router.route({ ...makeEnvelope("coder", "reviewer"), idempotency_key: "over-limit" })
    expect(result.ok).toBe(false)
  })
})
