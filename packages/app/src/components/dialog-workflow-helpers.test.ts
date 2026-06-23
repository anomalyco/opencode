import { describe, expect, test } from "bun:test"
import {
  capLogs,
  formatPhase,
  formatShortElapsed,
  isResumable,
  normalizePhases,
  phaseIcon,
  phaseStatus,
  questionBadge,
  reanchorSelection,
  spentThisMonth,
  statusIcon,
} from "./dialog-workflow-helpers"
import type { WorkflowInfo, WorkflowRun } from "@opencode-ai/sdk/v2"

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

describe("statusIcon", () => {
  test("each status maps to a distinct glyph", () => {
    const icons = new Set([
      statusIcon("running"),
      statusIcon("completed"),
      statusIcon("failed"),
      statusIcon("cancelled"),
      statusIcon("interrupted"),
      statusIcon("paused"),
    ])
    expect(icons.size).toBe(6)
    expect(statusIcon("paused")).toBe("⏸")
  })
})

describe("isResumable (mirrors the engine's RESUMABLE guard)", () => {
  test("paused, interrupted, failed, and completed runs are resumable", () => {
    expect(isResumable("paused")).toBe(true)
    expect(isResumable("interrupted")).toBe(true)
    expect(isResumable("failed")).toBe(true)
    expect(isResumable("completed")).toBe(true)
  })
  test("running and cancelled runs are not", () => {
    expect(isResumable("running")).toBe(false)
    expect(isResumable("cancelled")).toBe(false)
  })
})

describe("phaseIcon", () => {
  test("renders each phase status distinctly except pending/skipped (both hollow)", () => {
    expect(phaseIcon("completed")).toBe("✔")
    expect(phaseIcon("running")).toBe("●")
    expect(phaseIcon("failed")).toBe("✖")
    expect(phaseIcon("interrupted")).toBe("⊘")
    expect(phaseIcon("pending")).toBe("◌")
    expect(phaseIcon("skipped")).toBe("◌")
  })
})

describe("phaseStatus (N5 — terminal runs skip never-reached phases)", () => {
  const phases = ["a", "b", "c"]

  test("a completed run that stopped on a non-last phase reports later phases as skipped", () => {
    const run = makeRun({ status: "completed", completed_at: 2_000, current_phase: "a" })
    expect(phaseStatus(run, phases, "a")).toBe("completed")
    expect(phaseStatus(run, phases, "b")).toBe("skipped")
    expect(phaseStatus(run, phases, "c")).toBe("skipped")
  })

  test("a running run reports unreached phases as pending", () => {
    const run = makeRun({ status: "running", current_phase: "a" })
    expect(phaseStatus(run, phases, "a")).toBe("running")
    expect(phaseStatus(run, phases, "b")).toBe("pending")
  })

  test("a paused run marks the stopped phase paused and later phases skipped", () => {
    const run = makeRun({ status: "paused", current_phase: "b" })
    expect(phaseStatus(run, phases, "b")).toBe("paused")
    expect(phaseStatus(run, phases, "c")).toBe("skipped")
  })
})

describe("formatShortElapsed", () => {
  test("undefined start renders the placeholder", () => {
    expect(formatShortElapsed(undefined)).toBe("--")
  })
  test("string NaN renders the placeholder", () => {
    expect(formatShortElapsed("NaN")).toBe("--")
  })
  test("uses the injected now when there is no completion", () => {
    expect(formatShortElapsed(1_000, undefined, 4_000)).toBe("3s")
  })
  test("clamps to completed_at instead of ticking with now", () => {
    expect(formatShortElapsed(1_000, 5_000, 999_999)).toBe("4s")
  })
  test("never goes negative", () => {
    expect(formatShortElapsed(5_000, 1_000)).toBe("0s")
  })
  test("formats minutes and hours", () => {
    expect(formatShortElapsed(0, 90_000)).toBe("1m30s")
    expect(formatShortElapsed(0, 3_660_000)).toBe("1h01m")
  })
})

