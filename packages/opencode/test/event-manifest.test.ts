import { describe, expect, test } from "bun:test"
import { SessionEvent } from "@opencode-ai/schema/session-event"
import { EventManifest } from "@/event-manifest"

describe("public event manifest", () => {
  test("contains every latest public wire type once", () => {
    expect(EventManifest.Latest.size).toBe(86)
    expect(EventManifest.Latest.get("session.next.step.ended")).toBe(SessionEvent.Step.Ended)
    expect(EventManifest.Latest.has("ide.installed")).toBe(true)
    expect(EventManifest.Latest.has("server.connected")).toBe(true)
    expect(EventManifest.Latest.has("global.disposed")).toBe(true)
  })

  test("keeps historical durable versions out of the latest manifest", () => {
    expect(EventManifest.Latest.values().toArray()).not.toContain(SessionEvent.Step.EndedV1)
    expect(EventManifest.Latest.values().toArray()).not.toContain(SessionEvent.Step.FailedV1)
    expect(EventManifest.Durable.get("session.next.step.ended.1")).toBe(SessionEvent.Step.EndedV1)
    expect(EventManifest.Durable.get("session.next.step.ended.2")).toBe(SessionEvent.Step.Ended)
  })
})
