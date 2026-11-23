import { BlobStore } from "@opencode/schema/blob-store"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiSchema, OpenApi } from "effect/http-api"
import { BlobNotFoundError } from "../errors.js"

/** Lives in the `server.experimental` group (see `groups/experimental.ts`). */
export const BlobGetEndpoint = HttpApiEndpoint.get("blob.get", "/api/experimental/blob/:id", {
  params: { id: BlobStore.ID },
  success: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array()),
  error: [BlobNotFoundError],
}).annotateMerge(
  OpenApi.annotations({
    identifier: "experimental.blob.get",
    summary: "Read a blob",
    description:
      "Stream a stored blob's bytes, such as a generated video, with single byte Range, ETag and 304 Not Modified support. A blob is deleted a week after it was stored. Experimental: may change without compatibility guarantees.",
    // The route shares the `server.experimental` group with the persistent PTY prototype; tag it on its own.
    transform: (operation) => ({ ...operation, tags: ["experimental"] }),
  }),
)
