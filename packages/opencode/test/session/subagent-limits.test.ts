import { describe, expect, test } from "bun:test"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { SessionV2 } from "@opencode-ai/core/session"
import { SubagentLimits } from "@/session/subagent-limits"

// The `subagent_max_depth` config key lands with the default-opening track
// (T6.4); until then the cast below is the only way to feed the helper a value.
const cfg = (value?: number) =>
  ({ experimental: value === undefined ? {} : { subagent_max_depth: value } }) as unknown as ConfigV1.Info

// Same cast for the Phase-2 `subagent_tree_limit` knob (Issue 2).
const treeCfg = (value?: number) =>
  ({ experimental: value === undefined ? {} : { subagent_tree_limit: value } }) as unknown as ConfigV1.Info

describe("constants", () => {
  test("limits match the design", () => {
    expect(SubagentLimits.DEFAULT_MAX_TASK_DEPTH).toBe(5)
    expect(SubagentLimits.HARD_MAX_DEPTH).toBe(10)
    expect(SubagentLimits.SUBAGENT_TREE_LIMIT).toBe(200)
    expect(SubagentLimits.HARD_MAX_TREE_LIMIT).toBe(10_000)
    expect(SubagentLimits.DEFAULT_SUBAGENT_CONCURRENCY).toBe(8)
    expect(SubagentLimits.LINEAGE_ITERATION_CAP).toBe(32)
  })
})

describe("treeLimit", () => {
  test("defaults to 200 when unset", () => {
    expect(SubagentLimits.treeLimit(treeCfg())).toBe(200)
    expect(SubagentLimits.treeLimit({} as ConfigV1.Info)).toBe(200)
  })

  test("clamps to [1, HARD_MAX_TREE_LIMIT]", () => {
    expect(SubagentLimits.treeLimit(treeCfg(0))).toBe(1)
    expect(SubagentLimits.treeLimit(treeCfg(-5))).toBe(1)
    expect(SubagentLimits.treeLimit(treeCfg(1))).toBe(1)
    expect(SubagentLimits.treeLimit(treeCfg(50))).toBe(50)
    expect(SubagentLimits.treeLimit(treeCfg(200))).toBe(200)
    expect(SubagentLimits.treeLimit(treeCfg(999_999))).toBe(10_000)
  })

  test("truncates fractional values", () => {
    expect(SubagentLimits.treeLimit(treeCfg(50.9))).toBe(50)
  })

  test("ignores non-finite values (falls back to default)", () => {
    expect(SubagentLimits.treeLimit(treeCfg(Number.NaN))).toBe(200)
    expect(SubagentLimits.treeLimit(treeCfg(Number.POSITIVE_INFINITY))).toBe(200)
  })

  test("__testHooks.treeLimit overrides config when set", () => {
    SubagentLimits.__testHooks.treeLimit = 3
    expect(SubagentLimits.treeLimit(treeCfg(200))).toBe(3)
    SubagentLimits.__testHooks.treeLimit = undefined
    expect(SubagentLimits.treeLimit(treeCfg(200))).toBe(200)
  })
})

describe("maxDepth", () => {
  test("defaults to 5 when unset", () => {
    expect(SubagentLimits.maxDepth(cfg())).toBe(5)
    expect(SubagentLimits.maxDepth({} as ConfigV1.Info)).toBe(5)
  })

  test("clamps to [1, 10]", () => {
    expect(SubagentLimits.maxDepth(cfg(0))).toBe(1)
    expect(SubagentLimits.maxDepth(cfg(1))).toBe(1)
    expect(SubagentLimits.maxDepth(cfg(5))).toBe(5)
    expect(SubagentLimits.maxDepth(cfg(99))).toBe(10)
    expect(SubagentLimits.maxDepth(cfg(-3))).toBe(1)
  })

  test("ignores non-finite values", () => {
    expect(SubagentLimits.maxDepth(cfg(Number.NaN))).toBe(5)
    expect(SubagentLimits.maxDepth(cfg(Number.POSITIVE_INFINITY))).toBe(5)
  })
})

