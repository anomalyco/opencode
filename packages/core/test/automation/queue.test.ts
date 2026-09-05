import { describe, expect, it } from "bun:test"
import { routeAgent, type QueueConfig, type QueuedJob, type JobHandler } from "@opencode-ai/core/automation/queue"
import { type Classification, type Complexity } from "@opencode-ai/core/automation/classifier"

const config: Pick<QueueConfig, "agentByTaskType" | "highComplexityAgent"> = {
  agentByTaskType: {
    recon: "explore",
    refactor: "general",
    plan: "plan",
    build: "build",
    verify: "general",
  },
  highComplexityAgent: "build",
}

const cls = (complexity: Classification["complexity"], taskType: Classification["taskType"]): Classification =>
  ({ complexity, taskType, reason: "test" })

// ---------------------------------------------------------------------------
// routeAgent (pure, no Effect)
// ---------------------------------------------------------------------------

describe("AutomationQueue.routeAgent", () => {
  it("routes low-complexity recon to the explore agent", () => {
    expect(routeAgent(cls("low", "recon"), config)).toBe("explore")
  })

  it("routes medium refactor to the bulk worker agent", () => {
    expect(routeAgent(cls("medium", "refactor"), config)).toBe("general")
  })

  it("routes planning to the plan agent", () => {
    expect(routeAgent(cls("low", "plan"), config)).toBe("plan")
  })

  it("routes build work to the build agent", () => {
    expect(routeAgent(cls("medium", "build"), config)).toBe("build")
  })

  it("always routes high-complexity jobs to the careful agent regardless of task type", () => {
    expect(routeAgent(cls("high", "refactor"), config)).toBe("build")
    expect(routeAgent(cls("high", "recon"), config)).toBe("build")
    expect(routeAgent(cls("high", "build"), config)).toBe("build")
  })

  it("returns undefined for an unmapped task type, deferring to the session agent", () => {
    expect(routeAgent(cls("low", "verify"), { ...config, agentByTaskType: {} })).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Test helper: lightweight queue that mirrors AutomationQueue internals
// ---------------------------------------------------------------------------

const DEDUP_TTL_MS = 60_000
const PRIORITY_BY_COMPLEXITY: Record<Complexity, number> = { low: 0, medium: 5, high: 10 }

interface TestQueueState {
  pending: QueuedJob[]
  running: Set<string>
  dedupIndex: Map<string, { jobId: string; expiresAt: number }>
}

const makeQueue = () => {
  const state: TestQueueState = {
    pending: [],
    running: new Set(),
    dedupIndex: new Map(),
  }

  let handler: JobHandler | null = null

  const enqueue = (input: {
    sessionID: string
    triggerID: string
    prompt: string
    priority?: number
    deduplicationKey?: string
    complexity?: Complexity
  }) => {
    const now = Date.now()

    if (input.deduplicationKey) {
      const existing = state.dedupIndex.get(input.deduplicationKey)
      if (existing && existing.expiresAt > now) {
        throw new Error(`Duplicate automation job with key "${input.deduplicationKey}" is already active`)
      }
    }

    const complexity = input.complexity ?? "medium"
    const priority = input.priority ?? PRIORITY_BY_COMPLEXITY[complexity] ?? 0

    const job: QueuedJob = {
      id: `job-${Math.random().toString(36).slice(2)}`,
      prompt: input.prompt,
      complexity,
      priority,
      sessionID: input.sessionID,
      triggerID: input.triggerID,
      classification: { complexity, taskType: "refactor", reason: "test" },
      ...(input.deduplicationKey ? { deduplicationKey: input.deduplicationKey } : {}),
    }

    if (input.deduplicationKey) {
      state.dedupIndex.set(input.deduplicationKey, {
        jobId: job.id,
        expiresAt: now + DEDUP_TTL_MS,
      })
    }

    state.pending.push(job)
    state.pending.sort((a, b) => b.priority - a.priority)
  }

  /** Dispatch one job from pending to running (calls handler synchronously). */
  const dispatchOne = () => {
    if (state.pending.length === 0) return false
    const job = state.pending.shift()!
    state.running.add(job.id)
    if (handler) {
      Promise.resolve()
        .then(() => handler!(job))
        .catch(() => {})
        .then(() => {
          state.running.delete(job.id)
          if (job.deduplicationKey) state.dedupIndex.delete(job.deduplicationKey)
        })
    }
    return true
  }

  const dispatchAll = () => { while (dispatchOne()) {} }

  const setHandler = (h: JobHandler) => { handler = h }

  const status = () => {
    const now = Date.now()
    let dedupActive = 0
    for (const record of state.dedupIndex.values()) {
      if (record.expiresAt > now) dedupActive++
    }
    return {
      pending: state.pending.length,
      running: state.running.size,
      dedupActive,
    }
  }

  return { state, enqueue, dispatchOne, dispatchAll, setHandler, status }
}

const ENQ = (overrides?: { priority?: number; deduplicationKey?: string; prompt?: string; complexity?: Complexity }) => ({
  sessionID: "sess-1",
  triggerID: "trig-1",
  prompt: overrides?.prompt ?? "test prompt",
  ...overrides,
})

// ---------------------------------------------------------------------------
// Priority ordering
// ---------------------------------------------------------------------------

describe("AutomationQueue priority", () => {
  it("dispatches higher-priority jobs first", async () => {
    const q = makeQueue()
    const dispatched: string[] = []

    q.setHandler((job) => { dispatched.push(job.prompt); return Promise.resolve() as any })
    q.enqueue(ENQ({ prompt: "low", priority: 1 }))
    q.enqueue(ENQ({ prompt: "high", priority: 10 }))
    q.enqueue(ENQ({ prompt: "medium", priority: 5 }))

    expect(q.state.pending.map((j) => j.prompt)).toEqual(["high", "medium", "low"])

    q.dispatchAll()
    await Bun.sleep(10)
    expect(dispatched).toEqual(["high", "medium", "low"])
  })

  it("uses FIFO within same priority", async () => {
    const q = makeQueue()
    const dispatched: string[] = []

    q.setHandler((job) => { dispatched.push(job.prompt); return Promise.resolve() as any })
    q.enqueue(ENQ({ prompt: "first", priority: 5 }))
    q.enqueue(ENQ({ prompt: "second", priority: 5 }))
    q.enqueue(ENQ({ prompt: "third", priority: 5 }))

    expect(q.state.pending.map((j) => j.prompt)).toEqual(["first", "second", "third"])

    q.dispatchAll()
    await Bun.sleep(10)
    expect(dispatched).toEqual(["first", "second", "third"])
  })

  it("derives priority from complexity when no explicit priority given", () => {
    const q = makeQueue()
    q.setHandler(() => Promise.resolve() as any)
    q.enqueue(ENQ({ prompt: "default-prio" }))
    // Default complexity is "medium" → priority 5
    expect(q.state.pending[0]!.priority).toBe(5)
  })

  it("derives priority from complexity when not explicitly provided", () => {
    const q = makeQueue()

    q.enqueue(ENQ({ prompt: "low-c", complexity: "low" }))
    q.enqueue(ENQ({ prompt: "high-c", complexity: "high" }))
    q.enqueue(ENQ({ prompt: "med-c", complexity: "medium" }))

    // high=10 > medium=5 > low=0
    expect(q.state.pending.map((j) => j.prompt)).toEqual(["high-c", "med-c", "low-c"])
  })

  it("explicit priority overrides complexity-derived priority", () => {
    const q = makeQueue()

    q.enqueue(ENQ({ prompt: "high-c-but-low-prio", complexity: "high", priority: 1 }))
    q.enqueue(ENQ({ prompt: "low-c-but-high-prio", complexity: "low", priority: 100 }))

    expect(q.state.pending.map((j) => j.prompt)).toEqual(["low-c-but-high-prio", "high-c-but-low-prio"])
  })

  it("mixed priorities dispatch in correct order", () => {
    const q = makeQueue()

    q.enqueue(ENQ({ prompt: "a", priority: 0 }))
    q.enqueue(ENQ({ prompt: "b", priority: 100 }))
    q.enqueue(ENQ({ prompt: "c", priority: 50 }))
    q.enqueue(ENQ({ prompt: "d", priority: 25 }))

    expect(q.state.pending.map((j) => j.prompt)).toEqual(["b", "c", "d", "a"])
  })
})

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

describe("AutomationQueue deduplication", () => {
  it("rejects a second enqueue with the same active dedup key", () => {
    const q = makeQueue()
    q.setHandler(() => Promise.resolve() as any)

    q.enqueue(ENQ({ deduplicationKey: "order-123" }))
    expect(() => q.enqueue(ENQ({ deduplicationKey: "order-123" }))).toThrow(
      'Duplicate automation job with key "order-123"',
    )
  })

  it("allows same key after job completion", async () => {
    const q = makeQueue()
    q.setHandler(() => Promise.resolve() as any)

    q.enqueue(ENQ({ deduplicationKey: "order-123" }))
    q.dispatchOne()
    await Bun.sleep(10)

    expect(() => q.enqueue(ENQ({ deduplicationKey: "order-123", prompt: "second" }))).not.toThrow()
    expect(q.status().pending).toBe(1)
  })

  it("allows same key after job failure", async () => {
    const q = makeQueue()
    q.setHandler(() => Promise.reject(new Error("boom")) as any)

    q.enqueue(ENQ({ deduplicationKey: "key-fail" }))
    q.dispatchOne()
    await Bun.sleep(10)

    expect(() => q.enqueue(ENQ({ deduplicationKey: "key-fail", prompt: "retry" }))).not.toThrow()
    expect(q.status().pending).toBe(1)
  })

  it("tracks dedupActive count in status", () => {
    const q = makeQueue()
    q.setHandler(() => Promise.resolve() as any)

    q.enqueue(ENQ({ deduplicationKey: "k1" }))
    q.enqueue(ENQ({ deduplicationKey: "k2" }))

    expect(q.status().dedupActive).toBe(2)
  })

  it("allows different dedup keys simultaneously", () => {
    const q = makeQueue()
    q.setHandler(() => Promise.resolve() as any)

    q.enqueue(ENQ({ deduplicationKey: "key-a" }))
    q.enqueue(ENQ({ deduplicationKey: "key-b" }))

    expect(q.status().dedupActive).toBe(2)
  })

  it("jobs without dedup keys can always be enqueued", () => {
    const q = makeQueue()
    q.setHandler(() => Promise.resolve() as any)

    q.enqueue(ENQ())
    q.enqueue(ENQ())
    q.enqueue(ENQ())

    expect(q.status().pending).toBe(3)
  })

  it("dedup key is not cleared on dispatch (only on handler completion)", () => {
    const q = makeQueue()
    q.setHandler(() => Promise.resolve() as any)

    q.enqueue(ENQ({ deduplicationKey: "still-active" }))
    q.dispatchOne()

    expect(q.state.dedupIndex.has("still-active")).toBe(true)
  })

  it("dedup key is cleared after handler resolves", async () => {
    const q = makeQueue()
    q.setHandler(() => Promise.resolve() as any)

    q.enqueue(ENQ({ deduplicationKey: "will-clear" }))
    q.dispatchOne()
    await Bun.sleep(10)

    expect(q.state.dedupIndex.has("will-clear")).toBe(false)
  })
})
