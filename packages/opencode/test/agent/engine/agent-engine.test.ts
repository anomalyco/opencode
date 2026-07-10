import { describe, test, expect, beforeEach } from "bun:test"
import { AgentEngine, type EngineConfig } from "../../../src/agent/engine/agent-engine"
import { AgentState } from "../../../src/agent/engine/state-machine"
import { type Capability, ExecutionStrategy } from "../../../src/agent/engine/planner"
import type { DAG, DAGNode } from "../../../src/agent/engine/dag"

// ─── Test Helpers ──────────────────────────────────────────────────────────

function makeCapability(id: string, opts?: Partial<Capability>): Capability {
  return {
    capability_id: id,
    name: id,
    description: `Test capability: ${id}`,
    input_schema: { inputs: "object" },
    output_schema: { result: "object" },
    tags: ["test"],
    risk_level: 0,
    total_calls: 0,
    success_rate: 1.0,
    avg_duration_ms: 10,
    avg_token_cost: 100,
    handler: async (inputs) => ({ result: `ok:${id}`, inputs }),
    ...opts,
  }
}

function makeDAG(nodes: DAGNode[], edges: [string, string][] = []): DAG {
  return { version: 1, nodes, edges, metadata: { goal: "test", strategy: "SINGLE_SHOT", replan_count: 0, created_at: Date.now() } }
}

function makeNode(id: string, capId: string, deps: string[] = [], risk = 0): DAGNode {
  return {
    node_id: id,
    capability_id: capId,
    inputs: {},
    dependencies: deps,
    risk_level: risk,
    estimated_tokens: 100,
    estimated_duration_ms: 500,
    status: "pending",
  }
}

