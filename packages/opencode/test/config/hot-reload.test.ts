import path from "path"
import { describe, expect, test } from "bun:test"
import { relevant } from "../../src/config/hot-reload"

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
