import { describe, expect, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { parseTasksMd, allChecked, uncheckedTasks } from "@/loop/spec-queue/tasks-md"
import { resolveQueue, cursor, quarantine, type QueueChange } from "@/loop/spec-queue/queue"
import { buildBrief } from "@/loop/spec-queue/brief"
import {
  evaluateImplement,
  evaluateTest,
  evaluateVerify,
  evaluateCommit,
  nextGate,
  type Exec,
  type GateOptions,
} from "@/loop/spec-queue/gates"

const TASKS = `# Tasks: example

## Phase 1

- [x] 1.1 Do the first thing
  - some detail bullet
  - Validation: \`bun typecheck\` — zero errors

- [ ] 1.2 Do the second thing
  - Validation: manual — check the dialog by hand

- [ ] 2.1 A task without a validation line
`

describe("parseTasksMd", () => {
  test("parses ids, text, checked state and backtick validations", () => {
    const items = parseTasksMd(TASKS)
    expect(items).toHaveLength(3)
    expect(items[0]).toEqual({ id: "1.1", text: "Do the first thing", checked: true, validation: "bun typecheck" })
    expect(items[1]?.checked).toBe(false)
    // prose-only Validation lines are not runnable commands
    expect(items[1]?.validation).toBeUndefined()
    expect(items[2]?.id).toBe("2.1")
  })

  test("parses every real tasks.md in this repo without error", () => {
    const root = path.resolve(import.meta.dir, "../../../..")
    const changes = path.join(root, "openspec", "changes")
    const dirs = fs
      .readdirSync(changes, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(changes, entry.name, "tasks.md"))
      .filter((file) => fs.existsSync(file))
    expect(dirs.length).toBeGreaterThan(5)
    for (const file of dirs) {
      const content = fs.readFileSync(file, "utf8")
      const items = parseTasksMd(content)
      const baseline = (content.match(/^\s*-\s*\[[ xX]\]/gm) ?? []).length
      expect(items.length).toBe(baseline)
    }
  })

  test("allChecked and uncheckedTasks", () => {
    const items = parseTasksMd(TASKS)
    expect(allChecked(items)).toBe(false)
    expect(uncheckedTasks(items)).toHaveLength(2)
    expect(allChecked([])).toBe(false)
  })
})

function fixtureTree(input: Record<string, { tasks?: string; blocker?: string }>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "spec-queue-"))
  for (const [slug, files] of Object.entries(input)) {
    const dir = path.join(root, "openspec", "changes", slug)
    fs.mkdirSync(dir, { recursive: true })
    if (files.tasks !== undefined) fs.writeFileSync(path.join(dir, "tasks.md"), files.tasks)
    if (files.blocker !== undefined) {
      fs.mkdirSync(path.join(dir, ".skein"), { recursive: true })
      fs.writeFileSync(path.join(dir, ".skein", "blocker.md"), files.blocker)
    }
  }
  return root
}

const OPEN = "- [ ] 1.1 open task\n"
const DONE = "- [x] 1.1 closed task\n"

describe("resolveQueue", () => {
  test("orders eligible changes, excludes blockers, archive and non-changes", () => {
    const root = fixtureTree({
      "b-change": { tasks: OPEN },
      "a-change": { tasks: OPEN },
      "c-blocked": { tasks: OPEN, blocker: "# blocked" },
      "d-done": { tasks: DONE },
      "e-no-tasks": {},
      archive: { tasks: OPEN },
      _repo: { tasks: OPEN },
    })
    const queue = resolveQueue(root)
    expect(queue.eligible.map((c) => c.slug)).toEqual(["a-change", "b-change"])
    expect(queue.quarantined).toEqual(["c-blocked"])
    expect(queue.complete).toEqual(["d-done"])
  })

  test("explicit list restricts and orders the queue", () => {
    const root = fixtureTree({ one: { tasks: OPEN }, two: { tasks: OPEN }, three: { tasks: OPEN } })
    const queue = resolveQueue(root, ["two", "one", "missing"])
    expect(queue.eligible.map((c) => c.slug)).toEqual(["two", "one"])
  })

  test("cursor derives from disk and advances when tasks are checked off", () => {
    const root = fixtureTree({ first: { tasks: OPEN }, second: { tasks: OPEN } })
    expect(cursor(resolveQueue(root))?.slug).toBe("first")
    expect(cursor(resolveQueue(root))?.slug).toBe("first")
    fs.writeFileSync(path.join(root, "openspec", "changes", "first", "tasks.md"), DONE)
    expect(cursor(resolveQueue(root))?.slug).toBe("second")
  })

  test("quarantine writes the blocker file resolveQueue excludes on", () => {
    const root = fixtureTree({ sick: { tasks: OPEN } })
    const change = cursor(resolveQueue(root))!
    const file = quarantine(change, { cause: "verify failed 3x", detail: "boom output" })
    expect(fs.readFileSync(file, "utf8")).toContain("verify failed 3x")
    expect(fs.readFileSync(file, "utf8")).toContain("boom output")
    const after = resolveQueue(root)
    expect(after.eligible).toHaveLength(0)
    expect(after.quarantined).toEqual(["sick"])
  })
})

