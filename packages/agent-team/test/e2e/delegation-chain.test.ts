import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { Orchestrator } from "../../src/orchestrator/index.js"
import { generateIdempotencyKey } from "../../src/protocol/schema.js"
import { tmpdir, cleanup } from "../fixture/workspace.js"

describe("E2E: delegation chain", () => {
  let dir: string
  let orch: Orchestrator

  beforeEach(async () => {
    dir = await tmpdir()
    orch = new Orchestrator(dir, { maxDepth: 3, maxConcurrent: 5 })
    await orch.start()
    await orch.spawn({
      agent_id: "architect",
      role: "architect",
      capabilities: { delegate: true, max_delegation_depth: 3 },
    })
    await orch.spawn({ agent_id: "coder", role: "coder", capabilities: { delegate: true, max_delegation_depth: 2 } })
    await orch.spawn({
      agent_id: "reviewer",
      role: "reviewer",
      capabilities: { delegate: false, max_delegation_depth: 0 },
    })
  })

  afterEach(async () => {
    orch.stop()
    await cleanup(dir)
  })

  test("architect delegates to coder, coder delegates sub-task to reviewer", async () => {
    const env = {
      id: crypto.randomUUID(),
      type: "delegate" as const,
      from: "architect",
      to: "coder",
      timestamp: Date.now(),
      hop_count: 0,
      idempotency_key: crypto.randomUUID(),
      priority: "high" as const,
      protocol_version: 1,
      payload: {
        task: { task_id: "t1", title: "Build feature", description: "Build X", priority: "high" },
        max_depth: 3,
        return_to: "architect",
      },
    }
    const r1 = orch.router.route(env)
    expect(r1.ok).toBe(true)

    const subEnv = {
      id: crypto.randomUUID(),
      type: "delegate" as const,
      from: "coder",
      to: "reviewer",
      timestamp: Date.now(),
      hop_count: 1,
      idempotency_key: crypto.randomUUID(),
      priority: "normal" as const,
      protocol_version: 1,
      payload: {
        task: { task_id: "t1-sub", title: "Review code", description: "Review X", priority: "normal" },
        max_depth: 2,
        return_to: "coder",
      },
    }
    const r2 = orch.router.route(subEnv)
    expect(r2.ok).toBe(true)
    expect(orch.router.getInboxSize("reviewer")).toBe(1)
  })

  test("depth limit enforcement: A→B→C→D rejected at depth 3", async () => {
    await orch.spawn({ agent_id: "d", role: "tester", capabilities: {} })
    const env = {
      id: crypto.randomUUID(),
      type: "delegate" as const,
      from: "architect",
      to: "coder",
      timestamp: Date.now(),
      hop_count: 11,
      idempotency_key: crypto.randomUUID(),
      priority: "normal" as const,
      protocol_version: 1,
      payload: {
        task: { task_id: "t-deep", title: "Deep", description: "Too deep", priority: "normal" },
        max_depth: 3,
        return_to: "architect",
      },
    }
    const result = orch.router.route(env)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("hop")
  })

  test("circular delegation prevention: A→B→A rejected", () => {
    const env = {
      id: crypto.randomUUID(),
      type: "message" as const,
      from: "architect",
      to: "architect",
      timestamp: Date.now(),
      hop_count: 0,
      idempotency_key: crypto.randomUUID(),
      priority: "normal" as const,
      protocol_version: 1,
      payload: { content: "self message" },
    }
    const result = orch.router.route(env)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("yourself")
  })

  test("delegation chain result propagation", () => {
    const env = {
      id: crypto.randomUUID(),
      type: "delegate.result" as const,
      from: "reviewer",
      to: "coder",
      timestamp: Date.now(),
      hop_count: 1,
      idempotency_key: crypto.randomUUID(),
      priority: "normal" as const,
      protocol_version: 1,
      payload: {
        task_id: "t1-sub",
        status: "completed" as const,
        summary: "Code looks good",
      },
    }
    const result = orch.router.route(env)
    expect(result.ok).toBe(true)
    expect(orch.router.getInboxSize("coder")).toBe(1)
  })
})
