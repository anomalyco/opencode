import { describe, expect, test } from "bun:test"
import { EventV2 } from "@opencode-ai/core/event"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { Schema } from "effect"

const sessionNextTypes = [
  "session.next.agent.switched",
  "session.next.model.switched",
  "session.next.prompted",
  "session.next.synthetic",
  "session.next.shell.started",
  "session.next.shell.ended",
  "session.next.step.started",
  "session.next.step.ended",
  "session.next.step.failed",
  "session.next.text.started",
  "session.next.text.delta",
  "session.next.text.ended",
  "session.next.reasoning.started",
  "session.next.reasoning.delta",
  "session.next.reasoning.ended",
  "session.next.tool.input.started",
  "session.next.tool.input.delta",
  "session.next.tool.input.ended",
  "session.next.tool.called",
  "session.next.tool.progress",
  "session.next.tool.success",
  "session.next.tool.failed",
  "session.next.retried",
  "session.next.compaction.started",
  "session.next.compaction.delta",
  "session.next.compaction.ended",
] as const

describe("EventV2 registry", () => {
  test("registers the session.next catalog once in deterministic declaration order", () => {
    expect(SessionEvent.All).toBeDefined()

    const registered = EventV2.definitions()
      .map((definition) => definition.type)
      .filter((type) => type.startsWith("session.next."))

    expect(registered).toEqual(Array.from(sessionNextTypes))
    expect(new Set(registered).size).toBe(registered.length)
  })

  test("session.next definitions expose stable sync metadata for OpenAPI and SDK generation", () => {
    for (const type of sessionNextTypes) {
      const definition = EventV2.registry.get(type)

      expect(definition, `${type} should be registered`).toBeDefined()
      expect(definition?.sync, `${type} should be a durable sync event`).toEqual({
        aggregate: "sessionID",
        version: 1,
      })
      expect(definition?.data, `${type} should expose a data schema`).toBeDefined()
    }
  })

  test("rejects duplicate non-versioned event registration instead of silently changing generation order", () => {
    expect(() =>
      EventV2.define({
        type: "test.registry.duplicate",
        schema: {},
      }),
    ).not.toThrow()
    expect(() =>
      EventV2.define({
        type: "test.registry.duplicate",
        schema: {},
      }),
    ).toThrow(/duplicate|already registered/i)
  })

  test("rejects duplicate sync event type and version registration", () => {
    expect(() =>
      EventV2.define({
        type: "test.registry.duplicate-sync",
        sync: { version: 1, aggregate: "id" },
        schema: { id: Schema.String },
      }),
    ).not.toThrow()
    expect(() =>
      EventV2.define({
        type: "test.registry.duplicate-sync",
        sync: { version: 1, aggregate: "id" },
        schema: { id: Schema.String },
      }),
    ).toThrow(/duplicate|already registered/i)
  })

  test("rejects registering a sync event after a non-sync event with the same type", () => {
    expect(() =>
      EventV2.define({
        type: "test.registry.nonsync-first",
        schema: {},
      }),
    ).not.toThrow()
    expect(() =>
      EventV2.define({
        type: "test.registry.nonsync-first",
        sync: { version: 1, aggregate: "id" },
        schema: { id: Schema.String },
      }),
    ).toThrow(/duplicate|already registered/i)
  })

  test("rejects registering a non-sync event after a sync event with the same type", () => {
    expect(() =>
      EventV2.define({
        type: "test.registry.sync-first",
        sync: { version: 1, aggregate: "id" },
        schema: { id: Schema.String },
      }),
    ).not.toThrow()
    expect(() =>
      EventV2.define({
        type: "test.registry.sync-first",
        schema: {},
      }),
    ).toThrow(/duplicate|already registered/i)
  })
})
