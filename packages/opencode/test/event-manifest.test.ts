import { describe, expect, test } from "bun:test"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { EventManifest as SchemaEventManifest } from "@opencode-ai/schema/event-manifest"
import { Todo } from "@/session/todo"
import { EventManifest } from "@/event-manifest"

describe("public event manifest", () => {
  test("contains every latest public wire type once", () => {
    // fork: the opencode manifest is the shared schema manifest PLUS fork-owned
    // events whose schemas live in packages/opencode and therefore cannot be
    // declared in packages/schema. It is a superset, not the same object.
    expect(EventManifest.Durable).toBe(SchemaEventManifest.Durable)
    expect(EventManifest.Latest.size).toBe(SchemaEventManifest.Latest.size + 2)
    for (const type of SchemaEventManifest.Latest.keys()) expect(EventManifest.Latest.has(type)).toBe(true)
    expect(EventManifest.Latest.has("loop.updated")).toBe(true)
    expect(EventManifest.Latest.has("side-question.response")).toBe(true)
    expect(EventManifest.Latest.get("session.next.step.ended")).toBe(SessionEvent.Step.Ended)
    expect(EventManifest.Latest.get("todo.updated")).toBe(Todo.Event.Updated)
    expect(EventManifest.Latest.has("ide.installed")).toBe(false)
    expect(EventManifest.Latest.has("server.connected")).toBe(true)
    expect(EventManifest.Latest.has("global.disposed")).toBe(true)
  })

  test("contains only the current step settlement versions", () => {
    expect(EventManifest.Durable.has("session.next.step.ended.1")).toBe(false)
    expect(EventManifest.Durable.get("session.next.step.ended.2")).toBe(SessionEvent.Step.Ended)
  })
})
