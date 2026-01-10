import { test, expect, describe, beforeEach, mock } from "bun:test"
import { CollaborationJoinCode } from "./join-code"

// Mock Instance.state to avoid needing full Instance context
const mockCodesMap = new Map()

mock.module("@/project/instance", () => ({
  Instance: {
    state: (init: () => any) => {
      return () => mockCodesMap
    },
  },
}))

// Mock CollaborationSession.getSession
const mockSessions = new Map()
mock.module("./index", () => ({
  CollaborationSession: {
    getSession: (sessionID: string) => {
      if (!mockSessions.has(sessionID)) {
        mockSessions.set(sessionID, {
          sessionID,
          participants: {},
          messageQueue: [],
          typingStatuses: {},
          pendingWaits: [],
        })
      }
      return mockSessions.get(sessionID)
    },
    Event: {
      JoinCodeCreated: { type: "collaboration.joincode.created" },
    },
  },
}))

// Mock Bus
mock.module("@/bus", () => ({
  Bus: {
    publish: () => {},
  },
}))

// Mock Log
mock.module("@/util/log", () => ({
  Log: {
    create: () => ({
      info: () => {},
      error: () => {},
    }),
  },
}))

describe("CollaborationJoinCode", () => {
  beforeEach(() => {
    mockCodesMap.clear()
    mockSessions.clear()
  })

  describe("formatCode", () => {
    test("formats 6-char code with dash", () => {
      expect(CollaborationJoinCode.formatCode("ABC123")).toBe("ABC-123")
    })

    test("returns code as-is if not 6 chars", () => {
      expect(CollaborationJoinCode.formatCode("AB")).toBe("AB")
      expect(CollaborationJoinCode.formatCode("ABCDEFGH")).toBe("ABCDEFGH")
    })
  })

  describe("parseCode", () => {
    test("removes dashes and uppercases", () => {
      expect(CollaborationJoinCode.parseCode("abc-123")).toBe("ABC123")
    })

    test("handles code without dashes", () => {
      expect(CollaborationJoinCode.parseCode("abc123")).toBe("ABC123")
    })

    test("handles multiple dashes", () => {
      expect(CollaborationJoinCode.parseCode("a-b-c-1-2-3")).toBe("ABC123")
    })
  })

  describe("getShareableLink", () => {
    test("generates default link", () => {
      const link = CollaborationJoinCode.getShareableLink("ABC123")
      expect(link).toBe("opencode://join/ABC123")
    })

    test("uses custom base URL", () => {
      const link = CollaborationJoinCode.getShareableLink("ABC123", "https://example.com")
      expect(link).toBe("https://example.com/ABC123")
    })
  })
})