function createTestEngine(config?: Partial<EngineConfig>): AgentEngine {
  return new AgentEngine({
    maxSteps: 50,
    maxRetries: 2,
    tokenBudget: 100_000,
    validationThreshold: 0.5,
    ...config,
  })
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("AgentEngine", () => {
  let engine: AgentEngine

  beforeEach(() => {
    engine = createTestEngine()
  })

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  describe("lifecycle", () => {
    test("initialize transitions IDLE → INITIALIZING → READY", async () => {
      expect(engine.stateMachine.state).toBe(AgentState.IDLE)
      await engine.initialize("session-1", "Build a feature")
      expect(engine.stateMachine.state).toBe(AgentState.READY)
    })

    test("shutdown creates checkpoint and transitions to SHUTTING_DOWN", async () => {
      await engine.initialize("session-1", "test goal")
      await engine.shutdown()
      expect(engine.stateMachine.state).toBe(AgentState.SHUTTING_DOWN)
    })

    test("pause transitions to PAUSED", async () => {
      await engine.initialize("session-1", "test")
      await engine.pause()
      expect(engine.stateMachine.state).toBe(AgentState.PAUSED)
    })

    test("getSnapshot returns engine state summary", async () => {
      await engine.initialize("session-1", "test")
      const snap = engine.getSnapshot()
      expect(snap.sessionId).toBe("session-1")
      expect(snap.state).toBe(AgentState.READY)
      expect(snap.stepCount).toBe(0)
      expect(snap.tokenUsage).toBe(0)
      expect(snap.currentDAG).toBeNull()
    })
  })

  // ─── Planning ──────────────────────────────────────────────────────────────

  describe("plan", () => {
    test("plan generates a DAG from registered capabilities", async () => {
      await engine.initialize("s1", "test")
      engine.registry.register(makeCapability("read"))
      engine.registry.register(makeCapability("write", { risk_level: 1 }))

      const caps = engine.registry.getAll()
      const { dag, strategy } = await engine.plan("Read then write a file", caps)

      expect(dag).toBeDefined()
      expect(dag.nodes.length).toBeGreaterThan(0)
      expect(strategy).toBeDefined()
      expect(engine.stateMachine.state).toBe(AgentState.THINKING)
      expect(engine.getDAG()).toBe(dag)
    })

    test("plan throws when DAG validation fails (cycle)", async () => {
      await engine.initialize("s1", "test")
      const cap = makeCapability("loop")
      engine.registry.register(cap)

      // Force a cycle by overriding dagGenerator
      engine.dagGenerator = {
        generateDAG: async () => ({
          version: 1,
          nodes: [makeNode("a", "loop"), makeNode("b", "loop")],
          edges: [["a", "b"], ["b", "a"]], // cycle
          metadata: { goal: "test", strategy: "test", replan_count: 0, created_at: Date.now() },
        }),
        generateReplanDAG: async () => ({ version: 2, nodes: [], edges: [], metadata: { goal: "", strategy: "", replan_count: 0, created_at: Date.now() } }),
      } as any

      await expect(engine.plan("cycle test", [cap])).rejects.toThrow("DAG validation failed")
    })
  })

  // ─── Execution ─────────────────────────────────────────────────────────────

  describe("executeStep", () => {
    test("executes a single-node DAG to completion", async () => {
      await engine.initialize("s1", "test")

      const cap = makeCapability("read", {
        handler: async () => ({ content: "hello" }),
      })
      engine.registry.register(cap)

      // Manually set a simple DAG
      const dag = makeDAG([makeNode("n1", "read")])
      ;(engine as any).currentDAG = dag

      const result = await engine.executeStep()
      expect(result.completed).toBe(true)
      expect(result.allSucceeded).toBe(true)

      const node = dag.nodes[0]
      expect(node.status).toBe("completed")
      expect(node.output).toEqual({ content: "hello" })
    })

    test("executes multi-node DAG respecting dependencies", async () => {
      await engine.initialize("s1", "test")

      const readCap = makeCapability("read", {
        handler: async () => ({ data: "content" }),
      })
      const writeCap = makeCapability("write", {
        risk_level: 1,
        handler: async (inputs) => ({ written: true }),
      })
      engine.registry.register(readCap)
      engine.registry.register(writeCap)

      const n1 = makeNode("n1", "read")
      const n2 = makeNode("n2", "write", ["n1"])
      const dag = makeDAG([n1, n2], [["n1", "n2"]])
      ;(engine as any).currentDAG = dag

      // Step 1: only n1 should execute (n2 depends on n1)
      const step1 = await engine.executeStep()
      expect(step1.completed).toBe(false)
      expect(n1.status).toBe("completed")
      expect(n2.status).toBe("pending")

      // Step 2: n2 should now execute
      const step2 = await engine.executeStep()
      expect(step2.completed).toBe(true)
      expect(step2.allSucceeded).toBe(true)
      expect(n2.status).toBe("completed")
    })

    test("throws when no DAG is loaded", async () => {
      await engine.initialize("s1", "test")
      await expect(engine.executeStep()).rejects.toThrow("No DAG to execute")
    })

    test("reports failure when all nodes fail", async () => {
      await engine.initialize("s1", "test")
      const cap = makeCapability("fail_cap", {
        handler: async () => { throw new Error("boom") },
      })
      engine.registry.register(cap)

      const dag = makeDAG([makeNode("n1", "fail_cap")])
      ;(engine as any).currentDAG = dag

      const result = await engine.executeStep()
      expect(result.completed).toBe(true)
      expect(result.allSucceeded).toBe(false)
      expect(dag.nodes[0].status).toBe("failed")
    })
  })

  // ─── Checkpoints ───────────────────────────────────────────────────────────

  describe("checkpoints", () => {
    test("createCheckpoint creates L1 checkpoint from current DAG state", async () => {
      await engine.initialize("s1", "test")
      const dag = makeDAG([makeNode("n1", "read"), makeNode("n2", "write")])
      ;(engine as any).currentDAG = dag

      const cpId = await engine.createCheckpoint()
      expect(cpId).toContain("L1")

      const cp = engine.checkpoints.getLatest("L1")
      expect(cp).not.toBeNull()
      expect(cp!.level).toBe("L1")
      expect(cp!.session_id).toBe("s1")
    })

    test("createL2Checkpoint includes context summary", async () => {
      await engine.initialize("s1", "test")
      const dag = makeDAG([makeNode("n1", "read")])
      ;(engine as any).currentDAG = dag

      const contextSummary = {
        system_prompt_ref: "ref-1",
        key_conclusions: [{ text: "conclusion", confidence: 0.9 }],
        recent_messages: [],
        file_contexts: [],
      }

      const cpId = await engine.createL2Checkpoint(contextSummary, "abc123")
      expect(cpId).toContain("L2")
      const cp = engine.checkpoints.getLatest("L2")
      expect(cp!.git_head_hash).toBe("abc123")
    })

    test("resume restores state machine from checkpoint", async () => {
      await engine.initialize("s1", "test")
      const dag = makeDAG([makeNode("n1", "read")])
      ;(engine as any).currentDAG = dag
      dag.nodes[0].status = "completed"

      await engine.createCheckpoint()
      const snap = await engine.resume()

      expect(snap).not.toBeNull()
      expect(snap!.state).toBe(AgentState.READY)
    })

    test("resume with workspace hash mismatch pauses engine", async () => {
      await engine.initialize("s1", "test", "hash-1")
      const dag = makeDAG([makeNode("n1", "read")])
      ;(engine as any).currentDAG = dag

      await engine.createCheckpoint()
      const snap = await engine.resume(undefined, "different-hash")

      expect(snap!.state).toBe(AgentState.PAUSED)
    })

    test("rollbackToCheckpoint transitions through RECOVERING", async () => {
      await engine.initialize("s1", "test")
      const dag = makeDAG([makeNode("n1", "read")])
      ;(engine as any).currentDAG = dag

      const cpId = await engine.createCheckpoint()
      await engine.rollbackToCheckpoint(cpId)

      expect(engine.stateMachine.state).toBe(AgentState.READY)
    })
  })

  // ─── State Machine ─────────────────────────────────────────────────────────

  describe("state machine", () => {
    test("tracks transition count", async () => {
      await engine.initialize("s1", "test")
      // IDLE → INITIALIZING → READY = 2 transitions
      expect(engine.stateMachine.transitions).toBe(2)
    })

    test("invalid state transitions throw StateTransitionError", async () => {
      // Engine starts at IDLE, can't go directly to EXECUTING
      await expect(
        engine.stateMachine.transition(AgentState.EXECUTING),
      ).rejects.toThrow("Invalid state transition")
    })

    test("metrics track time spent in each state", async () => {
      await engine.initialize("s1", "test")
      const metrics = engine.stateMachine.getStateMetrics()
      expect(metrics[AgentState.INITIALIZING].enter_count).toBe(1)
      expect(metrics[AgentState.INITIALIZING].total_time_ms).toBeGreaterThanOrEqual(0)
    })
  })

  // ─── Node Failure & Replan ─────────────────────────────────────────────────

  describe("failure and replan", () => {
    test("handleNodeFailure triggers replan when node fails", async () => {
      const failCap = makeCapability("flaky", {
        handler: async () => { throw new Error("network error") },
      })
      const readCap = makeCapability("read", {
        handler: async () => ({ data: "ok" }),
      })
      engine.registry.register(failCap)
      engine.registry.register(readCap)

      await engine.initialize("s1", "test")

      // DAG: n1(flaky) → n2(read), no deps between them so both are ready initially
      // But n1 will fail
      const n1 = makeNode("n1", "flaky")
      const n2 = makeNode("n2", "read", ["n1"]) // n2 depends on n1
      const dag = makeDAG([n1, n2], [["n1", "n2"]])
      ;(engine as any).currentDAG = dag

      // executeStep runs n1, which fails → n2 becomes blocked
      const result = await engine.executeStep()
      expect(n1.status).toBe("failed")
      expect(n2.status).toBe("blocked")
    })

    test("consecutive failures trigger entropy evaluation", async () => {
      engine = createTestEngine({ maxRetries: 1 })
      const failCap = makeCapability("always_fail", {
        handler: async () => { throw new Error("fail") },
      })
      engine.registry.register(failCap)

      await engine.initialize("s1", "test")
      const dag = makeDAG([makeNode("n1", "always_fail")])
      ;(engine as any).currentDAG = dag

      await engine.executeStep()
      // After failure + replan limit hit, state should transition to ERROR
      // The engine's replanCount (1) >= maxRetries (1)
      expect(engine.stateMachine.state === AgentState.ERROR || engine.stateMachine.state === AgentState.VERIFYING).toBe(true)
    })
  })

  // ─── Parallel Execution ────────────────────────────────────────────────────

  describe("parallel execution", () => {
    test("executes multiple ready nodes in parallel", async () => {
      const order: string[] = []
      const cap1 = makeCapability("cap1", {
        handler: async () => { order.push("cap1"); return { result: 1 } },
      })
      const cap2 = makeCapability("cap2", {
        handler: async () => { order.push("cap2"); return { result: 2 } },
      })
      engine.registry.register(cap1)
      engine.registry.register(cap2)

      await engine.initialize("s1", "test")

      // Two independent nodes (no edges = both ready)
      const n1 = makeNode("n1", "cap1")
      const n2 = makeNode("n2", "cap2")
      const dag = makeDAG([n1, n2])
      ;(engine as any).currentDAG = dag

      const result = await engine.executeStep()
      expect(result.completed).toBe(true)
      expect(result.allSucceeded).toBe(true)
      expect(n1.status).toBe("completed")
      expect(n2.status).toBe("completed")
      expect(order).toContain("cap1")
      expect(order).toContain("cap2")
    })
  })

  // ─── Full Integration Flow ─────────────────────────────────────────────────

  describe("full integration flow", () => {
    test("initialize → plan → execute → complete", async () => {
      const readCap = makeCapability("read", {
        handler: async () => ({ content: "file content" }),
      })
      engine.registry.register(readCap)

      await engine.initialize("session-full", "Read a file")
      expect(engine.stateMachine.state).toBe(AgentState.READY)

      const caps = engine.registry.getAll()
      const { dag } = await engine.plan("Read a file", caps)
      expect(engine.stateMachine.state).toBe(AgentState.THINKING)

      // Force a simple single-node DAG for deterministic test
      ;(engine as any).currentDAG = makeDAG([makeNode("n1", "read")])

      const result = await engine.executeStep()
      expect(result.completed).toBe(true)
      expect(result.allSucceeded).toBe(true)
      expect(engine.stateMachine.state).toBe(AgentState.COMPLETED)

      const snap = engine.getSnapshot()
      expect(snap.stepCount).toBe(1)
      expect(snap.tokenUsage).toBeGreaterThan(0)
    })

    test("fork creates a branch from current session", async () => {
      await engine.initialize("s1", "test")
      const branch = await engine.fork("feature-branch")
      expect(branch).toBeDefined()
      expect(branch.branch_name).toBe("feature-branch")
    })
  })
})
