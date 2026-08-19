import { FileSystem } from "@opencode-ai/schema/filesystem"
import { Location } from "@opencode-ai/schema/location"
import { PositiveInt, RelativePath } from "@opencode-ai/schema/schema"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { LocationQuery, locationQueryOpenApi } from "./location"
import { InvalidRequestError } from "../errors"

/**
 * Maximum accepted size for a single uploaded file, in bytes.
 * Keep in sync with `MaxUploadBytes` in `packages/app/src/utils/file-transfer.ts`.
 */
export const MaxUploadBytes = 2 * 1024 * 1024 * 1024

/**
 * Maximum size of an upload HTTP request body, including multipart overhead
 * (boundaries and part headers). Used by the server's body-size guard before
 * the body is read. The 8 MiB margin covers multipart framing around the file.
 */
export const MaxUploadRequestBytes = MaxUploadBytes + 8 * 1024 * 1024

const ListQuery = Schema.Struct({
  ...LocationQuery.fields,
  path: RelativePath.pipe(Schema.optional),
})

const FindQuery = Schema.Struct({
  ...LocationQuery.fields,
  query: FileSystem.FindInput.fields.query,
  type: FileSystem.FindInput.fields.type,
  limit: Schema.NumberFromString.pipe(Schema.decodeTo(PositiveInt), Schema.optional),
})

// Relative upload/delete target: relative, non-empty, no leading slash and no
// "." / ".." path segments. Rejected with a 400 (InvalidRequestError) by the
// fs.upload and fs.delete handlers.
export const UploadPathPattern = /^(?![\/])(?!.*(?:^|\/)\.\.?(?:\/|$))[^\/]+(?:\/[^\/]+)*$/

export const UploadQuery = Schema.Struct({
  ...LocationQuery.fields,
  path: Schema.String,
})

export const FileSystemGroup = HttpApiGroup.make("server.fs")
  .add(
    HttpApiEndpoint.get("fs.read", "/api/fs/read/*", {
      query: LocationQuery,
      success: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array()),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.fs.read",
          summary: "Read file",
          description: "Serve one file relative to the requested location.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("fs.list", "/api/fs/list", {
      query: ListQuery,
      success: Location.response(Schema.Array(FileSystem.Entry)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.fs.list",
          summary: "List directory",
          description: "List direct children of one directory relative to the requested location.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("fs.find", "/api/fs/find", {
      query: FindQuery,
      success: Location.response(Schema.Array(FileSystem.Entry)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.fs.find",
          summary: "Find files",
          description: "Find recursively ranked filesystem entries relative to the requested location.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("fs.download", "/api/fs/download/*", {
      query: LocationQuery,
      success: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array()),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.fs.download",
          summary: "Download file",
          description: "Download one file relative to the requested location with content-disposition attachment header.",
        }),
      ),
  )
  .add(
    // The upload body is `multipart/form-data` with a single `file` part streamed
    // to disk; it is consumed via `ctx.request.multipartStream` in the handler,
    // so no payload schema is declared here.
    HttpApiEndpoint.post("fs.upload", "/api/fs/upload", {
      query: UploadQuery,
      success: HttpApiSchema.NoContent,
      error: InvalidRequestError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.fs.upload",
          summary: "Upload file",
          description: "Upload a file to the requested location.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("fs.delete", "/api/fs/delete", {
      query: UploadQuery,
      success: HttpApiSchema.NoContent,
      error: InvalidRequestError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.fs.delete",
          summary: "Delete file or directory",
          description: "Delete a file or directory relative to the requested location.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "filesystem",
      description: "Experimental location-scoped filesystem routes.",
    }),
  )
