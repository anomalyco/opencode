import { Schema } from "effect"

export class AIKilledError extends Schema.TaggedErrorClass<AIKilledError>()("AIKilledError", {
  message: Schema.String,
  complianceScore: Schema.Number,
}) {
  static isInstance(input: unknown): input is AIKilledError {
    return input instanceof AIKilledError
  }
}