function fixtureChange(tasks: string = OPEN): QueueChange {
  const root = fixtureTree({ demo: { tasks } })
  const directory = path.join(root, "openspec", "changes", "demo")
  return { slug: "demo", directory, tasks: parseTasksMd(tasks) }
}

describe("buildBrief", () => {
  test("carries the change documents, gate instruction and next task", () => {
    const root = fixtureTree({ demo: { tasks: "- [ ] 3.2 wire the flux capacitor\n" } })
    const dir = path.join(root, "openspec", "changes", "demo")
    fs.writeFileSync(path.join(dir, "proposal.md"), "# Demo proposal body")
    fs.mkdirSync(path.join(dir, "specs", "demo"), { recursive: true })
    fs.writeFileSync(path.join(dir, "specs", "demo", "spec.md"), "## ADDED Requirements demo-spec-body")
    const change = cursor(resolveQueue(root))!
    const brief = buildBrief({ change, gate: "implement", idlePeers: [] })
    expect(brief).toContain("IMPLEMENT gate")
    expect(brief).toContain("3.2 wire the flux capacitor")
    expect(brief).toContain("Demo proposal body")
    expect(brief).toContain("demo-spec-body")
    expect(brief).not.toContain("Fleet capacity")
  })

  test("failure context is embedded verbatim", () => {
    const brief = buildBrief({
      change: fixtureChange(),
      gate: "implement",
      failure: { gate: "test", output: "1 test failed: expected 2 to be 3" },
      idlePeers: [],
    })
    expect(brief).toContain("TEST gate failed")
    expect(brief).toContain("expected 2 to be 3")
  })

  test("idle peers produce the fan-out nudge, busy fleet does not", () => {
    const withPeers = buildBrief({ change: fixtureChange(), gate: "implement", idlePeers: ["z4", "m3"] })
    expect(withPeers).toContain("Fleet capacity")
    expect(withPeers).toContain("z4")
    const without = buildBrief({ change: fixtureChange(), gate: "implement", idlePeers: [] })
    expect(without).not.toContain("Fleet capacity")
  })
})

const OPTIONS: GateOptions = { testCommand: "run-tests", verifyCommand: "run-typecheck", defaultBranch: "dev" }

function scripted(responses: Record<string, { code: number; output: string }>): Exec {
  return async (command) => responses[command] ?? { code: 0, output: "" }
}

