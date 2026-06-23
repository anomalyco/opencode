import { describe, expect, test } from "bun:test"
import {
  belongsToPhase,
  firstSelectableRow,
  phaseRows,
  stepSelectableRow,
  type WorkflowPhaseRow,
} from "../../../../src/component/dialog-workflow-helpers"
import { agentLabel, phaseProgress } from "../../../../src/component/dialog-workflow"
import type { WorkflowRun } from "@opencode-ai/sdk/v2"

// Builder pattern shared with dialog-workflow-phase.test.ts: only the fields the
// pure row derivations read are set; the cast keeps the test focused on logic.
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

function rowKinds(rows: readonly WorkflowPhaseRow[]) {
  return rows.map((row) => row.type)
}

describe("phaseRows (Item 19 — narrator logs interleaved with agent rows)", () => {
  test("logs interleave chronologically between the agent rows of the phase", () => {
    const run = makeRun({
      agents: [
        makeAgent({ id: "1", phase: "a", started_at: 1_000 }),
        makeAgent({ id: "2", phase: "a", started_at: 2_000 }),
      ],
      logs: [
        makeLog({ time: 1_500, phase: "a", message: "first" }),
        makeLog({ time: 2_500, phase: "a", message: "second" }),
      ],
    })
    const rows = phaseRows(run, ["a"], "a")
    expect(rowKinds(rows)).toEqual(["agent", "log", "agent", "log"])
    expect(rows[1]).toEqual({ type: "log", entry: run.logs[0] })
    expect(rows[3]).toEqual({ type: "log", entry: run.logs[1] })
  })

  test("on a timestamp tie the agent row comes before the log row (stable sort)", () => {
    const run = makeRun({
      agents: [makeAgent({ id: "1", phase: "a", started_at: 1_000 })],
      logs: [makeLog({ time: 1_000, phase: "a" })],
    })
    expect(rowKinds(phaseRows(run, ["a"], "a"))).toEqual(["agent", "log"])
  })

  test("phase-less logs and agents appear ONLY in the first phase group", () => {
    const run = makeRun({
      agents: [
        makeAgent({ id: "1", phase: undefined, started_at: 500 }),
        makeAgent({ id: "2", phase: "b", started_at: 2_000 }),
      ],
      logs: [makeLog({ time: 800, phase: undefined, message: "pre-phase" })],
    })
    const phases = ["a", "b"]
    const first = phaseRows(run, phases, "a")
    // The phase-less agent and log both land in the first group, chronologically.
    expect(first).toEqual([
      { type: "agent", agent: run.agents[0] },
      { type: "log", entry: run.logs[0] },
    ])
    // Neither is duplicated into a later phase (the old code showed phase-less
    // logs under EVERY phase and phase-less agents under none).
    expect(phaseRows(run, phases, "b")).toEqual([{ type: "agent", agent: run.agents[1] }])
  })

  test("the result row stays the last row of the result phase, after later logs", () => {
    const run = makeRun({
      status: "completed",
      result: "done",
      current_phase: "a",
      agents: [makeAgent({ id: "1", phase: "a", started_at: 1_000 })],
      logs: [makeLog({ time: 9_000, phase: "a" })],
    })
    const rows = phaseRows(run, ["a"], "a")
    expect(rowKinds(rows)).toEqual(["agent", "log", "result"])
  })

  test("includeLogs:false yields agent/result rows only", () => {
    const run = makeRun({
      agents: [makeAgent({ id: "1", phase: "a", started_at: 1_000 })],
      logs: [makeLog({ time: 500, phase: "a" }), makeLog({ time: 1_500, phase: "a" })],
    })
    expect(rowKinds(phaseRows(run, ["a"], "a", { includeLogs: false }))).toEqual(["agent"])
  })

  test("an agent without started_at sorts to the phase end (defensive)", () => {
    const run = makeRun({
      agents: [makeAgent({ id: "1", phase: "a", started_at: undefined })],
      logs: [makeLog({ time: 1_000, phase: "a" })],
    })
    expect(rowKinds(phaseRows(run, ["a"], "a"))).toEqual(["log", "agent"])
  })
})

