export * as SessionParking from "./parking.js"

import { isDeepStrictEqual } from "node:util"
import { Effect, Schema } from "effect"
import { Bus } from "../bus.js"
import { SessionEvent } from "./event.js"

export class ConflictError extends Schema.TaggedError<ConflictError>()("SessionParking.ConflictError", {
  message: Schema.String,
}) {}

/** Internal command only; callers supply the canonical continuation captured by P1 preparation. */
export const park = Effect.fn("SessionParking.park")(function* (payload: SessionEvent.Step.ParkedPayload) {
  const data = yield* Effect.sync(() => encodePayload(payload)).pipe(
    Effect.catchDefect((defect) => (defect instanceof ConflictError ? Effect.fail(defect) : Effect.die(defect))),
  )
  const bus = yield* Bus.Service
  return yield* bus.publish(SessionEvent.Step.Parked, data).pipe(
    Effect.catchDefect((defect) => (defect instanceof ConflictError ? Effect.fail(defect) : Effect.die(defect))),
  )
})

/** Also used by the private projector, so replay and direct internal publication share the boundary. */
export function encodePayload(payload: SessionEvent.Step.ParkedPayload) {
  try {
    // JSON.stringify alone silently loses undefined, nonfinite numbers, and provider-specific objects.
    const json: unknown = JSON.parse(JSON.stringify(payload))
    if (!isDeepStrictEqual(payload, json)) throw new Error("Parking payload must be lossless JSON")
    return Schema.decodeUnknownSync(SessionEvent.Step.ParkedPayload, { onExcessProperty: "error" })(json)
  } catch {
    throw new ConflictError({ message: "Parking requires a complete, JSON-serializable ParkedPayload" })
  }
}
