import { describe, test, expect } from "bun:test"
import { readFileSync } from "fs"
import { resolve } from "path"

describe("session routes naming conventions", () => {
  // Regression: the /exec endpoint used `sessionID` (uppercase D) in metadata
  // objects, but the TUI Task component and the built-in TaskTool both read
  // `metadata.sessionId` (lowercase d). The mismatch silently broke child-session
  // click navigation and sync. This test ensures the correct lowercase key is
  // always used inside metadata literals.
  test("exec metadata uses sessionId (lowercase d) not sessionID (uppercase D)", () => {
    const src = readFileSync(resolve(import.meta.dir, "../../src/server/routes/session.ts"), "utf-8")

    // Must not find uppercase-D form inside a metadata object literal
    const upper = [...src.matchAll(/metadata:\s*\{[^}]*sessionID\b/g)]
    expect(upper.length).toBe(0)

    // Must find the correct lowercase-d form (currently 3 occurrences in /exec)
    const lower = [...src.matchAll(/metadata:\s*\{[^}]*sessionId\b/g)]
    expect(lower.length).toBeGreaterThan(0)
  })
})
