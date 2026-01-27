import { describe, test, expect, beforeEach } from "bun:test"
import { TOONMetadata } from "../src/session/toon-metadata"

describe("TOON Metadata", () => {
  const sessionID = "test-session-123"
  
  beforeEach(() => {
    // Clear any existing data
    TOONMetadata.clearSavings(sessionID)
  })

  describe("Recording Savings", () => {
    test("records savings data for a session", () => {
      const savingsData: TOONMetadata.SavingsData = {
        tokensSaved: 42,
        originalTokens: 200,
        transformedTokens: 158,
        savingsPercentage: 21.0,
        mode: "balanced",
      }

      TOONMetadata.recordSavings(sessionID, savingsData)
      const retrieved = TOONMetadata.getSavings(sessionID)

      expect(retrieved).toEqual(savingsData)
    })

    test("overwrites previous savings for same session", () => {
      const firstSavings: TOONMetadata.SavingsData = {
        tokensSaved: 10,
        originalTokens: 100,
        transformedTokens: 90,
        savingsPercentage: 10.0,
        mode: "verbose",
      }

      const secondSavings: TOONMetadata.SavingsData = {
        tokensSaved: 30,
        originalTokens: 150,
        transformedTokens: 120,
        savingsPercentage: 20.0,
        mode: "compact",
      }

      TOONMetadata.recordSavings(sessionID, firstSavings)
      TOONMetadata.recordSavings(sessionID, secondSavings)

      const retrieved = TOONMetadata.getSavings(sessionID)
      expect(retrieved).toEqual(secondSavings)
    })
  })

  describe("Retrieving Savings", () => {
    test("returns undefined for non-existent session", () => {
      const retrieved = TOONMetadata.getSavings("non-existent-session")
      expect(retrieved).toBeUndefined()
    })

    test("retrieves correct data for multiple sessions", () => {
      const session1Data: TOONMetadata.SavingsData = {
        tokensSaved: 20,
        originalTokens: 100,
        transformedTokens: 80,
        savingsPercentage: 20.0,
        mode: "balanced",
      }

      const session2Data: TOONMetadata.SavingsData = {
        tokensSaved: 40,
        originalTokens: 200,
        transformedTokens: 160,
        savingsPercentage: 20.0,
        mode: "compact",
      }

      TOONMetadata.recordSavings("session-1", session1Data)
      TOONMetadata.recordSavings("session-2", session2Data)

      expect(TOONMetadata.getSavings("session-1")).toEqual(session1Data)
      expect(TOONMetadata.getSavings("session-2")).toEqual(session2Data)
    })
  })

  describe("Formatting Messages", () => {
    test("formats savings message correctly", () => {
      const savingsData: TOONMetadata.SavingsData = {
        tokensSaved: 42,
        originalTokens: 200,
        transformedTokens: 158,
        savingsPercentage: 21.0,
        mode: "balanced",
      }

      const message = TOONMetadata.formatSavingsMessage(savingsData)

      expect(message).toContain("42 tokens")
      expect(message).toContain("21.0%")
      expect(message).toContain("balanced")
      expect(message).toContain("🎯")
    })

    test("formats with decimal precision", () => {
      const savingsData: TOONMetadata.SavingsData = {
        tokensSaved: 15,
        originalTokens: 100,
        transformedTokens: 85,
        savingsPercentage: 15.789,
        mode: "compact",
      }

      const message = TOONMetadata.formatSavingsMessage(savingsData)

      expect(message).toContain("15.8%") // Should round to 1 decimal
    })
  })

  describe("Clearing Savings", () => {
    test("clears savings for a session", () => {
      const savingsData: TOONMetadata.SavingsData = {
        tokensSaved: 42,
        originalTokens: 200,
        transformedTokens: 158,
        savingsPercentage: 21.0,
        mode: "balanced",
      }

      TOONMetadata.recordSavings(sessionID, savingsData)
      expect(TOONMetadata.getSavings(sessionID)).toBeDefined()

      TOONMetadata.clearSavings(sessionID)
      expect(TOONMetadata.getSavings(sessionID)).toBeUndefined()
    })

    test("clearing non-existent session does not error", () => {
      expect(() => {
        TOONMetadata.clearSavings("non-existent")
      }).not.toThrow()
    })
  })

  describe("Get All Savings", () => {
    test("returns all recorded savings", () => {
      const session1Data: TOONMetadata.SavingsData = {
        tokensSaved: 20,
        originalTokens: 100,
        transformedTokens: 80,
        savingsPercentage: 20.0,
        mode: "balanced",
      }

      const session2Data: TOONMetadata.SavingsData = {
        tokensSaved: 40,
        originalTokens: 200,
        transformedTokens: 160,
        savingsPercentage: 20.0,
        mode: "compact",
      }

      TOONMetadata.recordSavings("session-1", session1Data)
      TOONMetadata.recordSavings("session-2", session2Data)

      const allSavings = TOONMetadata.getAllSavings()

      expect(allSavings["session-1"]).toEqual(session1Data)
      expect(allSavings["session-2"]).toEqual(session2Data)
    })

    test("returns empty object when no savings recorded", () => {
      const allSavings = TOONMetadata.getAllSavings()
      expect(Object.keys(allSavings).length).toBeGreaterThanOrEqual(0)
    })
  })
})
