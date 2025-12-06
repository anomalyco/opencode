/**
 * Unit Test: Mode Management
 *
 * Tests mode state handling and current_mode_update notification translation
 * using fixtures (no live agent required)
 */

import { describe, expect, test } from "bun:test"
import { ACPClient } from "../../../src/acp/client"
import type { SessionModeState, SessionModeId, NewSessionResponse } from "@agentclientprotocol/sdk"
import modeFixtures from "../fixtures/data/mode-notifications.json"

describe("Mode Management (unit)", () => {
  describe("SessionModeState handling", () => {
    test("should parse mode state from NewSessionResponse", () => {
      const fixtureData = modeFixtures.events.find(e => e.type === "initial_session_modes")
      expect(fixtureData).toBeTruthy()

      const modes = fixtureData!.modes as SessionModeState

      // Verify structure
      expect(modes.currentModeId).toBe("default")
      expect(modes.availableModes).toBeInstanceOf(Array)
      expect(modes.availableModes.length).toBe(4)

      // Verify mode details
      const defaultMode = modes.availableModes.find(m => m.id === "default")
      expect(defaultMode).toBeTruthy()
      expect(defaultMode!.name).toBe("Always Ask")
      expect(defaultMode!.description).toBeTruthy()

      const planMode = modes.availableModes.find(m => m.id === "plan")
      expect(planMode).toBeTruthy()
      expect(planMode!.name).toBe("Plan Mode")
    })

    test("should validate all mode IDs are strings", () => {
      const fixtureData = modeFixtures.events.find(e => e.type === "initial_session_modes")
      const modes = fixtureData!.modes as SessionModeState

      expect(typeof modes.currentModeId).toBe("string")
      modes.availableModes.forEach(mode => {
        expect(typeof mode.id).toBe("string")
        expect(typeof mode.name).toBe("string")
      })
    })

    test("should have current mode in available modes", () => {
      const fixtureData = modeFixtures.events.find(e => e.type === "initial_session_modes")
      const modes = fixtureData!.modes as SessionModeState

      const currentModeExists = modes.availableModes.some(
        m => m.id === modes.currentModeId
      )
      expect(currentModeExists).toBe(true)
    })
  })

  describe("current_mode_update notifications", () => {
    test("should parse mode change to 'plan' if present", () => {
      const modeUpdates = modeFixtures.events.filter(e => e.type === "current_mode_update")
      const planUpdate = modeUpdates.find(e =>
        e.notification.update.currentModeId === "plan"
      )

      if (planUpdate) {
        expect(planUpdate.notification.update.sessionUpdate).toBe("current_mode_update")
        expect(planUpdate.notification.update.currentModeId).toBe("plan")
      } else {
        // If fixture lacks plan updates, ensure we still have mode updates overall
        expect(modeUpdates.length).toBeGreaterThan(0)
      }
    })

    test("should parse mode change to 'acceptEdits'", () => {
      const modeUpdates = modeFixtures.events.filter(e => e.type === "current_mode_update")
      const acceptEditsUpdate = modeUpdates.find(e =>
        e.notification.update.currentModeId === "acceptEdits"
      )

      expect(acceptEditsUpdate).toBeTruthy()
      expect(acceptEditsUpdate!.notification.update.sessionUpdate).toBe("current_mode_update")
      expect(acceptEditsUpdate!.notification.update.currentModeId).toBe("acceptEdits")
    })

    test("should parse mode change back to 'default'", () => {
      const modeUpdates = modeFixtures.events.filter(e => e.type === "current_mode_update")
      const defaultUpdate = modeUpdates.find(e =>
        e.notification.update.currentModeId === "default" &&
        e.description.includes("back to")
      )

      expect(defaultUpdate).toBeTruthy()
      expect(defaultUpdate!.notification.update.currentModeId).toBe("default")
    })

    test("all mode updates should have valid structure", () => {
      const modeUpdates = modeFixtures.events.filter(e => e.type === "current_mode_update")

      expect(modeUpdates.length).toBeGreaterThan(0)

      modeUpdates.forEach(update => {
        expect(update.notification.sessionId).toBeTruthy()
        expect(update.notification.update.sessionUpdate).toBe("current_mode_update")
        expect(typeof update.notification.update.currentModeId).toBe("string")
        expect(update.notification.update.currentModeId.length).toBeGreaterThan(0)
      })
    })
  })

  describe("mode state transitions", () => {
    test("should validate mode transition sequence", () => {
      const modeUpdates = modeFixtures.events.filter(e => e.type === "current_mode_update")

      // Extract mode IDs in order
      const modeSequence = modeUpdates.map(e => e.notification.update.currentModeId)

      // Verify we have a sequence
      expect(modeSequence.length).toBeGreaterThanOrEqual(2)

      // Verify modes are valid
      const validModes = ["default", "acceptEdits", "plan", "bypassPermissions"]
      modeSequence.forEach(modeId => {
        expect(validModes).toContain(modeId)
      })
    })

    test("should handle modes as SessionModeId type", () => {
      const fixtureData = modeFixtures.events.find(e => e.type === "initial_session_modes")
      const modes = fixtureData!.modes as SessionModeState

      // Type assertion to verify SessionModeId compatibility
      const currentMode: SessionModeId = modes.currentModeId
      expect(typeof currentMode).toBe("string")

      modes.availableModes.forEach(mode => {
        const modeId: SessionModeId = mode.id
        expect(typeof modeId).toBe("string")
      })
    })
  })

  describe("mode metadata", () => {
    test("should include mode names and descriptions", () => {
      const fixtureData = modeFixtures.events.find(e => e.type === "initial_session_modes")
      const modes = fixtureData!.modes as SessionModeState

      modes.availableModes.forEach(mode => {
        expect(mode.name).toBeTruthy()
        expect(mode.name.length).toBeGreaterThan(0)

        // Description is optional per spec, but our fixtures include it
        if (mode.description !== undefined) {
          expect(typeof mode.description).toBe("string")
        }
      })
    })

    test("should have unique mode IDs", () => {
      const fixtureData = modeFixtures.events.find(e => e.type === "initial_session_modes")
      const modes = fixtureData!.modes as SessionModeState

      const modeIds = modes.availableModes.map(m => m.id)
      const uniqueIds = new Set(modeIds)

      expect(modeIds.length).toBe(uniqueIds.size)
    })
  })
})
