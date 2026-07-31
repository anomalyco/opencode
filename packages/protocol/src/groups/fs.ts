import { FileSystem } from "@opencode-ai/schema/filesystem"
import { Location } from "@opencode-ai/schema/location"
import { PositiveInt, RelativePath } from "@opencode-ai/schema/schema"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { LocationQuery, locationQueryOpenApi } from "./location"

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

const UploadQuery = Schema.Struct({
  ...LocationQuery.fields,
  path: Schema.String,
})

const UploadPayload = Schema.Struct({
  content: Schema.String,
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
    HttpApiEndpoint.post("fs.upload", "/api/fs/upload", {
      payload: UploadPayload,
      query: UploadQuery,
      success: HttpApiSchema.NoContent,
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
