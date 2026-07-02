import { describe, expect } from "bun:test"
import { Effect, Exit, Layer } from "effect"
import { EventV2 } from "@opencode-ai/core/event"
import { Form } from "@opencode-ai/core/form"
import { testEffect } from "./lib/effect"

const layer = Form.locationLayer.pipe(Layer.provideMerge(EventV2.defaultLayer))
const it = testEffect(layer)

const formID = Form.ID.create("frm_test")
const input = {
  id: formID,
  sessionID: "ses_test",
  mode: "form",
  fields: [{ key: "name", type: "string", required: true }],
} satisfies Form.CreateInput

describe("Form", () => {
  it.effect("cleans up created forms when event publication fails", () =>
    Effect.gen(function* () {
      const service = yield* Form.Service
      const events = yield* EventV2.Service
      const unsubscribe = yield* events.listen((event) =>
        event.type === Form.Event.Created.type ? Effect.die("create listener failed") : Effect.void,
      )
      yield* Effect.addFinalizer(() => unsubscribe)

      expect(Exit.isFailure(yield* Effect.exit(service.create(input)))).toBe(true)
      expect(yield* service.get(formID).pipe(Effect.flip)).toEqual(new Form.NotFoundError({ id: formID }))

      yield* unsubscribe
      expect(yield* service.create(input)).toMatchObject({ id: formID })
    }),
  )

  it.effect("keeps forms pending when reply event publication fails", () =>
    Effect.gen(function* () {
      const service = yield* Form.Service
      const events = yield* EventV2.Service
      yield* service.create(input)
      const unsubscribe = yield* events.listen((event) =>
        event.type === Form.Event.Replied.type ? Effect.die("reply listener failed") : Effect.void,
      )
      yield* Effect.addFinalizer(() => unsubscribe)

      expect(
        Exit.isFailure(yield* Effect.exit(service.reply({ id: formID, answer: { name: "Ava" } }))),
      ).toBe(true)
      expect(yield* service.state(formID)).toEqual({ status: "pending" })

      yield* unsubscribe
      yield* service.reply({ id: formID, answer: { name: "Ava" } })
      expect(yield* service.state(formID)).toEqual({ status: "answered", answer: { name: "Ava" } })
    }),
  )
})
