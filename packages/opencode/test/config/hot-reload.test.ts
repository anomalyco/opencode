import path from "path"
import { describe, expect, test } from "bun:test"
import { DEBOUNCE_MS, relevant, schedule, settle, type Pending } from "../../src/config/hot-reload"

const config = path.resolve("/home/user/.config/opencode")
const project = path.resolve("/home/user/project/.opencode")
const skillDir = path.resolve("/home/user/.claude/skills/review")
const worktree = path.resolve("/home/user/project")
const roots = {
  configDirs: [config, project],
  skillDirs: [skillDir],
  documents: new Set(
    [config, project, worktree].flatMap((dir) => [path.join(dir, "opencode.json"), path.join(dir, "opencode.jsonc")]),
  ),
}

describe("hot reload relevant", () => {
  test("matches config content inside config directories", () => {
    expect(relevant(path.join(config, "skill", "demo", "SKILL.md"), roots)).toBe(true)
    expect(relevant(path.join(project, "agent", "review.md"), roots)).toBe(true)
    expect(relevant(path.join(project, "command", "deploy.md"), roots)).toBe(true)
    expect(relevant(path.join(project, "plugin", "notify.ts"), roots)).toBe(true)
  })

  test("matches files inside skill directories", () => {
    expect(relevant(path.join(skillDir, "SKILL.md"), roots)).toBe(true)
    expect(relevant(path.join(skillDir, "scripts", "run.py"), roots)).toBe(true)
  })

  test("matches known config file paths only", () => {
    expect(relevant(path.join(worktree, "opencode.json"), roots)).toBe(true)
    expect(relevant(path.join(config, "opencode.jsonc"), roots)).toBe(true)
    // A fixture opencode.json elsewhere in the tree is not config.
    expect(relevant(path.join(worktree, "test", "fixtures", "opencode.json"), roots)).toBe(false)
  })

  test("ignores runtime output inside config directories", () => {
    expect(relevant(path.join(project, "plans", "2026-08-19-plan.md"), roots)).toBe(false)
    expect(relevant(path.join(config, "package.json"), roots)).toBe(false)
    expect(relevant(path.join(config, "node_modules", "pkg", "index.js"), roots)).toBe(false)
  })

  test("ignores files outside every root", () => {
    expect(relevant(path.join(worktree, "src", "index.ts"), roots)).toBe(false)
    expect(relevant(path.resolve("/home/user/.config/other/skill/SKILL.md"), roots)).toBe(false)
  })

  test("does not treat sibling directories with a shared prefix as inside", () => {
    expect(relevant(path.resolve("/home/user/project/.opencode-other/skill/SKILL.md"), roots)).toBe(false)
  })
})

describe("hot reload debounce", () => {
  const dir = path.resolve("/home/user/project")

  test("the first event starts a driver and later ones only push the deadline out", () => {
    const pendings = new Map<string, Pending>()
    const state = schedule(pendings, dir, "a.md", 1_000)
    expect(state).toBeDefined()
    expect(state!.deadline).toBe(1_000 + DEBOUNCE_MS)

    // A second driver would reload twice for one burst of editor writes.
    expect(schedule(pendings, dir, "b.md", 1_100)).toBeUndefined()
    expect(state!.deadline).toBe(1_100 + DEBOUNCE_MS)
    expect(state!.file).toBe("b.md")
    expect(state!.dirty).toBe(false)
  })

  test("an edit during the reload keeps the driver looping", () => {
    const pendings = new Map<string, Pending>()
    const state = schedule(pendings, dir, "a.md", 1_000)!
    state.running = true

    schedule(pendings, dir, "b.md", 1_500)
    expect(state.dirty).toBe(true)

    // Without this the edit at 1_500 would never load: the old code held a single
    // pending marker across the whole reload and dropped everything that arrived.
    expect(settle(pendings, dir)).toBe(false)
    expect(pendings.has(dir)).toBe(true)
    expect(state.running).toBe(false)
    expect(state.deadline).toBe(1_500 + DEBOUNCE_MS)
  })

  test("a quiet reload drops the entry so the next edit starts fresh", () => {
    const pendings = new Map<string, Pending>()
    const state = schedule(pendings, dir, "a.md", 1_000)!
    state.running = true

    expect(settle(pendings, dir)).toBe(true)
    expect(pendings.has(dir)).toBe(false)
    expect(schedule(pendings, dir, "c.md", 2_000)).toBeDefined()
  })

  test("directories debounce independently", () => {
    const pendings = new Map<string, Pending>()
    const other = path.resolve("/home/user/other")
    expect(schedule(pendings, dir, "a.md", 1_000)).toBeDefined()
    expect(schedule(pendings, other, "a.md", 1_000)).toBeDefined()
    expect(pendings.size).toBe(2)
  })
})
