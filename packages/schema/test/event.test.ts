import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Event } from "../src/event.js"
import { EventLog } from "../src/event-log.js"

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

  test("durable definitions are indexed by type and version", () => {
    const definition = Event.define({
      type: "test.durable",
      durable: { aggregate: "id", version: 1 },
      schema: { id: Schema.String },
    })

    expect(Event.durable([definition]).get("test.durable.1")).toBe(definition)
  })

  test("synced marker encodes the captured watermark", () => {
    expect(
      Schema.encodeSync(EventLog.Synced)({
        type: "log.synced",
        aggregateID: "ses_test",
        seq: Event.Seq.make(1),
      }),
    ).toEqual({ type: "log.synced", aggregateID: "ses_test", seq: 1 })
    expect(Schema.encodeSync(EventLog.Synced)({ type: "log.synced", aggregateID: "ses_test" })).toEqual({
      type: "log.synced",
      aggregateID: "ses_test",
    })
  })
})
