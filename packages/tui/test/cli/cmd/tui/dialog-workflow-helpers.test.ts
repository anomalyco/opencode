import { describe, expect, test } from "bun:test"
import {
  formatPhase,
  formatShortElapsed,
  mergeRunEvent,
  parseDirectWorkflowCommand,
  parseWorkflowCommand,
  phaseIcon,
  phaseStatus,
  phaseTitles,
  questionBadge,
  reanchorSelection,
  sanitizeWorkflowFilename,
  saveTargets,
  spentThisMonth,
  statusIcon,
  workflowPermissionDisplay,
} from "../../../../src/component/dialog-workflow-helpers"
import type { WorkflowInfo, WorkflowRun } from "@opencode-ai/sdk/v2"
import path from "path"

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

describe("statusIcon (Fund 32, 33, Track B — all six status)", () => {
  test("each status maps to a distinct glyph", () => {
    const icons = new Set([
      statusIcon("running"),
      statusIcon("completed"),
      statusIcon("failed"),
      statusIcon("cancelled"),
      statusIcon("interrupted"),
      statusIcon("paused"),
    ])
    // Fund 32 + Track B: cancelled and paused each get their own glyph, so all
    // six are distinct.
    expect(icons.size).toBe(6)
  })

  test("cancelled has a glyph different from interrupted and the hollow pending marker", () => {
    expect(statusIcon("cancelled")).not.toBe(statusIcon("interrupted"))
    expect(statusIcon("cancelled")).not.toBe("◌")
  })

  test("paused has its own pause glyph, distinct from the terminal markers and the hollow marker", () => {
    expect(statusIcon("paused")).toBe("⏸")
    expect(statusIcon("paused")).not.toBe(statusIcon("cancelled"))
    expect(statusIcon("paused")).not.toBe(statusIcon("interrupted"))
    expect(statusIcon("paused")).not.toBe("◌")
  })
})

describe("phaseIcon", () => {
  test("renders each phase status distinctly except pending/skipped (both hollow)", () => {
    expect(phaseIcon("completed")).toBe("✔")
    expect(phaseIcon("running")).toBe("●")
    expect(phaseIcon("failed")).toBe("✖")
    expect(phaseIcon("interrupted")).toBe("⊘")
    expect(phaseIcon("cancelled")).toBe(statusIcon("cancelled"))
    expect(phaseIcon("paused")).toBe(statusIcon("paused"))
    expect(phaseIcon("pending")).toBe("◌")
    expect(phaseIcon("skipped")).toBe("◌")
  })
})

describe("phaseStatus (N5)", () => {
  const phases = ["a", "b", "c"]

  test("a completed run that stopped on a non-last phase reports later phases as skipped, never pending", () => {
    const run = makeRun({ status: "completed", completed_at: 2_000, current_phase: "a" })
    expect(phaseStatus(run, phases, "a")).toBe("completed")
    expect(phaseStatus(run, phases, "b")).toBe("skipped")
    expect(phaseStatus(run, phases, "c")).toBe("skipped")
  })

  test("a running run still reports unreached phases as pending", () => {
    const run = makeRun({ status: "running", current_phase: "a" })
    expect(phaseStatus(run, phases, "a")).toBe("running")
    expect(phaseStatus(run, phases, "b")).toBe("pending")
  })

  test("a cancelled run marks the stopped phase cancelled and later phases skipped", () => {
    const run = makeRun({ status: "cancelled", completed_at: 2_000, current_phase: "b" })
    expect(phaseStatus(run, phases, "a")).toBe("completed")
    expect(phaseStatus(run, phases, "b")).toBe("cancelled")
    expect(phaseStatus(run, phases, "c")).toBe("skipped")
  })

  test("a paused run marks the stopped phase paused and later phases skipped", () => {
    const run = makeRun({ status: "paused", current_phase: "b" })
    expect(phaseStatus(run, phases, "a")).toBe("completed")
    expect(phaseStatus(run, phases, "b")).toBe("paused")
    expect(phaseStatus(run, phases, "c")).toBe("skipped")
  })
})

