import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { workingDirectory } from "../src/util/process"

describe("workingDirectory", () => {
  const originalCwd = process.cwd()
  const originalPwd = process.env.PWD
  let base: string

  beforeEach(() => {
    base = realpathSync(mkdtempSync(path.join(tmpdir(), "opencode-wd-")))
  })

  afterEach(() => {
    process.chdir(originalCwd)
    if (originalPwd === undefined) delete process.env.PWD
    else process.env.PWD = originalPwd
    rmSync(base, { recursive: true, force: true })
  })

  test("falls back to cwd when PWD is unset", () => {
    const dir = path.join(base, "project")
    mkdirSync(dir)
    process.chdir(dir)
    delete process.env.PWD
    expect(workingDirectory()).toBe(process.cwd())
  })

  test("keeps PWD when it reaches the current directory through a symlink", () => {
    const real = path.join(base, "real")
    const link = path.join(base, "link")
    mkdirSync(real)
    symlinkSync(real, link)
    process.chdir(real)
    process.env.PWD = link
    // The whole point of preferring PWD: show the path the user typed.
    expect(workingDirectory()).toBe(link)
  })

  test("ignores a stale PWD inherited from a parent process", () => {
    const parent = path.join(base, "parent")
    const child = path.join(base, "child")
    mkdirSync(parent)
    mkdirSync(child)
    process.chdir(child)
    // What spawn(cwd: child) leaves behind: the directory changed, PWD did not.
    process.env.PWD = parent
    expect(workingDirectory()).toBe(process.cwd())
  })

  test("ignores a PWD that no longer exists", () => {
    const dir = path.join(base, "project")
    mkdirSync(dir)
    process.chdir(dir)
    process.env.PWD = path.join(base, "deleted")
    expect(workingDirectory()).toBe(process.cwd())
  })
})
