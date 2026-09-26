import { describe, expect, test } from "bun:test"
import { openPath } from "./open-path"

describe("openPath", () => {
  test("resolves without a value when the default application opens the path", async () => {
    const paths: string[] = []
    await expect(
      openPath("/project", undefined, async (path) => {
        paths.push(path)
        return ""
      }),
    ).resolves.toBeUndefined()
    expect(paths).toEqual(["/project"])
  })

  test("rejects when Electron resolves with an error message", async () => {
    await expect(openPath("/missing/project", undefined, async () => "Failed to open path")).rejects.toThrow(
      "Failed to open path",
    )
  })

  test("preserves rejected errors from the default application", async () => {
    const error = new Error("Application unavailable")
    await expect(
      openPath("/project", undefined, async () => {
        throw error
      }),
    ).rejects.toBe(error)
  })
})
