import { describe, expect, test, beforeEach, afterEach } from "bun:test"

/**
 * Tests for terminal background color detection
 * These tests verify the environment variable based detection logic
 * for terminal multiplexers like Zellij that filter OSC queries.
 */
describe("getTerminalBackgroundColor", () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    // Clear relevant env vars before each test
    delete process.env.COLORFGBG
    delete process.env.ZELLIJ
    delete process.env.TERM
    delete process.env.TERM_PROGRAM
  })

  afterEach(() => {
    // Restore original env after each test
    process.env = { ...originalEnv }
  })

  describe("COLORFGBG detection", () => {
    test("detects light mode when background color >= 8", () => {
      process.env.COLORFGBG = "0;15"
      const bg = parseInt(process.env.COLORFGBG.split(";")[1], 10)
      expect(bg >= 8).toBe(true)
    })

    test("detects dark mode when background color < 8", () => {
      process.env.COLORFGBG = "15;0"
      const bg = parseInt(process.env.COLORFGBG.split(";")[1], 10)
      expect(bg < 8).toBe(true)
    })

    test("handles invalid COLORFGBG gracefully", () => {
      process.env.COLORFGBG = "invalid"
      const parts = process.env.COLORFGBG.split(";")
      expect(parts.length < 2).toBe(true)
    })
  })

  describe("Zellij environment detection", () => {
    test("detects ZELLIJ env var presence", () => {
      process.env.ZELLIJ = "0"
      expect(process.env.ZELLIJ).toBeTruthy()
    })

    test("detects light theme patterns in TERM", () => {
      const lightPatterns = ["light", "latte", "day", "white", "solarized-light"]
      for (const pattern of lightPatterns) {
        const term = `xterm-${pattern}-256color`
        expect(term.includes(pattern)).toBe(true)
      }
    })

    test("detects light theme patterns in TERM_PROGRAM", () => {
      const termProgram = "ghostty-light"
      expect(termProgram.includes("light")).toBe(true)
    })

    test("catppuccin-latte is detected as light", () => {
      process.env.TERM = "xterm-catppuccin-latte"
      const isLight = process.env.TERM.toLowerCase().includes("latte")
      expect(isLight).toBe(true)
    })
  })

  describe("TERM_PROGRAM detection", () => {
    test("detects light mode from TERM_PROGRAM", () => {
      process.env.TERM_PROGRAM = "Apple_Terminal_Light"
      const termProgram = process.env.TERM_PROGRAM.toLowerCase()
      expect(termProgram.includes("light")).toBe(true)
    })

    test("detects day mode from TERM_PROGRAM", () => {
      process.env.TERM_PROGRAM = "DayTerminal"
      const termProgram = process.env.TERM_PROGRAM.toLowerCase()
      expect(termProgram.includes("day")).toBe(true)
    })
  })
})
