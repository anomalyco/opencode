import { describe, expect, test } from "bun:test"
import { revealProject } from "./reveal"

describe("reveal project", () => {
  test("keeps a project when its directory is revealed", async () => {
    const removed: string[] = []
    expect(
      await revealProject({
        directory: "/projects/current",
        reveal: async () => true,
        remove: (directory) => removed.push(directory),
      }),
    ).toBe(true)
    expect(removed).toEqual([])
  })

  test("removes a project when its directory no longer exists", async () => {
    const removed: string[] = []
    expect(
      await revealProject({
        directory: "/projects/missing",
        reveal: async () => false,
        remove: (directory) => removed.push(directory),
      }),
    ).toBe(false)
    expect(removed).toEqual(["/projects/missing"])
  })
})
