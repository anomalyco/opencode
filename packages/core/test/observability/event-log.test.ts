import { test, expect } from "bun:test"
import type { EventV2 } from "../../src/event"
import { EventLog } from "../../src/observability/event-log"

test("format emits one JSON line per event", () => {
  const event = {
    id: "evt_1",
    type: "session.next.moved",
    data: { sessionID: "ses_1" },
  } as unknown as EventV2.Payload
  const line = EventLog.format(event)
  expect(line.endsWith("\n")).toBe(true)
  const parsed = JSON.parse(line.trim())
  expect(parsed.type).toBe("session.next.moved")
  expect(parsed.data.sessionID).toBe("ses_1")
})
