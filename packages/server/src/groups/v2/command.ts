import { CommandV2 } from "@opencode-ai/core/command"
import { Location } from "@opencode-ai/core/location"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { V2Authorization } from "../../middleware/authorization"
import { LocationQuery, locationQueryOpenApi, V2LocationMiddleware } from "./location"

export const CommandGroup = HttpApiGroup.make("v2.command")
  .add(
    HttpApiEndpoint.get("commands", "/api/command", {
      query: LocationQuery,
      success: Location.response(Schema.Array(CommandV2.Info)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.command.list",
          summary: "List v2 commands",
          description: "Retrieve currently registered v2 commands.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "v2 commands",
      description: "Experimental v2 command routes.",
    }),
  )
  .middleware(V2LocationMiddleware)
  .middleware(V2Authorization)
