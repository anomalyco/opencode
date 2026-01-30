import { describe, expect, test } from "bun:test"
import { Coach } from "../../src/autonomous/coach"
import { Player } from "../../src/autonomous/player"
import { AutonomousTypes } from "../../src/autonomous/types"
import { Autonomous } from "../../src/autonomous"

describe("Coach", () => {
  test("prompt generates correct review prompt", () => {
    const requirements = "Build a hello world CLI"
    const prompt = Coach.prompt(requirements)

    expect(prompt).toContain("COACH/REVIEW MODE")
    expect(prompt).toContain(requirements)
    expect(prompt).toContain(AutonomousTypes.APPROVAL_SIGNAL)
    expect(prompt).toContain("INSTRUCTIONS")
  })

  test("extractFeedback detects approval signal", () => {
    const approved = Coach.extractFeedback(`After review, everything looks good. ${AutonomousTypes.APPROVAL_SIGNAL}`)
    expect(approved.approved).toBe(true)
    expect(approved.feedback).toBe("")
  })

  test("extractFeedback extracts feedback when not approved", () => {
    const feedback = "1. Missing error handling\n2. Tests not passing"
    const result = Coach.extractFeedback(feedback)
    expect(result.approved).toBe(false)
    expect(result.feedback).toBe(feedback)
  })

  test("extractFeedback trims whitespace", () => {
    const feedback = "  Some feedback with whitespace  \n"
    const result = Coach.extractFeedback(feedback)
    expect(result.feedback).toBe("Some feedback with whitespace")
  })
})

describe("Player", () => {
  test("prompt generates implementation prompt for first turn", () => {
    const requirements = "Build a hello world CLI"
    const prompt = Player.prompt({ requirements, coachFeedback: "", turn: 1 })

    expect(prompt).toContain("IMPLEMENTATION MODE")
    expect(prompt).toContain(requirements)
    expect(prompt).toContain("TODO list")
    expect(prompt).not.toContain("coach")
  })

  test("prompt includes coach feedback for subsequent turns", () => {
    const requirements = "Build a hello world CLI"
    const coachFeedback = "Missing error handling"
    const prompt = Player.prompt({ requirements, coachFeedback, turn: 2 })

    expect(prompt).toContain("IMPLEMENTATION MODE")
    expect(prompt).toContain(coachFeedback)
    expect(prompt).toContain("coach")
    expect(prompt).toContain("Original requirements")
  })

  test("prompt without feedback on turn 1 uses initial prompt", () => {
    const requirements = "Build a hello world CLI"
    const prompt1 = Player.prompt({ requirements, coachFeedback: "", turn: 1 })
    const prompt2 = Player.prompt({ requirements, coachFeedback: "", turn: 2 })

    // Both should use initial prompt when no feedback
    expect(prompt1).toContain("TODO list")
    expect(prompt2).toContain("TODO list")
  })
})

describe("AutonomousTypes", () => {
  test("Config has correct defaults", () => {
    const config = AutonomousTypes.Config.parse({})
    expect(config.maxTurns).toBe(5)
    expect(config.playerTimeout).toBe(300000)
    expect(config.coachTimeout).toBe(180000)
    expect(config.playerModel).toBeUndefined()
    expect(config.coachModel).toBeUndefined()
  })

  test("Config accepts custom values", () => {
    const config = AutonomousTypes.Config.parse({
      maxTurns: 10,
      playerModel: { providerID: "openai", modelID: "gpt-4" },
      coachModel: { providerID: "anthropic", modelID: "claude-3" },
    })
    expect(config.maxTurns).toBe(10)
    expect(config.playerModel?.providerID).toBe("openai")
    expect(config.coachModel?.providerID).toBe("anthropic")
  })

  test("APPROVAL_SIGNAL is defined", () => {
    expect(AutonomousTypes.APPROVAL_SIGNAL).toBe("IMPLEMENTATION_APPROVED")
  })
})

describe("Autonomous.formatReport", () => {
  test("formats successful result", () => {
    const result: AutonomousTypes.RunResult = {
      success: true,
      turns: 2,
      sessionID: "session_123",
      coachSessionID: "session_456",
      metrics: [
        {
          turn: 1,
          playerTokens: 1000,
          coachTokens: 500,
          playerDuration: 5000,
          coachDuration: 3000,
          feedbackLength: 100,
        },
        {
          turn: 2,
          playerTokens: 800,
          coachTokens: 400,
          playerDuration: 4000,
          coachDuration: 2000,
          feedbackLength: 0,
        },
      ],
    }

    const report = Autonomous.formatReport(result)

    expect(report).toContain("AUTONOMOUS MODE SESSION REPORT")
    expect(report).toContain("Total Turns: 2")
    expect(report).toContain("APPROVED")
    expect(report).toContain("session_123")
    expect(report).toContain("session_456")
    expect(report).toContain("Turn 1")
    expect(report).toContain("Turn 2")
  })

  test("formats failed result", () => {
    const result: AutonomousTypes.RunResult = {
      success: false,
      turns: 5,
      sessionID: "session_789",
      metrics: [],
    }

    const report = Autonomous.formatReport(result)

    expect(report).toContain("MAX_TURNS_REACHED")
    expect(report).toContain("Total Turns: 5")
  })
})
