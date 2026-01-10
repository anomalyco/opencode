import { test, expect, describe } from "bun:test"
import { CollaborationDirectives } from "./directives"
import type { Collaboration } from "./types"

describe("CollaborationDirectives", () => {
  const mockParticipants: Record<string, Collaboration.Participant> = {
    clb_123: {
      id: "clb_123",
      sessionID: "ses_abc",
      name: "alice",
      role: "driver",
      time: { joined: Date.now(), lastSeen: Date.now() },
    },
    clb_456: {
      id: "clb_456",
      sessionID: "ses_abc",
      name: "bob",
      role: "participant",
      time: { joined: Date.now(), lastSeen: Date.now() },
    },
    clb_789: {
      id: "clb_789",
      sessionID: "ses_abc",
      name: "Charlie",
      role: "participant",
      time: { joined: Date.now(), lastSeen: Date.now() },
    },
  }

  describe("parse", () => {
    test("parses ~all as a wait directive", () => {
      const directives = CollaborationDirectives.parse("Let's all discuss this ~all", mockParticipants)
      expect(directives).toHaveLength(1)
      expect(directives[0]).toEqual({
        type: "wait",
        target: "all",
        resolved: false,
      })
    })

    test("parses ~alice as a wait directive when alice is a participant", () => {
      const directives = CollaborationDirectives.parse("What do you think ~alice?", mockParticipants)
      expect(directives).toHaveLength(1)
      expect(directives[0]).toEqual({
        type: "wait",
        target: "alice",
        resolved: false,
      })
    })

    test("parses participant names case-insensitively", () => {
      const directives = CollaborationDirectives.parse("Hey ~Charlie, what's up?", mockParticipants)
      expect(directives).toHaveLength(1)
      expect(directives[0]).toEqual({
        type: "wait",
        target: "charlie",
        resolved: false,
      })
    })

    test("parses multiple directives", () => {
      const directives = CollaborationDirectives.parse(
        "~alice and ~bob, let's discuss this",
        mockParticipants,
      )
      expect(directives).toHaveLength(2)
      expect(directives[0].target).toBe("alice")
      expect(directives[1].target).toBe("bob")
    })

    test("treats unknown targets as mentions (not waits)", () => {
      const directives = CollaborationDirectives.parse("Hey ~unknown, join us!", mockParticipants)
      expect(directives).toHaveLength(1)
      expect(directives[0]).toEqual({
        type: "mention",
        target: "unknown",
        resolved: true,
      })
    })

    test("returns empty array for text without directives", () => {
      const directives = CollaborationDirectives.parse("No directives here", mockParticipants)
      expect(directives).toHaveLength(0)
    })

    test("handles multiple occurrences of same directive", () => {
      const directives = CollaborationDirectives.parse("~alice please ~alice", mockParticipants)
      expect(directives).toHaveLength(2)
    })
  })

  describe("hasUnresolvedWaits", () => {
    test("returns true when there are unresolved wait directives", () => {
      const directives: Collaboration.Directive[] = [
        { type: "wait", target: "alice", resolved: false },
        { type: "mention", target: "bob", resolved: true },
      ]
      expect(CollaborationDirectives.hasUnresolvedWaits(directives)).toBe(true)
    })

    test("returns false when all wait directives are resolved", () => {
      const directives: Collaboration.Directive[] = [
        { type: "wait", target: "alice", resolved: true },
        { type: "mention", target: "bob", resolved: true },
      ]
      expect(CollaborationDirectives.hasUnresolvedWaits(directives)).toBe(false)
    })

    test("returns false for empty array", () => {
      expect(CollaborationDirectives.hasUnresolvedWaits([])).toBe(false)
    })

    test("returns false when only mentions exist", () => {
      const directives: Collaboration.Directive[] = [
        { type: "mention", target: "unknown", resolved: true },
      ]
      expect(CollaborationDirectives.hasUnresolvedWaits(directives)).toBe(false)
    })
  })

  describe("stripDirectives", () => {
    test("removes directives from text", () => {
      const result = CollaborationDirectives.stripDirectives("Hey ~alice, what do you think?")
      expect(result).toBe("Hey , what do you think?")
    })

    test("handles multiple directives", () => {
      const result = CollaborationDirectives.stripDirectives("~alice ~bob let's go ~all")
      expect(result).toBe("let's go")
    })

    test("returns original text if no directives", () => {
      const result = CollaborationDirectives.stripDirectives("No directives here")
      expect(result).toBe("No directives here")
    })
  })

  describe("extractTargets", () => {
    test("extracts all targets from text", () => {
      const targets = CollaborationDirectives.extractTargets("~alice ~bob ~all")
      expect(targets).toEqual(["alice", "bob", "all"])
    })

    test("returns lowercase targets", () => {
      const targets = CollaborationDirectives.extractTargets("~Alice ~BOB")
      expect(targets).toEqual(["alice", "bob"])
    })

    test("returns empty array for no directives", () => {
      const targets = CollaborationDirectives.extractTargets("No directives")
      expect(targets).toEqual([])
    })
  })

  describe("hasDirectives", () => {
    test("returns true for text with directives", () => {
      expect(CollaborationDirectives.hasDirectives("Hey ~alice")).toBe(true)
    })

    test("returns false for text without directives", () => {
      expect(CollaborationDirectives.hasDirectives("No directives here")).toBe(false)
    })

    test("returns true for ~all", () => {
      expect(CollaborationDirectives.hasDirectives("~all")).toBe(true)
    })
  })
})
