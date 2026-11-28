import { BlobStore } from "@opencode/schema/blob-store"
import { Session } from "@opencode/schema/session"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiSchema, OpenApi } from "effect/http-api"
import { BlobNotFoundError, ForbiddenError, InvalidRequestError, ServiceUnavailableError } from "../errors.js"

const EXPERIMENTAL = "Experimental: may change without compatibility guarantees."
const CATALOG = "Needs experimental.blob_catalog in the server's base config."

const params = { blobID: BlobStore.ID }

const annotations = (identifier: string, summary: string, description: string) =>
  OpenApi.annotations({
    identifier: `experimental.blob.${identifier}`,
    summary,
    description: `${description} ${EXPERIMENTAL}`,
    // The routes share the `server.experimental` group with the persistent PTY prototype; tag them on their own.
    transform: (operation) => ({ ...operation, tags: ["experimental"] }),
  })

export const ListQuery = Schema.Struct({
  sessionID: Schema.optional(Session.ID).annotate({ description: "Only blobs made in this session." }),
}).annotate({ identifier: "Blob.ListQuery" })
export type ListQuery = typeof ListQuery.Type

export const CreateQuery = Schema.Struct({
  name: Schema.optional(Schema.String).annotate({ description: "A display name, such as the file name." }),
  sessionID: Schema.optional(Session.ID).annotate({
    description: "The session the blob belongs with. A label only: deleting the session keeps the blob.",
  }),
}).annotate({ identifier: "Blob.CreateQuery" })
export type CreateQuery = typeof CreateQuery.Type

export const UpdatePayload = Schema.Struct({
  name: Schema.optional(Schema.String),
  metadata: Schema.optional(BlobStore.Metadata).annotate({
    description: "Replaces the blob's metadata. At most 4 KB as JSON.",
  }),
}).annotate({ identifier: "Blob.UpdatePayload" })
export type UpdatePayload = typeof UpdatePayload.Type

/** Lives in the `server.experimental` group (see `groups/experimental.ts`). */
export const BlobEndpoints = [
  HttpApiEndpoint.get("blob.list", "/api/experimental/blob", {
    query: ListQuery,
    success: Schema.Struct({ data: Schema.Array(BlobStore.Info) }),
    error: [ForbiddenError],
  }).annotateMerge(
    annotations("list", "List blobs", `List stored blobs, newest first: one session's, or every blob. ${CATALOG}`),
  ),
  // Raw, so the body streams into the store and its content-type can serve as a hint.
  HttpApiEndpoint.post("blob.create", "/api/experimental/blob", {
    query: CreateQuery,
    payload: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array()),
    success: Schema.Struct({ data: BlobStore.Info }),
    error: [ForbiddenError, ServiceUnavailableError],
  }).annotateMerge(
    annotations(
      "create",
      "Create blob",
      `Store the raw request body as a new blob. Its type is read from its first bytes, falling back to the request's content-type; an image's or video's size and a video's length are read from its headers. ${CATALOG}`,
    ),
  ),
  HttpApiEndpoint.get("blob.get", "/api/experimental/blob/:blobID", {
    params,
    success: Schema.Struct({ data: BlobStore.Info }),
    error: [BlobNotFoundError],
  }).annotateMerge(annotations("get", "Get blob", "Read a stored blob's info. Its bytes are at /content.")),
  // Raw, so it can stream the bytes and answer Range and 304 itself.
  HttpApiEndpoint.get("blob.content", "/api/experimental/blob/:blobID/content", {
    params,
    success: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array()),
    error: [BlobNotFoundError],
  }).annotateMerge(
    annotations(
      "content",
      "Read blob content",
      "Stream a stored blob's bytes, such as a generated video, with single byte Range, ETag and 304 Not Modified support.",
    ),
  ),
  HttpApiEndpoint.patch("blob.update", "/api/experimental/blob/:blobID", {
    params,
    payload: UpdatePayload,
    success: Schema.Struct({ data: BlobStore.Info }),
    error: [BlobNotFoundError, ForbiddenError, InvalidRequestError],
  }).annotateMerge(
    annotations(
      "update",
      "Update blob",
      `Change a blob's name or metadata. Its bytes, and what was read from them, never change. ${CATALOG}`,
    ),
  ),
  HttpApiEndpoint.delete("blob.remove", "/api/experimental/blob/:blobID", {
    params,
    success: HttpApiSchema.NoContent,
    error: [BlobNotFoundError, ForbiddenError],
  }).annotateMerge(annotations("remove", "Delete blob", `Delete a blob and its bytes. ${CATALOG}`)),
] as const
