import { Location } from "@opencode-ai/schema/location"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { LocationQuery, locationQueryOpenApi } from "./location.js"
import { ServiceUnavailableError, UnknownError } from "../errors.js"

export const DebugGroup = HttpApiGroup.make("server.debug")
  .add(
    HttpApiEndpoint.post("debug.heapDump", "/api/debug/heap-dump", {
      success: Schema.Struct({ path: Schema.String, pid: Schema.Int }),
      error: [ServiceUnavailableError, UnknownError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.debug.heapDump",
        summary: "Write a server heap snapshot",
        description:
          "Write a JavaScript heap snapshot in the server log directory and return its path after completion. Pauses JavaScript execution and may temporarily increase memory use. The file can contain sensitive data. Unsupported runtimes return ServiceUnavailableError.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("debug.location", "/api/debug/location", {
      success: Schema.Array(Location.Ref),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.debug.location.list",
        summary: "List loaded locations",
        description: "List locations currently loaded by the server.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("debug.location.evict", "/api/debug/location", {
      query: LocationQuery,
      success: HttpApiSchema.NoContent,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.debug.location.evict",
          summary: "Evict a loaded location",
          description: "Dispose the requested location's cached services so its next use boots them fresh.",
        }),
      ),
  )
  .annotateMerge(OpenApi.annotations({ title: "debug" }))
