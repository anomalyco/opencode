import { describe, test, expect } from "bun:test"
import z from "zod"
import { BusEvent } from "../../src/bus/bus-event"

describe("BusEvent", () => {
  describe("define()", () => {
    test("creates a definition with type and properties schema", () => {
      const def = BusEvent.define(
        "test.event",
        z.object({ value: z.number() }),
      )
      expect(def.type).toBe("test.event")
      expect(def.properties).toBeDefined()
    })

    test("definition properties schema validates correctly", () => {
      const def = BusEvent.define(
        "test.validated",
        z.object({ name: z.string(), count: z.number() }),
      )
      const valid = def.properties.safeParse({ name: "hello", count: 42 })
      expect(valid.success).toBe(true)

      const invalid = def.properties.safeParse({ name: 123 })
      expect(invalid.success).toBe(false)
    })

    test("registers event in registry so payloads() includes it", () => {
      const uniqueType = "test.registry-check-" + Date.now()
      BusEvent.define(uniqueType, z.object({ ok: z.boolean() }))

      // payloads() returns a discriminated union of all registered events
      const schema = BusEvent.payloads()
      const result = schema.safeParse({
        type: uniqueType,
        properties: { ok: true },
      })
      expect(result.success).toBe(true)
    })

    test("multiple definitions have distinct types", () => {
      const def1 = BusEvent.define(
        "test.alpha",
        z.object({ a: z.string() }),
      )
      const def2 = BusEvent.define(
        "test.beta",
        z.object({ b: z.number() }),
      )
      expect(def1.type).not.toBe(def2.type)
      expect(def1.type).toBe("test.alpha")
      expect(def2.type).toBe("test.beta")
    })

    test("overwriting same type replaces previous definition", () => {
      const type = "test.overwrite-" + Date.now()
      BusEvent.define(type, z.object({ version: z.literal(1) }))
      BusEvent.define(type, z.object({ version: z.literal(2) }))

      const schema = BusEvent.payloads()
      const result = schema.safeParse({
        type,
        properties: { version: 2 },
      })
      expect(result.success).toBe(true)
    })
  })

  describe("payloads()", () => {
    test("returns a zod schema", () => {
      const schema = BusEvent.payloads()
      expect(schema).toBeDefined()
      expect(typeof schema.safeParse).toBe("function")
    })

    test("rejects unknown event types", () => {
      const schema = BusEvent.payloads()
      const result = schema.safeParse({
        type: "completely.nonexistent.event.type." + Date.now(),
        properties: {},
      })
      expect(result.success).toBe(false)
    })

    test("validates properties against the registered schema", () => {
      const type = "test.payload-validation-" + Date.now()
      BusEvent.define(type, z.object({ required: z.string() }))

      const schema = BusEvent.payloads()

      const good = schema.safeParse({
        type,
        properties: { required: "present" },
      })
      expect(good.success).toBe(true)

      const bad = schema.safeParse({
        type,
        properties: { required: 123 },
      })
      expect(bad.success).toBe(false)
    })
  })
})
