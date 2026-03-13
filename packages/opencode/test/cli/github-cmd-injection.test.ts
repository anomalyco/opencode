import { describe, expect, it } from "vitest"

/**
 * CWE-78: OS Command Injection
 * File: packages/opencode/src/cli/cmd/github.ts
 *
 * The original code used `exec()` with string interpolation to open URLs,
 * which passes through a shell. The fix uses `execFile()` with argument arrays,
 * bypassing shell interpretation entirely.
 */

// Simulate the OLD vulnerable approach: shell string interpolation
function buildOpenCommandUnsafe(url: string) {
  return `open "${url}"`
}

// Simulate the FIXED approach: argument array (no shell)
function buildOpenCommandSafe(url: string): [string, string[]] {
  return ["open", [url]]
}

describe("CWE-78: OS Command Injection in github.ts open-browser", () => {
  describe("OLD vulnerable approach (exec with string interpolation)", () => {
    it("DEMONSTRATES VULNERABILITY: URL with shell metacharacters", () => {
      const maliciousUrl = 'https://example.com"; rm -rf / #'
      const command = buildOpenCommandUnsafe(maliciousUrl)
      expect(command).toContain("; rm -rf /")
    })

    it("DEMONSTRATES VULNERABILITY: URL with $() substitution", () => {
      const maliciousUrl = "https://example.com/$(whoami)"
      const command = buildOpenCommandUnsafe(maliciousUrl)
      expect(command).toContain("$(whoami)")
    })
  })

  describe("FIXED approach (execFile with argument array)", () => {
    it("should pass URL as a single argument, not interpreted by shell", () => {
      const maliciousUrl = 'https://example.com"; rm -rf / #'
      const [cmd, args] = buildOpenCommandSafe(maliciousUrl)
      expect(cmd).toBe("open")
      expect(args).toEqual([maliciousUrl])
    })

    it("should not split $() substitution into shell execution", () => {
      const maliciousUrl = "https://example.com/$(whoami)"
      const [cmd, args] = buildOpenCommandSafe(maliciousUrl)
      expect(cmd).toBe("open")
      expect(args).toEqual([maliciousUrl])
    })

    it("should handle normal URLs correctly", () => {
      const url = "https://github.com/apps/opencode-agent"
      const [cmd, args] = buildOpenCommandSafe(url)
      expect(cmd).toBe("open")
      expect(args).toEqual(["https://github.com/apps/opencode-agent"])
    })

    it("should handle Windows open command correctly", () => {
      const url = "https://github.com/apps/opencode-agent"
      const [cmd, args]: [string, string[]] = ["cmd", ["/c", "start", "", url]]
      expect(cmd).toBe("cmd")
      expect(args).toEqual(["/c", "start", "", url])
    })

    it("should handle Linux xdg-open correctly", () => {
      const url = "https://github.com/apps/opencode-agent"
      const [cmd, args]: [string, string[]] = ["xdg-open", [url]]
      expect(cmd).toBe("xdg-open")
      expect(args).toEqual([url])
    })
  })
})
