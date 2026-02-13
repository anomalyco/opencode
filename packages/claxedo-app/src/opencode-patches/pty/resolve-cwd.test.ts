import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { homedir } from "os"
import { join } from "path"
import { resolveCwd } from "./resolve-cwd"

const TEST_ROOT = join(tmpdir(), "resolve-cwd-test-" + Date.now())
const WORKSPACE = join(TEST_ROOT, "workspace")
const SUBDIR = join(WORKSPACE, "subdir")
const MISSING = join(TEST_ROOT, "does-not-exist")

describe("resolveCwd", () => {
  beforeAll(() => {
    mkdirSync(SUBDIR, { recursive: true })
  })

  afterAll(() => {
    rmSync(TEST_ROOT, { recursive: true, force: true })
  })

  test("no override returns workspace path", () => {
    expect(resolveCwd(undefined, WORKSPACE)).toBe(WORKSPACE)
  })

  test("no override no workspace falls back to homedir", () => {
    expect(resolveCwd(undefined, undefined)).toBe(homedir())
  })

  test("no override with missing workspace falls back to homedir", () => {
    expect(resolveCwd(undefined, MISSING)).toBe(homedir())
  })

  test("absolute path exists returns it", () => {
    expect(resolveCwd(SUBDIR, WORKSPACE)).toBe(SUBDIR)
  })

  test("absolute path missing falls back to workspace", () => {
    expect(resolveCwd(MISSING, WORKSPACE)).toBe(WORKSPACE)
  })

  test("absolute path missing + workspace missing falls back to homedir", () => {
    expect(resolveCwd(MISSING, MISSING)).toBe(homedir())
  })

  test("relative path resolves against workspace", () => {
    expect(resolveCwd("subdir", WORKSPACE)).toBe(SUBDIR)
  })

  test("relative path missing resolves to workspace", () => {
    expect(resolveCwd("nonexistent", WORKSPACE)).toBe(WORKSPACE)
  })

  test("relative path but workspace does not exist falls back to homedir", () => {
    expect(resolveCwd("subdir", MISSING)).toBe(homedir())
  })

  test("dot resolves to workspace", () => {
    expect(resolveCwd(".", WORKSPACE)).toBe(WORKSPACE)
  })

  test("both undefined returns homedir", () => {
    expect(resolveCwd(undefined, undefined)).toBe(homedir())
  })

  test("empty string override treated as falsy", () => {
    expect(resolveCwd("", WORKSPACE)).toBe(WORKSPACE)
  })

  test("relative path with no workspace falls back to homedir", () => {
    expect(resolveCwd("subdir", undefined)).toBe(homedir())
  })
})
