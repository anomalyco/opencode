import { FileSystem } from "@opencode-ai/schema/filesystem"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"

export class BrowseError extends Schema.Error<BrowseError>("BrowseError")(
  {
    name: Schema.Literal("BrowseError"),
    data: Schema.Struct({
      message: Schema.String,
    }),
  },
  { httpApiStatus: 400 },
) {}

const ListQuery = Schema.Struct({
  directory: AbsolutePath,
})

const Result = Schema.Struct({
  directory: AbsolutePath,
  entries: Schema.Array(FileSystem.Entry),
}).annotate({ identifier: "Browse.Result" })

export const BrowseGroup = HttpApiGroup.make("server.browse")
  .add(
    HttpApiEndpoint.get("browse.list", "/api/browse/list", {
      query: ListQuery,
      success: Result,
      error: BrowseError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.browse.list",
        summary: "Browse host directory",
        description: "List direct children of one host directory. Pure navigation: never resolves or materializes a location runtime.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "browse",
      description:
        "Host filesystem navigation for picking locations. These routes never materialize location runtimes or start their services; use the location-scoped fs routes for work inside an active location.",
    }),
  )
