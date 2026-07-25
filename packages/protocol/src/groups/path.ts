import { Path } from "@opencode-ai/schema/path"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

export const PathGroup = HttpApiGroup.make("server.path")
  .add(
    HttpApiEndpoint.get("path.get", "/api/path", {
      query: LocationQuery,
      success: Path.Info,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.path.get",
          summary: "Get paths",
          description: "Get process and location paths.",
        }),
      ),
  )
  .annotateMerge(OpenApi.annotations({ title: "path", description: "Location and process paths." }))
