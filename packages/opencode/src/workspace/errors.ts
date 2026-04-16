import { Schema } from "effect"

export namespace Workspace {
  export class BackendError extends Schema.TaggedErrorClass<BackendError>()("WorkspaceBackendError", {
    backend: Schema.String,
    method: Schema.String,
    path: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Defect),
  }) {}
}
