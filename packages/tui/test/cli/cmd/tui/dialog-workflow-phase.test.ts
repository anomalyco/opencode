import { describe, expect, test } from "bun:test"
import {
  agentEffectiveEnd,
  agentEffectiveStatus,
  phaseStatus,
  runPhases,
} from "../../../../src/component/dialog-workflow"
import { isChildPhaseTitle, mergeObservedPhases } from "../../../../src/component/dialog-workflow-helpers"
import type { WorkflowInfo, WorkflowRun } from "@opencode-ai/sdk/v2"

// Minimal WorkflowRun builder for the pure phase/agent derivations under test.
// Only the fields these functions read are set; the cast keeps the test focused
// on logic, not on the full SDK shape (mirrors the other pure TUI helper tests).
function makeRun(input: Partial<WorkflowRun>): WorkflowRun {
  return {
    id: "job_test",
    workflow: "demo",
    status: "running",
    started_at: 1_000,
    logs: [],
    agents: [],
    ...input,
  } as WorkflowRun
}

function makeAgent(input: Partial<WorkflowRun["agents"][number]>): WorkflowRun["agents"][number] {
  return { id: "1", status: "running", started_at: 1_000, prompt: "p", ...input } as WorkflowRun["agents"][number]
}

function makeLog(input: Partial<WorkflowRun["logs"][number]> & { time: number }): WorkflowRun["logs"][number] {
  return { message: "log", ...input } as WorkflowRun["logs"][number]
}

describe("phaseStatus (N5)", () => {
  const phases = ["a", "b", "c"]

  test("a completed run that stopped on a non-last phase reports later phases as skipped, never pending", () => {
    const run = makeRun({ status: "completed", completed_at: 2_000, current_phase: "a" })
    // The phase the run stopped on and everything before it is completed.
    expect(phaseStatus(run, phases, "a")).toBe("completed")
    // Phases the run never reached are `skipped` (the N5 fix), NOT `pending`.
    expect(phaseStatus(run, phases, "b")).toBe("skipped")
    expect(phaseStatus(run, phases, "c")).toBe("skipped")
  })

  test("a completed run that walked every phase reports all completed", () => {
    const run = makeRun({ status: "completed", completed_at: 2_000, current_phase: "c" })
    expect(phaseStatus(run, phases, "a")).toBe("completed")
    expect(phaseStatus(run, phases, "b")).toBe("completed")
    expect(phaseStatus(run, phases, "c")).toBe("completed")
  })

  test("a running run still reports unreached phases as pending (live behavior unchanged)", () => {
    const run = makeRun({ status: "running", current_phase: "a" })
    expect(phaseStatus(run, phases, "a")).toBe("running")
    expect(phaseStatus(run, phases, "b")).toBe("pending")
    expect(phaseStatus(run, phases, "c")).toBe("pending")
  })

  test("a failed run marks the failing phase with its status and never-reached phases as skipped", () => {
    const run = makeRun({ status: "failed", completed_at: 2_000, current_phase: "b" })
    expect(phaseStatus(run, phases, "a")).toBe("completed")
    expect(phaseStatus(run, phases, "b")).toBe("failed")
    expect(phaseStatus(run, phases, "c")).toBe("skipped")
  })
})

describe("isChildPhaseTitle (Item 14 — engine '<name>: ' prefix heuristic)", () => {
  test("an engine child prefix with content after it reads as a child phase", () => {
    expect(isChildPhaseTitle("child: scan")).toBe(true)
  })

  test("a plain phase title is not a child", () => {
    expect(isChildPhaseTitle("analyze")).toBe(false)
  })

  test("a prefix with no content after ': ' is not a child", () => {
    expect(isChildPhaseTitle("a: ")).toBe(false)
  })
})

