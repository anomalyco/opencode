import { describe, expect, test } from "bun:test"
import os from "os"
import path from "path"

function isUnsupportedByFff(directory: string): boolean {
  const resolved = path.resolve(directory)
  const home = os.homedir()
  if (resolved === home || resolved === path.dirname(home)) return true
  if (process.platform !== "win32" && resolved === "/") return true
  return false
}

describe("isUnsupportedByFff (inline mirror of search.ts helper)", () => {
  test("returns true for the user's home directory", () => {
    expect(isUnsupportedByFff(os.homedir())).toBe(true)
  })

  test("returns true for the parent of home (e.g. '/' on macOS)", () => {
    const home = os.homedir()
    if (home === path.dirname(home)) return
    expect(isUnsupportedByFff(path.dirname(home))).toBe(true)
  })

  test("returns true for filesystem root on non-windows", () => {
    if (process.platform === "win32") return
    expect(isUnsupportedByFff("/")).toBe(true)
  })

  test("returns false for a normal project directory", () => {
    expect(isUnsupportedByFff("/tmp/some-project")).toBe(false)
    expect(isUnsupportedByFff("/home/user/projects/foo")).toBe(false)
  })

  test("resolves relative paths before checking without throwing", () => {
    expect(() => isUnsupportedByFff(".")).not.toThrow()
    expect(() => isUnsupportedByFff("./subdir")).not.toThrow()
  })

  test("returns false for an empty path (resolves to cwd)", () => {
    expect(isUnsupportedByFff("")).toBe(process.cwd() === os.homedir())
  })
})
