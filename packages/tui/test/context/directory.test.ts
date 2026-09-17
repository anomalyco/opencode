import { describe, expect, test } from "bun:test"
import path from "node:path"
import { resolveDisplayDirectory } from "../../src/context/directory"

describe("resolveDisplayDirectory", () => {
  const home = process.platform === "win32" ? "C:\\Users\\tester" : "/home/tester"
  const defaultDir = path.join(home, "default-repo")
  const movedDir = path.join(home, "another-project", "sub")

  test("uses sessionDirectory when active (fixing #43938 stale directory indicator)", () => {
    const result = resolveDisplayDirectory({
      sessionDirectory: movedDir,
      instanceDirectory: defaultDir,
      cwd: defaultDir,
      home,
    })

    const expected = "~" + path.sep + path.join("another-project", "sub")
    expect(result).toBe(expected)
  })

  test("falls back to instanceDirectory when not inside a session", () => {
    const result = resolveDisplayDirectory({
      sessionDirectory: undefined,
      instanceDirectory: defaultDir,
      cwd: defaultDir,
      home,
    })

    const expected = "~" + path.sep + "default-repo"
    expect(result).toBe(expected)
  })

  test("appends git branch when available", () => {
    const result = resolveDisplayDirectory({
      sessionDirectory: defaultDir,
      instanceDirectory: defaultDir,
      cwd: defaultDir,
      home,
      branch: "feature-branch",
    })

    const expected = "~" + path.sep + "default-repo:feature-branch"
    expect(result).toBe(expected)
  })
})
