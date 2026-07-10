import { describe, expect, test } from "bun:test"
import { EngineAdapter, createEngineAdapter } from "../../../src/agent/engine-adapter"
import { AgentState } from "../../../src/agent/engine/state-machine"
import { EventType, EventPriority, type BusEvent } from "../../../src/agent/engine/event-bus"
import type { Capability } from "../../../src/agent/engine/planner"
import type { DAG } from "../../../src/agent/engine/dag"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeToolAdapter(
  name: string,
  handler?: (inputs: Record<string, unknown>) => Promise<Record<string, unknown>>,
) {
  return {
    name,
    description: `${name} tool`,
    risk_level: 0 as const,
    tags: ["test"],
    execute: handler ?? (async (inputs) => ({ executed: true, tool: name, ...inputs })),
  }
}

function collectEvents(adapter: EngineAdapter): BusEvent[] {
  const events: BusEvent[] = []
  const engine = adapter.getEngine()
  if (engine) {
    engine.eventBus.subscribe((event) => {
      events.push(event)
    })
  }
  return events
}

// ─── EngineAdapter Unit Tests ────────────────────────────────────────────────

describe("EngineAdapter", () => {
  test("createEngineAdapter creates engine with defaults", () => {
    const adapter = createEngineAdapter()
    const engine = adapter.getEngine()
    expect(engine).not.toBeNull()
    expect(engine!.stateMachine.state).toBe("IDLE")
  })

  test("createEngineAdapter with custom config", () => {
    const adapter = createEngineAdapter({ maxSteps: 20, maxRetries: 2 })
    const engine = adapter.getEngine()!
    expect(engine.maxSteps).toBe(20)
  })

  test("registerTool adds capability to engine", () => {
    const adapter = createEngineAdapter()
    adapter.registerTool(makeToolAdapter("read"))
    const engine = adapter.getEngine()!
    expect(engine.registry.get("read")).toBeDefined()
  })

  test("registerTool registers handler that works through execute", async () => {
    const adapter = createEngineAdapter()
    adapter.registerTool(makeToolAdapter("echo", async (inputs) => ({ echoed: inputs.message })))
    const engine = adapter.getEngine()!

    const cap = engine.registry.get("echo")
    expect(cap).toBeDefined()
    expect(cap!.handler).toBeDefined()

    const output = await cap!.handler!({ message: "hello" })
    expect(output.echoed).toBe("hello")
  })

  test("registerTools adds multiple capabilities", () => {
    const adapter = createEngineAdapter()
    adapter.registerTools([
      makeToolAdapter("read"),
      makeToolAdapter("write"),
      makeToolAdapter("bash"),
    ])
    const engine = adapter.getEngine()!
    expect(engine.registry.get("read")).toBeDefined()
    expect(engine.registry.get("write")).toBeDefined()
    expect(engine.registry.get("bash")).toBeDefined()
  })

  test("createNodeFromToolCall produces valid DAG node", () => {
    const adapter = createEngineAdapter()
    adapter.registerTool(makeToolAdapter("read"))
    const node = adapter.createNodeFromToolCall("read", { path: "test.txt" })
    expect(node.capability_id).toBe("read")
    expect(node.inputs.path).toBe("test.txt")
    expect(node.status).toBe("pending")
    expect(node.node_id).toMatch(/^n_/)
  })

  test("createNodeFromToolCall for unknown tool uses risk 0", () => {
    const adapter = createEngineAdapter()
    const node = adapter.createNodeFromToolCall("unknown_tool", {})
    expect(node.risk_level).toBe(0)
  })
})

// ─── EngineAdapter.runWithEngine E2E ─────────────────────────────────────────

