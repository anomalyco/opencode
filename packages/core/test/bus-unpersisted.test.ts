import { describe, expect } from "bun:test"
import { Effect, Schema, SchemaTransformation } from "effect"
import { Bus } from "@Mackery6969/core/bus"
import { Database } from "@Mackery6969/core/database/database"
import { AppNodeBuilder } from "@Mackery6969/core/effect/app-node-builder"
import { Event } from "@Mackery6969/schema/event"
import { LayerNode } from "@Mackery6969/util/effect/layer-node"
import { testEffect } from "./lib/effect"

// Default Bus configuration: durable payloads are not persisted.
const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node])))

let encodes = 0
const Counted = Bus.durable({
  type: "test.counted",
  durable: { version: 1, aggregate: "id" },
  schema: {
    id: Schema.String,
    text: Schema.String.pipe(
      Schema.decodeTo(
        Schema.String,
        SchemaTransformation.transform({
          decode: (value: string) => value,
          encode: (value: string) => {
            encodes++
            return value
          },
        }),
      ),
    ),
  },
})

describe("Bus without persistence", () => {
  it.effect("does not encode payloads it does not store", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      encodes = 0

      const first = yield* bus.publish(Counted, { id: "counted", text: "one" })
      yield* bus.publishAll([
        [Counted, { id: "counted", text: "two" }],
        [Counted, { id: "counted", text: "three" }],
      ])

      expect(first.durable?.seq).toBe(Event.Seq.make(0))
      expect(encodes).toBe(0)
    }),
  )
})
