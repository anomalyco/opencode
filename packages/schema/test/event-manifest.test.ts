import { describe, expect, test } from "bun:test"
import { EventManifest } from "../src/event-manifest"
import { SessionEvent } from "../src/session-event"
import { SessionTodo } from "../src/session-todo"

describe("public event manifest", () => {
  test("owns the complete public event surface", () => {
    expect(EventManifest.CoreDefinitions.length).toBe(36)
    expect(EventManifest.PublicDefinitions.length).toBe(55)
    expect(EventManifest.Definitions.length).toBe(85)
    expect(EventManifest.Latest.size).toBe(85)
    expect(EventManifest.Durable.size).toBe(32)
  })

  test("uses canonical definitions for current public events", () => {
    expect(EventManifest.Latest.get("session.next.step.ended")).toBe(SessionEvent.Step.Ended)
    expect(EventManifest.Latest.get("todo.updated")).toBe(SessionTodo.Event.Updated)
    expect(EventManifest.Latest.has("ide.installed")).toBe(false)
    expect(EventManifest.Durable.has("session.next.step.ended.1")).toBe(false)
    expect(EventManifest.Durable.get("session.next.step.ended.2")).toBe(SessionEvent.Step.Ended)
  })
})