describe("formatShortElapsed", () => {
  test("undefined start renders the placeholder", () => {
    expect(formatShortElapsed(undefined)).toBe("--")
  })

  test("string NaN timestamps render the placeholder", () => {
    expect(formatShortElapsed("NaN")).toBe("--")
  })

  test("numeric string timestamps are parsed", () => {
    expect(formatShortElapsed("1000", 4_000)).toBe("3s")
  })

  test("uses the injected now when there is no completion", () => {
    expect(formatShortElapsed(1_000, undefined, 4_000)).toBe("3s")
  })

  test("clamps to completed_at instead of ticking with now", () => {
    // completed_at is in the past relative to now; the elapsed must freeze at it.
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

describe("formatPhase (Fund 33 — [?/N])", () => {
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

  test("running run with no phases declared falls back to the current phase", () => {
    expect(formatPhase(makeRun({ status: "running", current_phase: "x" }), undefined)).toBe("x")
  })
})

describe("spentThisMonth (month boundary, undefined-cost agents)", () => {
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

  test("string-NaN started_at is excluded", () => {
    const now = new Date(2026, 5, 15).getTime()
    const runs = [makeRun({ started_at: "NaN", agents: [makeAgent({ cost: 5 })] })]
    expect(spentThisMonth(runs, now)).toBe(0)
  })
})

describe("reanchorSelection (Fund 10 — selection follows run.id across re-sort)", () => {
  const rows = [makeRun({ id: "job_a" }), makeRun({ id: "job_b" }), makeRun({ id: "job_c" })]

  test("returns the index of the row that still carries the previous id", () => {
    expect(reanchorSelection("job_c", rows)).toBe(2)
  })

  test("clamps to the last row when the previous id is gone", () => {
    expect(reanchorSelection("job_gone", rows)).toBe(2)
  })

  test("returns 0 for an empty list", () => {
    expect(reanchorSelection("job_a", [])).toBe(0)
  })

  test("returns 0 when no previous id is anchored", () => {
    expect(reanchorSelection(undefined, rows)).toBe(0)
  })
})

describe("parseWorkflowCommand (Fund 59 — dispatch, Fund 60 — raw remainder)", () => {
  test("/workflows opens the dashboard", () => {
    expect(parseWorkflowCommand("/workflows")).toEqual({ type: "dashboard" })
  })

  test("/workflows with trailing args still opens the dashboard (never a start)", () => {
    expect(parseWorkflowCommand("/workflows foo")).toEqual({ type: "dashboard" })
  })

  test("/workflow with no name opens the dashboard", () => {
    expect(parseWorkflowCommand("/workflow")).toEqual({ type: "dashboard" })
    expect(parseWorkflowCommand("/workflow   ")).toEqual({ type: "dashboard" })
  })

  test("/workflow <name> starts the named workflow", () => {
    expect(parseWorkflowCommand("/workflow review")).toEqual({ type: "start", name: "review", args: "" })
  })

  test("the remainder is the raw substring, preserving multiple spaces (Fund 60)", () => {
    expect(parseWorkflowCommand('/workflow flow msg="hello   world"')).toEqual({
      type: "start",
      name: "flow",
      args: 'msg="hello   world"',
    })
  })

  test("only the first line drives the command", () => {
    expect(parseWorkflowCommand("/workflow flow a=1\nsecond line")).toEqual({
      type: "start",
      name: "flow",
      args: "a=1",
    })
  })

  test("non-workflow input is not a workflow command", () => {
    expect(parseWorkflowCommand("/help")).toBeUndefined()
    expect(parseWorkflowCommand("hello")).toBeUndefined()
  })
})

describe("parseDirectWorkflowCommand (Item 30 — typed /<name> direct routing)", () => {
  test("a bare /<name> parses with empty args", () => {
    expect(parseDirectWorkflowCommand("/review")).toEqual({ name: "review", args: "" })
  })

  test("args are the raw remainder, preserving quotes and multiple spaces (Fund 60)", () => {
    expect(parseDirectWorkflowCommand('/review a=1 b="x y"')).toEqual({ name: "review", args: 'a=1 b="x y"' })
    expect(parseDirectWorkflowCommand('/review msg="hello   world"')).toEqual({
      name: "review",
      args: 'msg="hello   world"',
    })
  })

  test("the full discovery-name charset is accepted", () => {
    expect(parseDirectWorkflowCommand("/deep_research-2 x=1")).toEqual({ name: "deep_research-2", args: "x=1" })
  })

  test("leading whitespace before the slash is tolerated (parseWorkflowCommand parity)", () => {
    expect(parseDirectWorkflowCommand("  /review a=1")).toEqual({ name: "review", args: "a=1" })
  })

  test("the /workflow[s] dispatch words never parse as a direct command", () => {
    expect(parseDirectWorkflowCommand("/workflow x")).toBeUndefined()
    expect(parseDirectWorkflowCommand("/workflow")).toBeUndefined()
    expect(parseDirectWorkflowCommand("/workflows")).toBeUndefined()
    expect(parseDirectWorkflowCommand("/workflows foo")).toBeUndefined()
  })

  test("a bare slash, non-slash input, and out-of-charset names are rejected", () => {
    expect(parseDirectWorkflowCommand("/")).toBeUndefined()
    expect(parseDirectWorkflowCommand("hello")).toBeUndefined()
    expect(parseDirectWorkflowCommand("review")).toBeUndefined()
    expect(parseDirectWorkflowCommand("/re$view")).toBeUndefined()
    expect(parseDirectWorkflowCommand("/re.view x")).toBeUndefined()
    expect(parseDirectWorkflowCommand("")).toBeUndefined()
  })

  test("only the first line is parsed (parseWorkflowCommand consistency)", () => {
    expect(parseDirectWorkflowCommand("/review a=1\nsecond line")).toEqual({ name: "review", args: "a=1" })
    expect(parseDirectWorkflowCommand("hello\n/review")).toBeUndefined()
  })
})

describe("mergeRunEvent (event-driven dashboard refresh)", () => {
  test("overlays a finished event's status onto the matching run without dropping unrelated runs", () => {
    const runs = [makeRun({ id: "job_a", status: "running" }), makeRun({ id: "job_b", status: "running" })]
    const next = mergeRunEvent(runs, {
      kind: "finished",
      run: {
        id: "job_a",
        workflow: "demo",
        status: "completed",
        current_phase: "",
        directory: "/ws",
        agents: { total: 1, running: 0, failed: 0 },
        pending_question: false,
        error: "",
      },
    })
    expect(next.find((r) => r.id === "job_a")!.status).toBe("completed")
    expect(next.find((r) => r.id === "job_b")!.status).toBe("running")
    expect(next.length).toBe(2)
  })

  test("an event for an unknown run id leaves the list unchanged (a full refetch will pick it up)", () => {
    const runs = [makeRun({ id: "job_a", status: "running" })]
    const next = mergeRunEvent(runs, {
      kind: "updated",
      run: {
        id: "job_new",
        workflow: "demo",
        status: "running",
        current_phase: "",
        directory: "/ws",
        agents: { total: 0, running: 0, failed: 0 },
        pending_question: false,
        error: "",
      },
    })
    expect(next).toBe(runs)
  })
})

describe("questionBadge (Dashboard ⏳ for waiting/parked runs)", () => {
  test("a running run with pending_question gets the waiting badge", () => {
    expect(questionBadge(makeRun({ status: "running", pending_question: { question: "q?", asked_at: 1 } }))).toBe("⏳")
  })
  test("a paused run with pending_question gets the waiting badge (parked)", () => {
    expect(questionBadge(makeRun({ status: "paused", pending_question: { question: "q?", asked_at: 1 } }))).toBe("⏳")
  })
  test("a run without a pending question gets no badge", () => {
    expect(questionBadge(makeRun({ status: "running" }))).toBe("")
  })
})

describe("sanitizeWorkflowFilename (save-as-command guard)", () => {
  test("a plain name is accepted unchanged", () => {
    expect(sanitizeWorkflowFilename("deep-research")).toBe("deep-research")
    expect(sanitizeWorkflowFilename("my_flow_2")).toBe("my_flow_2")
  })

  test("surrounding whitespace is trimmed", () => {
    expect(sanitizeWorkflowFilename("  review  ")).toBe("review")
  })

  test("path traversal is rejected", () => {
    expect(sanitizeWorkflowFilename("../evil")).toBeUndefined()
    expect(sanitizeWorkflowFilename("..")).toBeUndefined()
  })

  test("slashes (forward and back) are rejected", () => {
    expect(sanitizeWorkflowFilename("a/b")).toBeUndefined()
    expect(sanitizeWorkflowFilename("a\\b")).toBeUndefined()
  })

  test("an empty or whitespace-only name is rejected", () => {
    expect(sanitizeWorkflowFilename("")).toBeUndefined()
    expect(sanitizeWorkflowFilename("   ")).toBeUndefined()
  })

  test("a name with a path separator embedded anywhere is rejected", () => {
    expect(sanitizeWorkflowFilename("foo/../bar")).toBeUndefined()
  })
})

describe("saveTargets (project vs global workflow file destinations)", () => {
  test("builds the project and global .ts paths under the workflows dirs", () => {
    const targets = saveTargets("/proj", "/home/.config/opencode", "review")
    expect(targets.project).toBe(path.join("/proj", ".opencode", "workflows", "review.ts"))
    expect(targets.global).toBe(path.join("/home/.config/opencode", "workflows", "review.ts"))
  })
})

describe("workflowPermissionDisplay (Item 9 — workflow permission prompt derivation)", () => {
  test("fully populated metadata titles with the display name and derives every field", () => {
    const d = workflowPermissionDisplay({
      name: "deep-research",
      display_name: "Deep Research",
      description: "Researches a topic in depth.",
      action: "start",
      args: { topic: "effect", rounds: 3 },
      background: true,
    })
    expect(d.title).toBe("Start workflow: Deep Research")
    expect(d.description).toBe("Researches a topic in depth.")
    // display name differs from the command name, so the command name surfaces.
    expect(d.commandName).toBe("deep-research")
    expect(d.args).toEqual([
      ["topic", "effect"],
      ["rounds", "3"],
    ])
    expect(d.background).toBe(true)
  })

  test("commandName stays unset when the display name equals the name", () => {
    const d = workflowPermissionDisplay({ name: "Inline", display_name: "Inline" })
    expect(d.title).toBe("Start workflow: Inline")
    expect(d.commandName).toBeUndefined()
  })

  test("empty or undefined metadata degrades to the generic title without crashing", () => {
    for (const metadata of [undefined, {}]) {
      const d = workflowPermissionDisplay(metadata)
      expect(d.title).toBe("Start workflow: workflow")
      expect(d.description).toBeUndefined()
      expect(d.commandName).toBeUndefined()
      expect(d.args).toEqual([])
      expect(d.background).toBe(false)
    }
  })

  test("action create titles with Create", () => {
    const d = workflowPermissionDisplay({ name: "made", display_name: "Made Nicely", action: "create" })
    expect(d.title).toBe("Create workflow: Made Nicely")
  })

  test("non-string and malformed fields are ignored defensively", () => {
    const d = workflowPermissionDisplay({
      name: 42,
      display_name: { evil: true },
      description: 7,
      args: ["not", "a", "record"],
      background: "true",
    })
    expect(d.title).toBe("Start workflow: workflow")
    expect(d.description).toBeUndefined()
    expect(d.args).toEqual([])
    // background must be a real boolean true, never a truthy string.
    expect(d.background).toBe(false)
  })

  test("non-string arg values are coerced via String()", () => {
    const d = workflowPermissionDisplay({ name: "x", args: { flag: true, count: 2, obj: { a: 1 } } })
    expect(d.args).toEqual([
      ["flag", "true"],
      ["count", "2"],
      ["obj", "[object Object]"],
    ])
  })
})

describe("phaseTitles (Item 9 — structured phase normalization)", () => {
  test("plain string phases pass through", () => {
    expect(phaseTitles(["plan", "build"])).toEqual(["plan", "build"])
  })

  test("structured entries are reduced to their titles (no [object Object])", () => {
    expect(phaseTitles(["plan", { title: "build" }, { title: "verify" }])).toEqual(["plan", "build", "verify"])
  })

  test("undefined phases yield an empty list", () => {
    expect(phaseTitles(undefined)).toEqual([])
  })
})
