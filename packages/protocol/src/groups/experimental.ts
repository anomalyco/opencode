import { ArtifactEndpoints } from "./artifact.js"
import { JobEndpoints } from "./job.js"
import { MediaGetEndpoint } from "./media.js"
import { PersistentPtyGroup } from "./persistent-pty.js"
import { ScheduleEndpoints } from "./schedule.js"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiSchema, OpenApi } from "effect/http-api"
import { SessionID } from "@opencode/schema/session-id"
import { SessionNotFoundError } from "../errors.js"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

/** `server.experimental`: routes under /api/experimental, without compatibility guarantees. */
export const ExperimentalGroup = PersistentPtyGroup.add(
  MediaGetEndpoint,
  HttpApiEndpoint.get("preview.read", "/api/experimental/preview/read", {
    query: Schema.Struct({ ...LocationQuery.fields, sessionID: SessionID, path: Schema.String, document: Schema.String, root: Schema.String.annotate({description:"The opaque root identity from a binding HEAD request; use bind only to establish a new grant."}), entry: Schema.optional(Schema.Literal("1")) }),
    success: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array()),
    error: SessionNotFoundError,
  })
    .annotateMerge(locationQueryOpenApi)
    .annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.preview.read",
        summary: "Read a session preview file",
        description:
          "Stream a regular workspace file from its verified open handle. Supports HEAD and single byte ranges. Experimental: may change without compatibility guarantees.",
        transform: (operation) => ({ ...operation, tags: ["experimental"] }),
      }),
    ),
  ...ScheduleEndpoints,
  ...ArtifactEndpoints,
  ...JobEndpoints,
)