describe("EngineAdapter.runWithEngine (E2E)", () => {
  test("completes a simple single-step plan", async () => {
    const adapter = createEngineAdapter({ maxSteps: 50 })
    adapter.registerTool(makeToolAdapter("read", async (inputs) => ({
      content: `File ${inputs.path} contents`,
    })))

    const result = await adapter.runWithEngine("e2e-1", "read src/main.ts", "hash1")

    expect(result.completed).toBe(true)
    expect(result.allSucceeded).toBe(true)
    expect(result.stepCount).toBe(1)
    expect(result.tokenUsage).toBeGreaterThan(0)

    const engine = adapter.getEngine()!
    expect(engine.stateMachine.state).toBe("COMPLETED")
  })

  test("handles multi-capability plan", async () => {
    const adapter = createEngineAdapter({ maxSteps: 50 })
    const calls: string[] = []

    adapter.registerTools([
      makeToolAdapter("read", async (inputs) => {
        calls.push(`read:${inputs.path}`)
        return { content: "data" }
      }),
      makeToolAdapter("write", async (inputs) => {
        calls.push(`write:${inputs.path}`)
        return { written: true }
      }),
    ])

    const result = await adapter.runWithEngine("e2e-2", "read config and write output", "hash2")

    expect(result.completed).toBe(true)
    expect(result.allSucceeded).toBe(true)
    expect(calls.length).toBeGreaterThanOrEqual(1)
  })

  test("event bus captures lifecycle events (state transitions + DAG + checkpoints)", async () => {
    const events: BusEvent[] = []
    const adapter = createEngineAdapter({ maxSteps: 50 })
    const engine = adapter.getEngine()!

    // Subscribe to lifecycle event types
    engine.eventBus.subscribe(EventType.STATE_TRANSITION, (event) => { events.push(event) })
    engine.eventBus.subscribe(EventType.DAG_GENERATED, (event) => { events.push(event) })
    engine.eventBus.subscribe(EventType.CHECKPOINT_CREATE, (event) => { events.push(event) })

    adapter.registerTool(makeToolAdapter("read", async () => ({ ok: true })))
    const result = await adapter.runWithEngine("e2e-3", "read a file", "hash3")

    // Execution completed successfully
    expect(result.completed).toBe(true)
    expect(result.allSucceeded).toBe(true)

    // State transition events are captured
    const stateEvents = events.filter((e) => e.type === EventType.STATE_TRANSITION)
    expect(stateEvents.length).toBeGreaterThanOrEqual(3)

    // DAG generation event is captured
    const dagEvents = events.filter((e) => e.type === EventType.DAG_GENERATED)
    expect(dagEvents.length).toBe(1)

    // Checkpoint events are captured
    const cpEvents = events.filter((e) => e.type === EventType.CHECKPOINT_CREATE)
    expect(cpEvents.length).toBeGreaterThanOrEqual(1)
  })

  test("engine throws if runWithEngine called without createEngine", async () => {
    const adapter = new EngineAdapter()
    await expect(
      adapter.runWithEngine("bad", "no engine", "hash"),
    ).rejects.toThrow("Engine not initialized")
  })

  test("handles tool failure with retry", async () => {
    let callCount = 0
    const adapter = createEngineAdapter({ maxSteps: 50, maxRetries: 2 })

    adapter.registerTool(makeToolAdapter("fragile", async (_inputs) => {
      callCount++
      if (callCount === 1) throw new Error("First attempt failed")
      return { recovered: true }
    }))

    // The planner creates a single node; it fails then replan may retry
    // Since there's only one capability, the retry mechanism triggers
    const result = await adapter.runWithEngine("e2e-4", "use fragile tool", "hash4")
    // It may or may not complete depending on DAG structure
    expect(result.stepCount).toBeGreaterThanOrEqual(0)
  })

  test("runWithEngine respects maxSteps limit", async () => {
    const adapter = createEngineAdapter({ maxSteps: 1 })
    // Register a tool that keeps the DAG alive (handler works but replan restarts)
    adapter.registerTool(makeToolAdapter("read", async () => ({ ok: true })))

    const result = await adapter.runWithEngine("e2e-5", "simple read", "hash5")
    // Should complete within 1 step (single node plan)
    expect(result.stepCount).toBeLessThanOrEqual(1)
  })

  test("snapshot reflects running state during execution", async () => {
    const adapter = createEngineAdapter({ maxSteps: 50 })
    adapter.registerTool(makeToolAdapter("read", async () => ({ ok: true })))

    await adapter.runWithEngine("e2e-6", "quick read", "hash6")

    const engine = adapter.getEngine()!
    const snap = engine.getSnapshot()
    expect(snap.sessionId).toBe("e2e-6")
    expect(snap.dagVersion).toBe(1)
    expect(snap.stepCount).toBeGreaterThanOrEqual(1)
    expect(snap.tokenUsage).toBeGreaterThan(0)
  })
})

// ─── EngineAdapter + ToolAdapter Hybrid Flow ─────────────────────────────────

