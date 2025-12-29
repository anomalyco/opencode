import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { EventStore } from "./index"
import { unlinkSync } from "fs"

describe("EventStore", () => {
  const testDbPath = ":memory:"
  let store: EventStore

  beforeEach(() => {
    store = EventStore.create(testDbPath)
  })

  afterEach(() => {
    store.close()
  })

  describe("append", () => {
    test("appends event and returns ULID offset", () => {
      const sessionId = "test-session-1"
      const event = { type: "test.event", data: { foo: "bar" } }

      const offset1 = store.append(sessionId, event)
      const offset2 = store.append(sessionId, event)

      // ULID offsets should be lexicographically sortable
      expect(offset1.localeCompare(offset2)).toBeLessThan(0)
      expect(offset1).toMatch(/^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{26}$/)
      expect(offset2).toMatch(/^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{26}$/)
    })

    test("appends events to different sessions independently", () => {
      const event = { type: "test.event", data: {} }

      const offset1 = store.append("session-1", event)
      const offset2 = store.append("session-2", event)

      expect(offset1).not.toBe(offset2)
    })
  })

  describe("query", () => {
    test("returns all events when fromOffset is '-1'", () => {
      const sessionId = "test-session"
      const event1 = { type: "event.1", data: { n: 1 } }
      const event2 = { type: "event.2", data: { n: 2 } }
      const event3 = { type: "event.3", data: { n: 3 } }

      store.append(sessionId, event1)
      store.append(sessionId, event2)
      store.append(sessionId, event3)

      const events = store.query(sessionId, "-1")

      expect(events).toHaveLength(3)
      expect(events[0].event).toEqual(event1)
      expect(events[1].event).toEqual(event2)
      expect(events[2].event).toEqual(event3)
    })

    test("returns events from specified offset onwards", () => {
      const sessionId = "test-session"
      const event1 = { type: "event.1", data: { n: 1 } }
      const event2 = { type: "event.2", data: { n: 2 } }
      const event3 = { type: "event.3", data: { n: 3 } }

      store.append(sessionId, event1)
      const offset2 = store.append(sessionId, event2)
      store.append(sessionId, event3)

      const events = store.query(sessionId, offset2)

      expect(events).toHaveLength(2)
      expect(events[0].event).toEqual(event2)
      expect(events[1].event).toEqual(event3)
    })

    test("returns empty array for unknown session", () => {
      const events = store.query("unknown-session", "-1")
      expect(events).toEqual([])
    })

    test("returns empty array when offset is after all events", () => {
      const sessionId = "test-session"
      store.append(sessionId, { type: "event.1", data: {} })

      const events = store.query(sessionId, "Z" + "9".repeat(25))
      expect(events).toEqual([])
    })

    test("returns events in lexicographic order", () => {
      const sessionId = "test-session"
      const offsets: string[] = []

      for (let i = 0; i < 10; i++) {
        offsets.push(store.append(sessionId, { type: `event.${i}`, data: { i } }))
      }

      const events = store.query(sessionId, "-1")

      for (let i = 0; i < events.length - 1; i++) {
        expect(events[i].offset.localeCompare(events[i + 1].offset)).toBeLessThan(0)
      }
    })
  })

  describe("getLatestOffset", () => {
    test("returns latest offset for session with events", () => {
      const sessionId = "test-session"

      store.append(sessionId, { type: "event.1", data: {} })
      store.append(sessionId, { type: "event.2", data: {} })
      const lastOffset = store.append(sessionId, { type: "event.3", data: {} })

      const latest = store.getLatestOffset(sessionId)
      expect(latest).toBe(lastOffset)
    })

    test("returns null for session with no events", () => {
      const latest = store.getLatestOffset("unknown-session")
      expect(latest).toBeNull()
    })

    test("handles multiple sessions independently", () => {
      const offset1 = store.append("session-1", { type: "event", data: {} })
      const offset2 = store.append("session-2", { type: "event", data: {} })

      expect(store.getLatestOffset("session-1")).toBe(offset1)
      expect(store.getLatestOffset("session-2")).toBe(offset2)
    })
  })

  describe("persistence", () => {
    test("persists events across store instances (file db)", () => {
      const dbPath = "/tmp/test-event-store.db"

      try {
        unlinkSync(dbPath)
      } catch {}

      const store1 = EventStore.create(dbPath)
      const sessionId = "test-session"
      const event = { type: "test.event", data: { foo: "bar" } }
      const offset = store1.append(sessionId, event)
      store1.close()

      const store2 = EventStore.create(dbPath)
      const events = store2.query(sessionId, "-1")
      expect(events).toHaveLength(1)
      expect(events[0].offset).toBe(offset)
      expect(events[0].event).toEqual(event)
      store2.close()

      unlinkSync(dbPath)
    })
  })

  describe("catch-up semantics (edge cases)", () => {
    test("query from exact offset includes that event (inclusive)", () => {
      const sessionId = "test-session"
      store.append(sessionId, { type: "event.1", data: {} })
      const offset2 = store.append(sessionId, { type: "event.2", data: {} })
      store.append(sessionId, { type: "event.3", data: {} })

      const events = store.query(sessionId, offset2)

      expect(events).toHaveLength(2)
      expect(events[0].offset).toBe(offset2)
      expect(events[0].event).toEqual({ type: "event.2", data: {} })
    })

    test("query from first offset returns all events", () => {
      const sessionId = "test-session"
      const offset1 = store.append(sessionId, { type: "event.1", data: {} })
      store.append(sessionId, { type: "event.2", data: {} })

      const events = store.query(sessionId, offset1)

      expect(events).toHaveLength(2)
    })

    test("query from non-existent offset between events", () => {
      const sessionId = "test-session"
      const offset1 = store.append(sessionId, { type: "event.1", data: {} })
      const offset3 = store.append(sessionId, { type: "event.3", data: {} })

      // Create an offset lexicographically between offset1 and offset3
      const midOffset = offset1.slice(0, 25) + String.fromCharCode(offset1.charCodeAt(25) + 1)

      const events = store.query(sessionId, midOffset)

      // Should return event.3 since midOffset < offset3
      expect(events).toHaveLength(1)
      expect(events[0].event).toEqual({ type: "event.3", data: {} })
    })
  })

  describe("payload edge cases", () => {
    test("handles large nested event payload", () => {
      const sessionId = "test-session"
      const largeEvent = {
        type: "large.event",
        data: {
          users: Array.from({ length: 100 }, (_, i) => ({
            id: i,
            name: `user-${i}`,
            metadata: { tags: ["a", "b", "c"], active: true },
          })),
        },
      }

      const offset = store.append(sessionId, largeEvent)
      const events = store.query(sessionId, offset)

      expect(events).toHaveLength(1)
      expect(events[0].event).toEqual(largeEvent)
    })

    test("handles empty object payload", () => {
      const sessionId = "test-session"
      const offset = store.append(sessionId, {})

      const events = store.query(sessionId, offset)

      expect(events).toHaveLength(1)
      expect(events[0].event).toEqual({})
    })

    test("handles null payload", () => {
      const sessionId = "test-session"
      const offset = store.append(sessionId, null)

      const events = store.query(sessionId, offset)

      expect(events).toHaveLength(1)
      expect(events[0].event).toBeNull()
    })

    test("handles array payload", () => {
      const sessionId = "test-session"
      const arrayEvent = [1, 2, 3, { nested: true }]
      const offset = store.append(sessionId, arrayEvent)

      const events = store.query(sessionId, offset)

      expect(events).toHaveLength(1)
      expect(events[0].event).toEqual(arrayEvent)
    })

    test("handles special characters in event data", () => {
      const sessionId = "test-session"
      const event = {
        type: "special.chars",
        data: { message: "quotes\"and'slashes/backslashes\\", emoji: "🚀✨" },
      }
      const offset = store.append(sessionId, event)

      const events = store.query(sessionId, offset)

      expect(events).toHaveLength(1)
      expect(events[0].event).toEqual(event)
    })
  })

  describe("session isolation and safety", () => {
    test("handles special characters in sessionId", () => {
      const sessionId = "session-with-special/chars\\and:colons"
      const event = { type: "test.event", data: {} }
      const offset = store.append(sessionId, event)

      const events = store.query(sessionId, offset)

      expect(events).toHaveLength(1)
      expect(events[0].event).toEqual(event)
    })

    test("maintains isolation with similar session IDs", () => {
      const event = { type: "test.event", data: {} }

      store.append("session-1", event)
      store.append("session-11", event)
      store.append("session-1-suffix", event)

      expect(store.query("session-1", "-1")).toHaveLength(1)
      expect(store.query("session-11", "-1")).toHaveLength(1)
      expect(store.query("session-1-suffix", "-1")).toHaveLength(1)
    })
  })

  describe("ULID monotonicity", () => {
    test("rapid sequential appends produce monotonic offsets", () => {
      const sessionId = "test-session"
      const offsets: string[] = []

      for (let i = 0; i < 100; i++) {
        offsets.push(store.append(sessionId, { type: "rapid.event", data: { i } }))
      }

      // Verify strict monotonicity
      for (let i = 0; i < offsets.length - 1; i++) {
        expect(offsets[i].localeCompare(offsets[i + 1])).toBeLessThan(0)
      }
    })

    test("appends across multiple sessions maintain ULID ordering", () => {
      const offsets: Array<{ sessionId: string; offset: string }> = []

      for (let i = 0; i < 50; i++) {
        const sessionId = `session-${i % 5}`
        const offset = store.append(sessionId, { type: "event", data: { i } })
        offsets.push({ sessionId, offset })
      }

      // Verify global ULID ordering (not just per-session)
      for (let i = 0; i < offsets.length - 1; i++) {
        expect(offsets[i].offset.localeCompare(offsets[i + 1].offset)).toBeLessThan(0)
      }
    })
  })
})