describe("gate evaluators", () => {
  test("implement fails while boxes are unchecked and passes when all are checked", () => {
    const open = fixtureChange("- [ ] 1.1 first\n- [x] 1.2 second\n")
    const fail = evaluateImplement(open)
    expect(fail.passed).toBe(false)
    expect(fail.output).toContain("1.1")
    const done = fixtureChange("- [x] 1.1 first\n- [x] 1.2 second\n")
    expect(evaluateImplement(done).passed).toBe(true)
  })

  test("test gate reflects the test command exit code", async () => {
    expect((await evaluateTest(scripted({ "run-tests": { code: 0, output: "" } }), OPTIONS)).passed).toBe(true)
    const fail = await evaluateTest(scripted({ "run-tests": { code: 1, output: "2 fail" } }), OPTIONS)
    expect(fail.passed).toBe(false)
    expect(fail.output).toBe("2 fail")
  })

  test("verify runs typecheck plus each unique task validation", async () => {
    const change = fixtureChange(
      [
        "- [x] 1.1 a",
        "  - Validation: `check-a`",
        "- [x] 1.2 b",
        "  - Validation: `check-a`",
        "- [x] 1.3 c",
        "  - Validation: `check-c`",
        "",
      ].join("\n"),
    )
    const calls: string[] = []
    const exec: Exec = async (command) => {
      calls.push(command)
      return command === "check-c" ? { code: 2, output: "c exploded" } : { code: 0, output: "" }
    }
    const outcome = await evaluateVerify(exec, change, OPTIONS)
    expect(calls).toEqual(["run-typecheck", "check-a", "check-c"])
    expect(outcome.passed).toBe(false)
    expect(outcome.output).toContain("c exploded")
  })

  test("commit gate demands a non-default branch, a change commit and a clean tree", async () => {
    const change = fixtureChange()
    const onDev = await evaluateCommit(
      scripted({ "git rev-parse --abbrev-ref HEAD": { code: 0, output: "dev\n" } }),
      change,
      OPTIONS,
    )
    expect(onDev.passed).toBe(false)
    expect(onDev.output).toContain("default branch")

    const good = await evaluateCommit(
      scripted({
        "git rev-parse --abbrev-ref HEAD": { code: 0, output: `loop/${change.slug}\n` },
        [`git log -1 --name-only -- openspec/changes/${change.slug}`]: { code: 0, output: "abc123\ntasks.md" },
        "git status --porcelain": { code: 0, output: "" },
      }),
      change,
      OPTIONS,
    )
    expect(good.passed).toBe(true)
  })

  test("gate order ratchets forward", () => {
    expect(nextGate("implement")).toBe("test")
    expect(nextGate("test")).toBe("verify")
    expect(nextGate("verify")).toBe("commit")
    expect(nextGate("commit")).toBeUndefined()
  })
})

describe("restart resume (design D1: the cursor is derived, not stored)", () => {
  test("a fresh resolution after a simulated restart resumes at the right change and repeats no work", () => {
    // Queue order is alphabetical by slug (deterministic, per spec), so name
    // the fixtures so the expected order is unambiguous.
    const root = fixtureTree({
      "change-a": { tasks: OPEN },
      "change-b": { tasks: OPEN },
      "change-c": { tasks: OPEN },
    })
    // Run 1 works change-a to completion, then the "server dies" — nothing
    // about the run is persisted anywhere.
    expect(cursor(resolveQueue(root))?.slug).toBe("change-a")
    fs.writeFileSync(path.join(root, "openspec", "changes", "change-a", "tasks.md"), DONE)

    // Run 2 is a brand-new resolution with zero in-memory carry-over.
    const resumed = resolveQueue(root)
    expect(cursor(resumed)?.slug).toBe("change-b")
    expect(resumed.complete).toContain("change-a")
    expect(resumed.eligible.map((c) => c.slug)).not.toContain("change-a")

    // A change quarantined before the restart stays out after it.
    quarantine(cursor(resumed)!, { cause: "verify gate failed 3x consecutively", detail: "boom" })
    const third = resolveQueue(root)
    expect(cursor(third)?.slug).toBe("change-c")
    expect(third.quarantined).toContain("change-b")
  })

  test("work added while a run is live joins the queue on the next resolution", () => {
    const root = fixtureTree({ "live-a": { tasks: OPEN } })
    expect(resolveQueue(root).eligible.map((c) => c.slug)).toEqual(["live-a"])
    // A human (or another agent) plans a new change mid-run.
    const late = path.join(root, "openspec", "changes", "live-b")
    fs.mkdirSync(late, { recursive: true })
    fs.writeFileSync(path.join(late, "tasks.md"), OPEN)
    expect(resolveQueue(root).eligible.map((c) => c.slug)).toEqual(["live-a", "live-b"])
  })
})
