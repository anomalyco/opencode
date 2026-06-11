import { describe, expect, test } from "bun:test"
import { openDefaultPath } from "./open-path"

describe("open default path", () => {
  test("resolves when Electron reports success", async () => {
    await expect(openDefaultPath(() => Promise.resolve(""), "C:\\repo")).resolves.toBeUndefined()
  })

  test("rejects Electron openPath error messages", async () => {
    await expect(openDefaultPath(() => Promise.resolve("Windows cannot find the path."), "C:\\repo")).rejects.toThrow(
      "Windows cannot find the path.",
    )
  })

  test("preserves Electron openPath rejections", async () => {
    await expect(openDefaultPath(() => Promise.reject(new Error("open failed")), "C:\\repo")).rejects.toThrow(
      "open failed",
    )
  })
})
