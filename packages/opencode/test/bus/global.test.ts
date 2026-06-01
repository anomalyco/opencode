import { describe, expect, test } from "bun:test"
import { GlobalBus, type GlobalEvent } from "@/bus/global"

describe("GlobalBus", () => {
  test("adds an event id and delivers the event to listeners", () => {
    // given
    const received: GlobalEvent[] = []
    const listener = (event: GlobalEvent) => {
      received.push(event)
    }
    GlobalBus.on("event", listener)

    try {
      const event: GlobalEvent = {
        payload: {
          type: "server.connected",
          properties: {},
        },
      }

      // when
      const emitted = GlobalBus.emit("event", event)

      // then
      expect(emitted).toBe(true)
      expect(received).toEqual([event])
      expect(typeof event.payload.id).toBe("string")
    } finally {
      GlobalBus.off("event", listener)
    }
  })

  test("removes listeners with off", () => {
    // given
    const received: GlobalEvent[] = []
    const listener = (event: GlobalEvent) => {
      received.push(event)
    }
    GlobalBus.on("event", listener)
    GlobalBus.off("event", listener)

    // when
    const emitted = GlobalBus.emit("event", {
      payload: {
        id: "evt_existing",
        type: "server.connected",
        properties: {},
      },
    })

    // then
    expect(emitted).toBe(false)
    expect(received).toEqual([])
  })

  test("preserves an existing sync event id", () => {
    // given
    const event: GlobalEvent = {
      payload: {
        syncEvent: { id: "sync_123" },
        type: "session.updated",
        properties: {},
      },
    }

    // when
    GlobalBus.emit("event", event)

    // then
    expect(event.payload.id).toBe("sync_123")
  })
})
