import { Schema } from "effect"

/** Safe operational refusal from a standard capability pack, reported as `CapabilityFailure`. */
export class CapabilityError extends Schema.TaggedErrorClass<CapabilityError>()("CapabilityError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export const capabilityError = (message: string, cause?: unknown): CapabilityError =>
  new CapabilityError({ message, ...(cause === undefined ? {} : { cause }) })
