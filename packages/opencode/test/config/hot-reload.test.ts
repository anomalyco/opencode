import path from "path"
import { describe, expect, test } from "bun:test"
import { relevant } from "../../src/config/hot-reload"

const config = path.resolve("/home/user/.config/opencode")
const project = path.resolve("/home/user/project/.opencode")
const roots = [config, project]

describe("hot reload relevant", () => {
  test("matches files inside config directories", () => {
    expect(relevant(path.join(config, "skill", "demo", "SKILL.md"), roots)).toBe(true)
    expect(relevant(path.join(project, "agent", "review.md"), roots)).toBe(true)
    expect(relevant(path.join(project, "command", "deploy.md"), roots)).toBe(true)
  })

  test("matches opencode config files anywhere", () => {
    expect(relevant(path.resolve("/home/user/project/opencode.json"), roots)).toBe(true)
    expect(relevant(path.resolve("/home/user/project/opencode.jsonc"), roots)).toBe(true)
  })

  test("ignores files outside every root", () => {
    expect(relevant(path.resolve("/home/user/project/src/index.ts"), roots)).toBe(false)
    expect(relevant(path.resolve("/home/user/.config/other/file.md"), roots)).toBe(false)
  })

  test("ignores plugin install artifacts inside config directories", () => {
    expect(relevant(path.join(config, "package.json"), roots)).toBe(false)
    expect(relevant(path.join(config, "bun.lock"), roots)).toBe(false)
    expect(relevant(path.join(project, "package-lock.json"), roots)).toBe(false)
  })

  test("does not treat sibling directories with a shared prefix as inside", () => {
    expect(relevant(path.resolve("/home/user/project/.opencode-other/skill/SKILL.md"), roots)).toBe(false)
  })
})
