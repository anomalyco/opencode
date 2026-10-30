import { Job } from "@opencode/schema/job"
import { Session } from "@opencode/schema/session"
import { Schema, SchemaGetter } from "effect"
import { HttpApiEndpoint, OpenApi } from "effect/http-api"
import { InvalidRequestError, SessionNotFoundError } from "../errors.js"

const BooleanFromString = Schema.Literals(["true", "false"]).pipe(
  Schema.decodeTo(Schema.Boolean, {
    decode: SchemaGetter.transform((value) => value === "true"),
    encode: SchemaGetter.transform((value): "true" | "false" => (value ? "true" : "false")),
  }),
)

export const ListQuery = Schema.Struct({
  sessionID: Schema.optional(Session.ID).annotate({
    description: "Filter to background jobs owned by this session.",
  }),
  kind: Schema.optional(Job.Kind).annotate({
    description: "Filter by background job kind (shell, subagent, or image).",
  }),
  descendants: Schema.optional(BooleanFromString).annotate({
    description: "When sessionID is set, also include background jobs owned by child and nested subagent sessions.",
  }),
}).annotate({ identifier: "Job.ListQuery" })
export type ListQuery = typeof ListQuery.Type

/** Lives in the `server.experimental` group (see `groups/experimental.ts`). */
export const JobEndpoints = [
  HttpApiEndpoint.get("job.list", "/api/experimental/job", {
    query: ListQuery,
    success: Schema.Struct({ data: Schema.Array(Job.Info) }),
    error: [InvalidRequestError, SessionNotFoundError],
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "experimental.job.list",
      summary: "List background jobs",
      description:
        "List active and unconsumed background jobs, optionally filtered by owning session, descendants, or kind. Experimental: may change without compatibility guarantees.",
      transform: (operation) => ({ ...operation, tags: ["experimental"] }),
    }),
  ),
] as const
