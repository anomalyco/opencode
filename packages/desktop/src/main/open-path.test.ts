import { describe, expect, test } from "bun:test"
import { openInDefaultApp } from "./open-path"

describe("opening paths in the default app", () => {
  test("rejects the opener's error message so callers can report the failure", async () => {
    await expect(openInDefaultApp("/missing/project", async () => "Failed to open path")).rejects.toThrow(
      "Failed to open path",
    )
  })

  test("opens the requested path successfully", async () => {
    const paths: string[] = []
    await expect(
      openInDefaultApp("/project with spaces", async (path) => {
        paths.push(path)
        return ""
      }),
    ).resolves.toBe("")
    expect(paths).toEqual(["/project with spaces"])
  })

  test("preserves a rejected opener error", async () => {
    const error = new Error("Opener unavailable")
    await expect(
      openInDefaultApp("/project", async () => {
        throw error
      }),
    ).rejects.toBe(error)
  })
})
