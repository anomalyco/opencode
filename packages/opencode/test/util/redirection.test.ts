import { describe, expect, test } from "bun:test"
import { normalizeNul } from "../../src/util/redirection"

describe("util.redirection", () => {
  test("rewrites nul redirect targets on non-windows", () => {
    expect(normalizeNul("dir /s *.dll >nul 2>&1", "linux")).toBe("dir /s *.dll >/dev/null 2>&1")
    expect(normalizeNul("echo hi 2> NUL", "linux")).toBe("echo hi 2> /dev/null")
    expect(normalizeNul("echo hi >> 'nul'", "linux")).toBe("echo hi >> /dev/null")
    expect(normalizeNul("dir /s *.dll >nul 2>&1", "win32")).toBe("dir /s *.dll >nul 2>&1")
  })

  test("does not touch ordinary file paths", () => {
    expect(normalizeNul("cat ./nul.txt", "linux")).toBe("cat ./nul.txt")
    expect(normalizeNul("echo hi > ./nul", "linux")).toBe("echo hi > ./nul")
  })
})
