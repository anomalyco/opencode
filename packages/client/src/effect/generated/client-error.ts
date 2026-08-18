import { Schema } from "effect"

export class ClientError extends Schema.TaggedError<ClientError>()("ClientError", {
  cause: Schema.Defect(),
}) {}
