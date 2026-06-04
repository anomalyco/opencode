import { describe, expect, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { resolveOpenTuiSidecarPath } from "@/cli/opentui-native"

describe("resolveOpenTuiSidecarPath", () => {
  test("uses opencode.exe-adjacent opentui.dll on Windows", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-opentui-"))
    try {
      const exe = path.join(dir, "opencode.exe")
      const dll = path.join(dir, "opentui.dll")
      fs.writeFileSync(exe, "")
      fs.writeFileSync(dll, "")

      expect(resolveOpenTuiSidecarPath(exe, "win32")).toBe(dll)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test("ignores non-Windows platforms", () => {
    expect(resolveOpenTuiSidecarPath("/usr/bin/opencode", "linux")).toBeUndefined()
  })

  test("does not return a missing sidecar", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-opentui-"))
    try {
      expect(resolveOpenTuiSidecarPath(path.join(dir, "opencode.exe"), "win32")).toBeUndefined()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
