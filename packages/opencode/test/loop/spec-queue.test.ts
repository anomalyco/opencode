import { describe, expect, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { parseTasksMd, allChecked, uncheckedTasks } from "@/loop/spec-queue/tasks-md"
import {
  resolveQueue,
  cursor,
  quarantine,
  compareOrder,
  nearbyOpenspecRepos,
  DefaultPriority,
  type QueueChange,
} from "@/loop/spec-queue/queue"
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
  return {
    slug: "demo",
    directory,
    tasks: parseTasksMd(tasks),
    order: { priority: DefaultPriority, created: "2026-01-01", slug: "demo" },
  }
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

  test("the fan-out nudge names the gate's agent", () => {
    const brief = buildBrief({
      change: fixtureChange(),
      gate: "implement",
      idlePeers: ["z4", "m3"],
      persona: "coder",
    })
    expect(brief).toContain("Fleet capacity")
    expect(brief).toContain("z4")
    expect(brief).toContain('subagent_type "coder"')
  })

  test("a busy fleet suppresses the nudge even with an agent bound", () => {
    const brief = buildBrief({ change: fixtureChange(), gate: "implement", idlePeers: [], persona: "coder" })
    expect(brief).not.toContain("Fleet capacity")
  })

  // An instruction to delegate to an agent that does not exist is worse than no
  // instruction — the model cannot carry it out and will improvise.
  test("no bound agent suppresses the nudge even with an idle fleet", () => {
    const brief = buildBrief({ change: fixtureChange(), gate: "implement", idlePeers: ["z4"] })
    expect(brief).not.toContain("Fleet capacity")
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

describe("queue ordering (priority, then creation date, then slug)", () => {
  function writeMeta(root: string, slug: string, body: string) {
    fs.writeFileSync(path.join(root, "openspec", "changes", slug, ".openspec.yaml"), body)
  }

  test("explicit priority wins, lower first", () => {
    const root = fixtureTree({ alpha: { tasks: OPEN }, beta: { tasks: OPEN }, gamma: { tasks: OPEN } })
    writeMeta(root, "gamma", "schema: spec-driven\npriority: 1\ncreated: 2026-08-01\n")
    writeMeta(root, "alpha", "schema: spec-driven\ncreated: 2026-08-01\n")
    writeMeta(root, "beta", "schema: spec-driven\npriority: 50\ncreated: 2026-08-01\n")
    expect(resolveQueue(root).eligible.map((c) => c.slug)).toEqual(["gamma", "beta", "alpha"])
  })

  test("without priority, oldest planned change goes first — not alphabetical", () => {
    const root = fixtureTree({ "aaa-newest": { tasks: OPEN }, "zzz-oldest": { tasks: OPEN } })
    writeMeta(root, "aaa-newest", "created: 2026-08-04\n")
    writeMeta(root, "zzz-oldest", "created: 2026-07-01\n")
    expect(resolveQueue(root).eligible.map((c) => c.slug)).toEqual(["zzz-oldest", "aaa-newest"])
  })

  test("the old alphabetical trap is gone: three sorts before two only if dated so", () => {
    const root = fixtureTree({ "change-two": { tasks: OPEN }, "change-three": { tasks: OPEN } })
    writeMeta(root, "change-two", "created: 2026-07-01\n")
    writeMeta(root, "change-three", "created: 2026-07-02\n")
    expect(resolveQueue(root).eligible.map((c) => c.slug)).toEqual(["change-two", "change-three"])
  })

  test("a change with no metadata sorts last but stays deterministic", () => {
    const root = fixtureTree({ dated: { tasks: OPEN }, undated: { tasks: OPEN } })
    writeMeta(root, "dated", "created: 2026-07-01\n")
    expect(resolveQueue(root).eligible.map((c) => c.slug)).toEqual(["dated", "undated"])
  })

  test("an explicit queue list is itself the priority statement and is honoured verbatim", () => {
    const root = fixtureTree({ first: { tasks: OPEN }, second: { tasks: OPEN } })
    writeMeta(root, "first", "priority: 99\ncreated: 2026-08-04\n")
    writeMeta(root, "second", "priority: 1\ncreated: 2026-07-01\n")
    // Discovery would put `second` first; the caller's order overrides it.
    expect(resolveQueue(root, ["first", "second"]).eligible.map((c) => c.slug)).toEqual(["first", "second"])
  })

  test("compareOrder is a total, stable order", () => {
    const a = { priority: 1, created: "2026-01-01", slug: "a" }
    const b = { priority: 1, created: "2026-01-01", slug: "b" }
    expect(compareOrder(a, b)).toBeLessThan(0)
    expect(compareOrder(b, a)).toBeGreaterThan(0)
    expect(compareOrder(a, a)).toBe(0)
  })
})

describe("standing instruction (Auto's optional prompt)", () => {
  test("guidance is repeated in the brief and marked as applying to every iteration", () => {
    const brief = buildBrief({
      change: fixtureChange(),
      gate: "implement",
      idlePeers: [],
      guidance: "prefer small commits; do not touch the CLI",
    })
    expect(brief).toContain("Standing instruction from the operator")
    expect(brief).toContain("prefer small commits; do not touch the CLI")
  })

  test("guidance sits ahead of the change documents so a long proposal cannot bury it", () => {
    const root = fixtureTree({ demo: { tasks: OPEN } })
    const dir = path.join(root, "openspec", "changes", "demo")
    fs.writeFileSync(path.join(dir, "proposal.md"), "# Demo\n\n" + "filler ".repeat(500))
    const change = cursor(resolveQueue(root))!
    const brief = buildBrief({ change, gate: "implement", idlePeers: [], guidance: "STEER-ME" })
    expect(brief.indexOf("STEER-ME")).toBeLessThan(brief.indexOf("## proposal.md"))
  })

  test("blank or whitespace guidance adds nothing", () => {
    for (const guidance of [undefined, "", "   ", "\n\t "]) {
      const brief = buildBrief({ change: fixtureChange(), gate: "implement", idlePeers: [], guidance })
      expect(brief).not.toContain("Standing instruction")
    }
  })

  test("guidance never decides WHAT is worked — the cursor still comes from disk", () => {
    // The invariant that makes an unattended run trustworthy: prose steers how,
    // checkboxes decide what.
    const root = fixtureTree({ "aaa-first": { tasks: OPEN }, "zzz-second": { tasks: OPEN } })
    fs.writeFileSync(path.join(root, "openspec", "changes", "aaa-first", ".openspec.yaml"), "created: 2026-01-01\n")
    fs.writeFileSync(path.join(root, "openspec", "changes", "zzz-second", ".openspec.yaml"), "created: 2026-02-01\n")
    expect(cursor(resolveQueue(root))?.slug).toBe("aaa-first")
  })
})

describe("starting somewhere without a backlog", () => {
  test("an empty queue distinguishes 'not an openspec repo' from 'nothing left to do'", () => {
    const notARepo = fs.mkdtempSync(path.join(os.tmpdir(), "no-openspec-"))
    expect(resolveQueue(notARepo).hasOpenspec).toBe(false)

    // A real openspec repo whose changes are all finished is a DRAINED queue,
    // which is a completely different thing to report.
    const drained = fixtureTree({ done: { tasks: DONE } })
    const resolved = resolveQueue(drained)
    expect(resolved.hasOpenspec).toBe(true)
    expect(resolved.eligible).toHaveLength(0)
    expect(resolved.complete).toEqual(["done"])
  })

  test("a workspace of repos can point at the repos inside it", () => {
    // The ~/dev case: many repos side by side, each with its own openspec.
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-"))
    for (const repo of ["zeta-repo", "alpha-repo"]) {
      fs.mkdirSync(path.join(workspace, repo, "openspec", "changes"), { recursive: true })
    }
    fs.mkdirSync(path.join(workspace, "not-a-repo"), { recursive: true })
    fs.mkdirSync(path.join(workspace, ".hidden", "openspec", "changes"), { recursive: true })

    const found = nearbyOpenspecRepos(workspace)
    expect(found).toEqual(["alpha-repo", "zeta-repo"])
    expect(found).not.toContain("not-a-repo")
    expect(found).not.toContain(".hidden")
  })

  test("a directory that cannot be read is not an error", () => {
    expect(nearbyOpenspecRepos(path.join(os.tmpdir(), "definitely-missing-dir-xyz"))).toEqual([])
  })
})
