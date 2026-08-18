import { Schema } from "effect"

export class ClientError extends Schema.TaggedErrorClass<ClientError>()("ClientError", {
  cause: Schema.Defect(),
}) {}