describe("mergeObservedPhases (Item 14 — child/undeclared phases become visible)", () => {
  test("a child-prefixed agent phase is merged behind its anchor with the child flag", () => {
    const run = makeRun({
      agents: [
        makeAgent({ id: "1", phase: "analyze", started_at: 1_000 }),
        makeAgent({ id: "2", phase: "child: scan", started_at: 2_000 }),
      ],
    })
    expect(mergeObservedPhases(["analyze", "fix"], run)).toEqual([
      { title: "analyze", child: false },
      { title: "child: scan", child: true },
      { title: "fix", child: false },
    ])
  })

  test("a child phase observed only via logs appears too", () => {
    const run = makeRun({
      agents: [makeAgent({ id: "1", phase: "analyze", started_at: 1_000 })],
      logs: [makeLog({ time: 2_000, phase: "child: scan" })],
    })
    expect(mergeObservedPhases(["analyze", "fix"], run).map((entry) => entry.title)).toEqual([
      "analyze",
      "child: scan",
      "fix",
    ])
  })

  test("an undeclared parent setPhase title (no prefix) is merged with child:false", () => {
    const run = makeRun({
      agents: [
        makeAgent({ id: "1", phase: "analyze", started_at: 1_000 }),
        makeAgent({ id: "2", phase: "extra", started_at: 2_000 }),
      ],
    })
    expect(mergeObservedPhases(["analyze", "fix"], run)).toEqual([
      { title: "analyze", child: false },
      { title: "extra", child: false },
      { title: "fix", child: false },
    ])
  })

  test("without extras the declared list comes back identical, in declared order", () => {
    const run = makeRun({
      agents: [
        // Observed out of declared order — the declared plan must NEVER re-sort.
        makeAgent({ id: "1", phase: "fix", started_at: 1_000 }),
        makeAgent({ id: "2", phase: "analyze", started_at: 2_000 }),
      ],
    })
    expect(mergeObservedPhases(["analyze", "fix"], run)).toEqual([
      { title: "analyze", child: false },
      { title: "fix", child: false },
    ])
  })

  test("anchor ordering: an extra between two observed declared phases lands between them, one without an anchor at the end", () => {
    const run = makeRun({
      agents: [
        makeAgent({ id: "1", phase: "a", started_at: 1_000 }),
        makeAgent({ id: "2", phase: "mid", started_at: 3_000 }),
        makeAgent({ id: "3", phase: "b", started_at: 5_000 }),
        // Observed BEFORE any declared phase observation: no anchor, appended.
        makeAgent({ id: "4", phase: "early", started_at: 500 }),
      ],
    })
    expect(mergeObservedPhases(["a", "b"], run).map((entry) => entry.title)).toEqual(["a", "mid", "b", "early"])
  })

  test("an unobserved current_phase sorts last among the extras (+Infinity)", () => {
    const run = makeRun({
      current_phase: "child: deploy",
      agents: [
        makeAgent({ id: "1", phase: "a", started_at: 1_000 }),
        makeAgent({ id: "2", phase: "child: scan", started_at: 2_000 }),
      ],
    })
    expect(mergeObservedPhases(["a"], run)).toEqual([
      { title: "a", child: false },
      { title: "child: scan", child: true },
      { title: "child: deploy", child: true },
    ])
  })

  test("declared=[] yields every observed phase chronologically (old else-branch parity)", () => {
    const run = makeRun({
      current_phase: "z",
      agents: [makeAgent({ id: "1", phase: "y", started_at: 1_000 })],
      logs: [makeLog({ time: 3_000, phase: "x" })],
    })
    expect(mergeObservedPhases([], run).map((entry) => entry.title)).toEqual(["y", "x", "z"])
  })
})

describe("runPhases (Item 14 — exported merge entry point)", () => {
  test("a run without any phases keeps the synthetic fallback", () => {
    expect(runPhases(makeRun({ status: "completed" }))).toEqual(["complete"])
    expect(runPhases(makeRun({ status: "running" }))).toEqual(["pending"])
  })

  test("declared phases (structured entries included) merge with observed child phases", () => {
    const workflow = { meta: { phases: ["main", { title: "wrap" }] } } as unknown as WorkflowInfo
    const run = makeRun({
      agents: [
        makeAgent({ id: "1", phase: "main", started_at: 1_000 }),
        makeAgent({ id: "2", phase: "child: scan", started_at: 2_000 }),
      ],
    })
    expect(runPhases(run, workflow)).toEqual(["main", "child: scan", "wrap"])
  })
})

describe("agent terminal rendering (Fund 34)", () => {
  test("a lingering running agent on a terminal run renders as failed, not live", () => {
    const run = makeRun({ status: "completed", completed_at: 5_000 })
    const agent = makeAgent({ status: "running" })
    expect(agentEffectiveStatus(run, agent)).toBe("failed")
  })

  test("a genuinely running agent on a live run still renders as running", () => {
    const run = makeRun({ status: "running" })
    const agent = makeAgent({ status: "running" })
    expect(agentEffectiveStatus(run, agent)).toBe("running")
  })

  test("a lingering running agent's elapsed end clamps to the run completion, not Date.now()", () => {
    const run = makeRun({ status: "completed", completed_at: 5_000 })
    const agent = makeAgent({ status: "running", started_at: 1_000 })
    expect(agentEffectiveEnd(run, agent)).toBe(5_000)
  })

  test("a node's own completed_at always wins over the run clamp", () => {
    const run = makeRun({ status: "completed", completed_at: 9_000 })
    const agent = makeAgent({ status: "completed", started_at: 1_000, completed_at: 3_000 })
    expect(agentEffectiveEnd(run, agent)).toBe(3_000)
  })

  test("a running agent on a live run has no clamped end (still ticking)", () => {
    const run = makeRun({ status: "running" })
    const agent = makeAgent({ status: "running" })
    expect(agentEffectiveEnd(run, agent)).toBeUndefined()
  })
})
