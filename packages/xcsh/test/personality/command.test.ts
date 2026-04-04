import { describe, expect, test, beforeEach } from "bun:test"
import { Personality } from "../../src/personality"

describe("Personality session state", () => {
  const SESSION_A = "session-a"
  const SESSION_B = "session-b"

  beforeEach(() => {
    // Clear any lingering session state
    Personality.clearSession(SESSION_A)
    Personality.clearSession(SESSION_B)
  })

  test("getSession returns undefined when no personality is set", () => {
    expect(Personality.getSession(SESSION_A)).toBeUndefined()
  })

  test("setSession stores personality for a session", () => {
    Personality.setSession(SESSION_A, "concise")
    expect(Personality.getSession(SESSION_A)).toBe("concise")
  })

  test("clearSession removes personality for a session", () => {
    Personality.setSession(SESSION_A, "technical")
    Personality.clearSession(SESSION_A)
    expect(Personality.getSession(SESSION_A)).toBeUndefined()
  })

  test("sessions are isolated from each other", () => {
    Personality.setSession(SESSION_A, "concise")
    Personality.setSession(SESSION_B, "technical")
    expect(Personality.getSession(SESSION_A)).toBe("concise")
    expect(Personality.getSession(SESSION_B)).toBe("technical")
  })

  test("overwriting a session personality replaces it", () => {
    Personality.setSession(SESSION_A, "concise")
    Personality.setSession(SESSION_A, "formal")
    expect(Personality.getSession(SESSION_A)).toBe("formal")
  })
})

describe("Personality.handleCommand", () => {
  const SESSION = "test-session-cmd"

  beforeEach(() => Personality.clearSession(SESSION))

  test("handleCommand with known name sets session and returns confirmation", () => {
    const result = Personality.handleCommand(SESSION, "concise", {})
    expect(result.ok).toBe(true)
    expect(result.message).toContain("concise")
    expect(Personality.getSession(SESSION)).toBe("concise")
  })

  test("handleCommand with 'none' clears session", () => {
    Personality.setSession(SESSION, "technical")
    const result = Personality.handleCommand(SESSION, "none", {})
    expect(result.ok).toBe(true)
    expect(Personality.getSession(SESSION)).toBeUndefined()
  })

  test("handleCommand with 'default' clears session", () => {
    Personality.setSession(SESSION, "formal")
    const result = Personality.handleCommand(SESSION, "default", {})
    expect(result.ok).toBe(true)
    expect(Personality.getSession(SESSION)).toBeUndefined()
  })

  test("handleCommand with unknown name returns error", () => {
    const result = Personality.handleCommand(SESSION, "does-not-exist", {})
    expect(result.ok).toBe(false)
    expect(result.message).toContain("does-not-exist")
  })

  test("handleCommand with 'show' returns current personality name", () => {
    Personality.setSession(SESSION, "teacher")
    const result = Personality.handleCommand(SESSION, "show", {})
    expect(result.ok).toBe(true)
    expect(result.message).toContain("teacher")
  })

  test("handleCommand with 'show' when none set reports no active personality", () => {
    const result = Personality.handleCommand(SESSION, "show", {})
    expect(result.ok).toBe(true)
    expect(result.message).toMatch(/none|no active|default/i)
  })

  test("handleCommand with empty string lists available personalities", () => {
    const result = Personality.handleCommand(SESSION, "", {})
    expect(result.ok).toBe(true)
    // Should list built-in presets
    expect(result.message).toContain("concise")
    expect(result.message).toContain("technical")
  })
})