describe("normalizePhases (widened SDK phases → string[])", () => {
  test("maps structured phase entries to their title and keeps strings", () => {
    const workflow = {
      meta: { phases: ["a", { title: "b", detail: "x" }, { title: "c" }] },
    } as unknown as WorkflowInfo
    expect(normalizePhases(workflow)).toEqual(["a", "b", "c"])
  })
  test("returns an empty array when no phases are declared", () => {
    expect(normalizePhases(undefined)).toEqual([])
    expect(normalizePhases({ meta: {} } as unknown as WorkflowInfo)).toEqual([])
  })
})

describe("formatPhase", () => {
  const workflow = { meta: { phases: ["a", "b", "c"] } } as unknown as WorkflowInfo
  test("terminal run is complete", () => {
    expect(formatPhase(makeRun({ status: "completed" }), workflow)).toBe("[---] complete")
  })
  test("running run with known phase shows [index/total]", () => {
    expect(formatPhase(makeRun({ status: "running", current_phase: "b" }), workflow)).toBe("[2/3] b")
  })
  test("running run on an unknown phase shows [?/total]", () => {
    expect(formatPhase(makeRun({ status: "running", current_phase: "zzz" }), workflow)).toBe("[?/3] zzz")
  })
})

describe("spentThisMonth", () => {
  test("sums only runs started this month and tolerates undefined agent cost", () => {
    const now = new Date(2026, 5, 15).getTime()
    const monthStart = new Date(2026, 5, 3).getTime()
    const lastMonth = new Date(2026, 4, 20).getTime()
    const runs = [
      makeRun({ started_at: monthStart, agents: [makeAgent({ cost: 1.5 }), makeAgent({ cost: undefined })] }),
      makeRun({ started_at: lastMonth, agents: [makeAgent({ cost: 99 })] }),
    ]
    expect(spentThisMonth(runs, now)).toBeCloseTo(1.5, 5)
  })
})

describe("reanchorSelection", () => {
  const rows = [makeRun({ id: "job_a" }), makeRun({ id: "job_b" }), makeRun({ id: "job_c" })]
  test("returns the index of the row that still carries the previous id", () => {
    expect(reanchorSelection("job_c", rows)).toBe(2)
  })
  test("clamps to the last row when the previous id is gone", () => {
    expect(reanchorSelection("job_gone", rows)).toBe(2)
  })
  test("returns 0 for an empty list and when no id is anchored", () => {
    expect(reanchorSelection("job_a", [])).toBe(0)
    expect(reanchorSelection(undefined, rows)).toBe(0)
  })
})

describe("capLogs", () => {
  const makeLog = (time: number) => ({ time, message: `m${time}` })
  test("returns every entry unchanged when within the cap", () => {
    const entries = [makeLog(1), makeLog(2), makeLog(3)]
    expect(capLogs(entries, 5)).toEqual({ entries, hidden: 0 })
  })
  test("keeps only the last N entries and reports how many were dropped", () => {
    const entries = Array.from({ length: 120 }, (_, i) => makeLog(i))
    const result = capLogs(entries, 100)
    expect(result.entries).toHaveLength(100)
    expect(result.entries[0]).toEqual(makeLog(20))
    expect(result.hidden).toBe(20)
  })
})

describe("questionBadge", () => {
  test("running/paused run with pending_question gets the waiting badge", () => {
    expect(questionBadge(makeRun({ status: "running", pending_question: { question: "q?", asked_at: 1 } }))).toBe("⏳")
    expect(questionBadge(makeRun({ status: "paused", pending_question: { question: "q?", asked_at: 1 } }))).toBe("⏳")
  })
  test("no pending question or terminal run gets no badge", () => {
    expect(questionBadge(makeRun({ status: "running" }))).toBe("")
    expect(questionBadge(makeRun({ status: "completed", pending_question: { question: "q?", asked_at: 1 } }))).toBe("")
  })
})
