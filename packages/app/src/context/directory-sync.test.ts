import { describe, expect, test } from "bun:test"
import { selectTargetDirectory } from "./directory-sync"

describe("selectTargetDirectory", () => {
  const context = "/home/user/project"

  test("returns undefined when no directory is requested (use current)", () => {
    expect(selectTargetDirectory(context)).toBeUndefined()
    expect(selectTargetDirectory(context, undefined)).toBeUndefined()
    expect(selectTargetDirectory(context, "")).toBeUndefined()
  })

  test("returns undefined when requested directory equals the context", () => {
    expect(selectTargetDirectory(context, context)).toBeUndefined()
  })

  test("treats path-equivalent directories as current", () => {
    // trailing slash and separator normalization should still resolve to current
    expect(selectTargetDirectory(context, context + "/")).toBeUndefined()
    expect(selectTargetDirectory("C:\\Repos\\opencode", "C:/Repos/opencode")).toBeUndefined()
  })

  test("routes a different directory to that directory (not current)", () => {
    expect(selectTargetDirectory(context, "/home/user/other")).toBe("/home/user/other")
  })
})
