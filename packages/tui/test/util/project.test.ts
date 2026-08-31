import { describe, expect, test } from "bun:test"
import { projectName } from "../../src/util/project"

describe("projectName", () => {
  test("falls back to the folder name for filesystem-root projects", () => {
    expect(projectName({ canonical: "/" }, "/home/user/Prabha")).toBe("Prabha")
    expect(projectName({ canonical: "C:\\" }, "C:\\Users\\user\\Desktop\\Prabha")).toBe("Prabha")
  })

  test("preserves backslashes in POSIX folder names", () => {
    expect(projectName({ canonical: "/tmp/foo\\bar" })).toBe("foo\\bar")
  })
})
