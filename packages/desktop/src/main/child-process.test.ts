import { describe, expect, test } from "bun:test"
import { hiddenExecFileOptions, hiddenSpawnOptions } from "./child-process"

describe("child-process", () => {
  test("hiddenExecFileOptions adds windowsHide on win32", () => {
    const original = process.platform
    try {
      Object.defineProperty(process, "platform", { value: "win32" })
      expect(hiddenExecFileOptions({})).toEqual({ windowsHide: true })
      expect(hiddenExecFileOptions({ windowsHide: false })).toEqual({ windowsHide: false })
    } finally {
      Object.defineProperty(process, "platform", { value: original })
    }
  })

  test("hiddenSpawnOptions adds windowsHide on win32", () => {
    const original = process.platform
    try {
      Object.defineProperty(process, "platform", { value: "win32" })
      expect(hiddenSpawnOptions({ stdio: "ignore" })).toEqual({ stdio: "ignore", windowsHide: true })
    } finally {
      Object.defineProperty(process, "platform", { value: original })
    }
  })
})
