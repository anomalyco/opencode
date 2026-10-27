import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiSchema, OpenApi } from "effect/http-api"
import { FileNotFoundError, InvalidRequestError } from "../errors.js"

export const MediaHash = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/u)).annotate({
  identifier: "MediaHash",
})

/** Lives in the `server.experimental` group (see `groups/experimental.ts`). */
export const MediaGetEndpoint = HttpApiEndpoint.get("media.get", "/api/experimental/media/:hash", {
  params: { hash: MediaHash },
  success: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array()),
  error: [FileNotFoundError, InvalidRequestError],
}).annotateMerge(
  OpenApi.annotations({
    identifier: "experimental.media.get",
    summary: "Read media blob",
    description:
      "Read a content-addressed media blob by SHA-256 hash with immutable Cache-Control, ETag, and 304 Not Modified support. Only blobs a stored message or inbox item still references are served. Experimental: may change without compatibility guarantees.",
    // The route shares the `server.experimental` group with the persistent PTY prototype; tag it on its own.
    transform: (operation) => ({ ...operation, tags: ["experimental"] }),
  }),
)
