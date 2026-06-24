import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Event } from "../src/event"
import { SessionEvent } from "../src/session-event"
import { SessionV1 } from "../src/session-v1"
import { Todo } from "../src/todo"

describe("public event schemas", () => {
  test("definition is pure", () => {
    const definitions = Event.inventory()
    Event.define({ type: "test.pure", schema: { value: Schema.String } })
    expect(definitions).toEqual([])
  })

  test("latest selection is independent of declaration order", () => {
    const historical = Event.define({
      type: "test.versioned",
      durable: { aggregate: "id", version: 1 },
      schema: { id: Schema.String },
    })
    const current = Event.define({
      type: "test.versioned",
      durable: { aggregate: "id", version: 2 },
      schema: { id: Schema.String, value: Schema.String },
    })

    expect(Event.latest([historical, current]).get(current.type)).toBe(current)
    expect(Event.latest([current, historical]).get(current.type)).toBe(current)
  })

  test("indexes every durable session type and version", () => {
    const durable = Event.durable([...SessionV1.Events, ...SessionEvent.Definitions])
    expect(durable.size).toBe(
      SessionV1.Events.length + SessionEvent.DurableDefinitions.length + SessionEvent.HistoricalDefinitions.length,
    )
    for (const definition of [
      ...SessionV1.Events,
      ...SessionEvent.DurableDefinitions,
      ...SessionEvent.HistoricalDefinitions,
    ]) {
      expect(durable.get(Event.versionedType(definition.type, definition.durable!.version))).toBe(definition)
    }
  })

  test("latest aggregate excludes historical versions", () => {
    const latest = Event.latest(SessionEvent.Definitions)
    expect(latest.get(SessionEvent.Step.Ended.type)).toBe(SessionEvent.Step.Ended)
    expect(latest.get(SessionEvent.Step.Failed.type)).toBe(SessionEvent.Step.Failed)
    expect(latest.values().toArray()).not.toContain(SessionEvent.Step.EndedV1)
    expect(latest.values().toArray()).not.toContain(SessionEvent.Step.FailedV1)
  })

  test("historical and current step shapes decode incompatibly", () => {
    const historical = {
      timestamp: 0,
      sessionID: "ses_test",
      finish: "stop",
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    }
    expect(Schema.decodeUnknownSync(SessionEvent.Step.EndedV1.data)(historical)).toBeDefined()
    expect(() => Schema.decodeUnknownSync(SessionEvent.Step.Ended.data)(historical)).toThrow()
  })

  test("domain inventories are explicit and complete", () => {
    expect(SessionEvent.Definitions.length).toBe(31)
    expect(Todo.Events).toEqual([Todo.Event.Updated])
    expect(Object.isFrozen(SessionEvent.Definitions)).toBe(true)
    expect(Object.isFrozen(Todo.Events)).toBe(true)
  })
})
