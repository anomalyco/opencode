import { describe, expect, test } from "bun:test"
import { getKiroDbPath } from "../../src/plugin/kiro"

describe("plugin.kiro", () => {
  describe("getKiroDbPath", () => {
    test("returns correct path for macOS", () => {
      // Note: This test will only pass on macOS
      if (process.platform === "darwin") {
        const path = getKiroDbPath()
        expect(path).toContain("Library/Application Support/kiro-cli/data.sqlite3")
        expect(path).toMatch(/^\/Users\//)
      }
    })

    test("returns correct path for Windows", () => {
      // Note: This test will only pass on Windows
      if (process.platform === "win32") {
        const path = getKiroDbPath()
        expect(path).toContain("kiro-cli/data.sqlite3")
        expect(path).toContain("AppData")
      }
    })

    test("returns correct path for Linux", () => {
      // Note: This test will only pass on Linux
      if (process.platform === "linux") {
        const path = getKiroDbPath()
        expect(path).toContain(".local/share/kiro-cli/data.sqlite3")
      }
    })

    test("returns a non-empty string", () => {
      const path = getKiroDbPath()
      expect(typeof path).toBe("string")
      expect(path.length).toBeGreaterThan(0)
      expect(path).toContain("kiro-cli")
      expect(path).toContain("data.sqlite3")
    })
  })
})