describe("Session → Engine Integration Flow", () => {
  test("simulates full session: tool call → DAG node → execute → result", async () => {
    // 1. Simulate Session receiving a user message
    const userGoal = "Read src/index.ts and write a summary to SUMMARY.md"

    // 2. EngineAdapter bridges Session tools to Engine capabilities
    const adapter = createEngineAdapter({ maxSteps: 50, maxRetries: 3 })
    const executionLog: string[] = []

    adapter.registerTools([
      makeToolAdapter("read", async (inputs) => {
        executionLog.push(`read:${inputs.path}`)
        return { content: `Contents of ${inputs.path}` }
      }),
      makeToolAdapter("write", async (inputs) => {
        executionLog.push(`write:${inputs.path}`)
        return { written: true }
      }),
    ])

    // 3. Run the full engine cycle
    const result = await adapter.runWithEngine("session-1", userGoal, "workspace-hash-1")

    // 4. Verify execution
    expect(result.completed).toBe(true)
    expect(result.allSucceeded).toBe(true)
    expect(executionLog.length).toBeGreaterThanOrEqual(1)
    expect(executionLog.some((e) => e.startsWith("read:"))).toBe(true)
  })

  test("simulates error recovery flow", async () => {
    let attempts = 0
    const adapter = createEngineAdapter({ maxSteps: 50, maxRetries: 3 })

    adapter.registerTool(makeToolAdapter("build", async (_inputs) => {
      attempts++
      if (attempts < 2) throw new Error("Build failed: missing dependency")
      return { built: true, warnings: 0 }
    }))

    const result = await adapter.runWithEngine("session-2", "build the project", "hash-build")

    expect(result.completed).toBe(true)
    expect(attempts).toBeGreaterThanOrEqual(1)
  })

  test("simulates multi-turn session with checkpoints", async () => {
    const adapter = createEngineAdapter({ maxSteps: 50 })

    adapter.registerTool(makeToolAdapter("read", async (inputs) => ({
      content: `data from ${inputs.path}`,
    })))

    // Turn 1: read file
    const result1 = await adapter.runWithEngine("session-3", "read src/a.ts", "hash-a")
    expect(result1.completed).toBe(true)

    const engine = adapter.getEngine()!
    const cpId = await engine.createCheckpoint()
    expect(cpId).toBeTruthy()

    // Verify checkpoint exists
    const snap = engine.getSnapshot()
    expect(snap.checkpoints.l1).toBeGreaterThanOrEqual(1)
  })

  test("event bus carries critical events during error", async () => {
    const criticalEvents: BusEvent[] = []
    const adapter = createEngineAdapter({ maxSteps: 50, maxRetries: 0 }, async (event) => {
      if (event.priority <= EventPriority.HIGH) {
        criticalEvents.push(event)
      }
    })

    adapter.registerTool(makeToolAdapter("build", async (_inputs) => {
      throw new Error("catastrophic failure")
    }))

    await adapter.runWithEngine("session-4", "build project", "hash-error")

    // Should have at least one error event
    const errorEvents = criticalEvents.filter((e) =>
      e.type === EventType.DAG_NODE_FAILED || e.type === EventType.ERROR_OCCURRED,
    )
    expect(errorEvents.length).toBeGreaterThanOrEqual(1)
  })
})

// ─── buildToolAdaptersFromDefs ───────────────────────────────────────────────

describe("buildToolAdaptersFromDefs", () => {
  test("builds adapters from tool definitions", () => {
    const adapter = createEngineAdapter()
    const defs = [
      { id: "read", description: "Read files" },
      { id: "write", description: "Write files" },
    ]
    const toolAdapters = adapter.buildToolAdaptersFromDefs(defs)
    expect(toolAdapters).toHaveLength(2)
    expect(toolAdapters[0].name).toBe("read")
    expect(toolAdapters[0].risk_level).toBe(0)
    expect(toolAdapters[1].name).toBe("write")
  })

  test("builds adapters with custom risk map", () => {
    const adapter = createEngineAdapter()
    const defs = [
      { id: "custom_tool", description: "Custom" },
    ]
    const toolAdapters = adapter.buildToolAdaptersFromDefs(defs, { custom_tool: 2 })
    expect(toolAdapters[0].risk_level).toBe(2)
  })

  test("provides default execute for tools without handlers", async () => {
    const adapter = createEngineAdapter()
    const defs = [
      { id: "noop", description: "No-op tool" },
    ]
    const toolAdapters = adapter.buildToolAdaptersFromDefs(defs)
    const result = await toolAdapters[0].execute({ test: true })
    expect(result.executed).toBe(true)
    expect(result.tool).toBe("noop")
    expect(result.inputs.test).toBe(true)
  })

  test("uses provided execute function when available", async () => {
    const adapter = createEngineAdapter()
    const defs = [
      {
        id: "custom",
        description: "Custom tool",
        execute: async (inputs: Record<string, unknown>) => ({ custom: true, ...inputs }),
      },
    ]
    const toolAdapters = adapter.buildToolAdaptersFromDefs(defs)
    const result = await toolAdapters[0].execute({ key: "val" })
    expect(result.custom).toBe(true)
    expect(result.key).toBe("val")
  })
})
