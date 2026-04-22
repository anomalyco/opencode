import { describe, expect, it } from "bun:test"
import { ParseCommand } from "../../src/acp/parse-command"

describe("ParseCommand", () => {
  describe("format", () => {
    it("uses description as title when provided", () => {
      const result = ParseCommand.format("ls", "List files in current directory", "/home/user")
      expect(result.title).toBe("List files in current directory")
      expect(result.kind).toBe("other")
    })

    it("falls back to command when no description", () => {
      const result = ParseCommand.format("ls -la", "", "/home/user")
      expect(result.title).toBe("ls -la")
    })

    it("includes cwd in locations", () => {
      const result = ParseCommand.format("ls", "List files", "/home/user")
      expect(result.locations).toEqual([{ path: "/home/user" }])
    })

    it("handles empty cwd", () => {
      const result = ParseCommand.format("ls", "List files", "")
      expect(result.locations).toEqual([])
    })

    it("sets terminalOutput to true", () => {
      const result = ParseCommand.format("npm install", "Install dependencies", "/home/user")
      expect(result.terminalOutput).toBe(true)
    })
  })
})
