import { LocationFileSystem } from "@opencode-ai/core/location-filesystem"
import { RelativePath } from "@opencode-ai/core/schema"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { V2Authorization } from "../../middleware/authorization"
import { LocationQuery, locationQueryOpenApi, V2LocationMiddleware } from "./location"

const ReadQuery = Schema.Struct({
  ...LocationQuery.fields,
  path: RelativePath,
})

const ListQuery = Schema.Struct({
  ...LocationQuery.fields,
  path: RelativePath.pipe(Schema.optional),
})

export const FileSystemGroup = HttpApiGroup.make("v2.fs")
  .add(
    HttpApiEndpoint.get("read", "/api/fs/read", {
      query: ReadQuery,
      success: LocationFileSystem.Content,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.fs.read",
          summary: "Read file",
          description: "Read one file relative to the requested location.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("list", "/api/fs/list", {
      query: ListQuery,
      success: Schema.Array(LocationFileSystem.Entry),
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
  .annotateMerge(
    OpenApi.annotations({
      title: "v2 filesystem",
      description: "Experimental v2 location-scoped filesystem routes.",
    }),
  )
  .middleware(V2LocationMiddleware)
  .middleware(V2Authorization)