describe("belongsToPhase (Item 19 — phase-less items belong to the first group)", () => {
  test("exact phase match", () => {
    expect(belongsToPhase("a", "a", ["a", "b"])).toBe(true)
    expect(belongsToPhase("a", "b", ["a", "b"])).toBe(false)
  })

  test("a phase-less item belongs to the first phase only", () => {
    expect(belongsToPhase(undefined, "a", ["a", "b"])).toBe(true)
    expect(belongsToPhase(undefined, "b", ["a", "b"])).toBe(false)
  })
})

describe("firstSelectableRow / stepSelectableRow (Item 19 — log rows are not selectable)", () => {
  const log: WorkflowPhaseRow = { type: "log", entry: makeLog({ time: 1 }) }
  const agent: WorkflowPhaseRow = { type: "agent", agent: makeAgent({ id: "1" }) }
  const result: WorkflowPhaseRow = { type: "result" }

  test("firstSelectableRow skips leading logs", () => {
    expect(firstSelectableRow([log, log, agent, log])).toBe(2)
  })

  test("firstSelectableRow on a logs-only phase falls back to 0", () => {
    expect(firstSelectableRow([log, log])).toBe(0)
    expect(firstSelectableRow([])).toBe(0)
  })

  test("stepSelectableRow skips logs forward and backward", () => {
    const rows = [agent, log, log, result]
    expect(stepSelectableRow(rows, 0, 1)).toBe(3)
    expect(stepSelectableRow(rows, 3, -1)).toBe(0)
  })

  test("stepSelectableRow wraps cyclically across the ends", () => {
    const rows = [log, agent, log, result, log]
    expect(stepSelectableRow(rows, 3, 1)).toBe(1)
    expect(stepSelectableRow(rows, 1, -1)).toBe(3)
  })

  test("a logs-only phase keeps the current index", () => {
    expect(stepSelectableRow([log, log, log], 1, 1)).toBe(1)
    expect(stepSelectableRow([], 0, -1)).toBe(0)
  })
})

describe("phaseProgress (Item 19 — narrator rows count in neither side)", () => {
  test("2 agents + 3 logs with 1 running reads 1/2", () => {
    const run = makeRun({
      agents: [
        makeAgent({ id: "1", phase: "a", status: "completed", started_at: 1_000 }),
        makeAgent({ id: "2", phase: "a", status: "running", started_at: 2_000 }),
      ],
      logs: [
        makeLog({ time: 1_100, phase: "a" }),
        makeLog({ time: 1_200, phase: "a" }),
        makeLog({ time: 1_300, phase: "a" }),
      ],
    })
    expect(phaseProgress(run, ["a"], "a")).toBe("1/2")
  })

  test("the result row still counts as done, logs still excluded", () => {
    const run = makeRun({
      status: "completed",
      result: "done",
      current_phase: "a",
      agents: [
        makeAgent({ id: "1", phase: "a", status: "completed", started_at: 1_000 }),
        makeAgent({ id: "2", phase: "a", status: "completed", started_at: 2_000 }),
      ],
      logs: [makeLog({ time: 1_100, phase: "a" })],
    })
    expect(phaseProgress(run, ["a"], "a")).toBe("3/3")
  })

  test("a logs-only phase reads as empty progress", () => {
    const run = makeRun({ logs: [makeLog({ time: 1_000, phase: "a" })] })
    expect(phaseProgress(run, ["a", "b"], "a")).toBe("")
  })
})

describe("agentLabel (Item 16 — per-call label wins over the agent type name)", () => {
  test("a persisted label is the display name", () => {
    expect(agentLabel(makeAgent({ agent: "explore", label: "Scan auth module" }))).toBe("Scan auth module")
  })

  test("without a label the agent (subagent type) name renders", () => {
    expect(agentLabel(makeAgent({ agent: "explore" }))).toBe("explore")
  })

  test("with neither, the node id is the fallback", () => {
    expect(agentLabel(makeAgent({ id: "n1" }))).toBe("agent:n1")
  })
})
