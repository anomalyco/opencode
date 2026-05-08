import { describe, expect, test } from "bun:test"

import { resolveWindowsAppPath } from "./apps"

describe("desktop app resolution", () => {
  test("resolveWindowsAppPath awaits where.exe output", async () => {
    const path = await resolveWindowsAppPath("opencode", async () => ({
      stdout: "C:\\Users\\test\\AppData\\Local\\Programs\\OpenCode\\OpenCode.exe\r\n",
      stderr: "",
    }))

    expect(path).toBe("C:\\Users\\test\\AppData\\Local\\Programs\\OpenCode\\OpenCode.exe")
  })
})
