import { describe, expect, test } from "bun:test"
import { createSyncMessageEventBuffer, type SyncMessageEvent } from "../../../src/cli/cmd/tui/context/sync-message-event-buffer"

function deltaEvent(id: string, sessionID: string): SyncMessageEvent {
  return {
    id,
    type: "message.part.delta",
    properties: {
      sessionID,
      messageID: `msg_${id}`,
      partID: `part_${id}`,
      field: "text",
      delta: id,
    },
  }
}

describe("createSyncMessageEventBuffer", () => {
  test("buffers events per session in arrival order", () => {
    const buffer = createSyncMessageEventBuffer()
    buffer.push(deltaEvent("1", "session-a"))
    buffer.push(deltaEvent("2", "session-b"))
    buffer.push(deltaEvent("3", "session-a"))

    expect(buffer.drain("session-a").map((event) => event.id)).toEqual(["1", "3"])
    expect(buffer.drain("session-b").map((event) => event.id)).toEqual(["2"])
  })

  test("draining one session does not clear others", () => {
    const buffer = createSyncMessageEventBuffer()
    buffer.push(deltaEvent("1", "session-a"))
    buffer.push(deltaEvent("2", "session-b"))

    expect(buffer.drain("session-a").map((event) => event.id)).toEqual(["1"])
    expect(buffer.drain("session-a")).toEqual([])
    expect(buffer.drain("session-b").map((event) => event.id)).toEqual(["2"])
  })

  test("clear removes all buffered events", () => {
    const buffer = createSyncMessageEventBuffer()
    buffer.push(deltaEvent("1", "session-a"))
    buffer.push(deltaEvent("2", "session-b"))

    buffer.clear()

    expect(buffer.drain("session-a")).toEqual([])
    expect(buffer.drain("session-b")).toEqual([])
  })
})