// The ONLY place in the repo that pins the model-facing error texts; everything
// else asserts on `_tag` (design-final §2.4 / plan T1.1).
describe("typed errors", () => {
  test("SubagentDepthError", () => {
    const error = SubagentLimits.depthError({ depth: 5, limit: 5 })
    expect(error._tag).toBe("SubagentDepthError")
    expect(error.depth).toBe(5)
    expect(error.limit).toBe(5)
    expect(error.message).toBe(
      "Subagent nesting limit reached: this session is already at the maximum nesting depth (5 of 5; the root session is depth 1). Do the remaining work yourself in this session and report the results in your final message instead of delegating.",
    )
  })

  test("SubagentTreeLimitError", () => {
    const error = SubagentLimits.treeLimitError({ started: 200, limit: 200 })
    expect(error._tag).toBe("SubagentTreeLimitError")
    expect(error.started).toBe(200)
    expect(error.limit).toBe(200)
    expect(error.message).toBe(
      "Subagent limit reached: this session tree has already started 200 of 200 subagents (the cap guards against runaway delegation). Finish the remaining work directly in this session.",
    )
  })

  test("SubagentResumeError", () => {
    const error = SubagentLimits.resumeError({ taskID: "ses_123" })
    expect(error._tag).toBe("SubagentResumeError")
    expect(error.taskID).toBe("ses_123")
    expect(error.message).toBe(
      "Cannot resume task ses_123: it is not a subagent of this session. task_id can only resume tasks this session started itself.",
    )
  })

  test("SubagentBudgetError", () => {
    const error = SubagentLimits.budgetError()
    expect(error._tag).toBe("SubagentBudgetError")
    expect(error.message).toBe(
      "Turn budget exhausted: cannot start another subagent. Finish the remaining work directly within this session.",
    )
  })

  test("SubagentConcurrencyError", () => {
    const error = SubagentLimits.concurrencyError({ running: 8, limit: 8 })
    expect(error._tag).toBe("SubagentConcurrencyError")
    expect(error.running).toBe(8)
    expect(error.limit).toBe(8)
    expect(error.message).toBe(
      "Subagent concurrency limit reached: this session already has 8 of 8 subagents running at once (the cap bounds parallel fan-out). Wait for one to finish, or do the remaining work directly in this session, before delegating again.",
    )
  })

  test("SubagentLineageError", () => {
    const sessionID = SessionV2.ID.make("ses_abc")
    const error = SubagentLimits.lineageError({ sessionID })
    expect(error._tag).toBe("SubagentLineageError")
    expect(error.sessionID).toBe(sessionID)
    expect(error.message).toBe(
      "Session ancestry could not be resolved (possible cycle in session parents); refusing to spawn subagents from this session.",
    )
  })
})

describe("depthHint", () => {
  test("names depth and budget", () => {
    expect(SubagentLimits.depthHint(3, 5)).toBe(
      "You are a sub-agent at delegation depth 3 of 5. You may delegate to deeper sub-agents; prefer doing small tasks yourself.",
    )
  })
})

describe("__testHooks", () => {
  test("tree limit seam defaults to undefined and is settable", () => {
    expect(SubagentLimits.__testHooks.treeLimit).toBeUndefined()
    SubagentLimits.__testHooks.treeLimit = 3
    expect(SubagentLimits.__testHooks.treeLimit).toBe(3)
    SubagentLimits.__testHooks.treeLimit = undefined
  })

  test("concurrency seam defaults to undefined and is settable", () => {
    expect(SubagentLimits.__testHooks.concurrency).toBeUndefined()
    SubagentLimits.__testHooks.concurrency = 2
    expect(SubagentLimits.__testHooks.concurrency).toBe(2)
    SubagentLimits.__testHooks.concurrency = undefined
  })
})
