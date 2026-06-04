import { SkillV2 } from "@opencode-ai/core/skill"
import { Location } from "@opencode-ai/core/location"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { V2Authorization } from "../../middleware/authorization"
import { LocationQuery, locationQueryOpenApi, V2LocationMiddleware } from "./location"

export const SkillGroup = HttpApiGroup.make("v2.skill")
  .add(
    HttpApiEndpoint.get("skills", "/api/skill", {
      query: LocationQuery,
      success: Location.response(Schema.Array(SkillV2.Info)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.skill.list",
          summary: "List v2 skills",
          description: "Retrieve currently registered v2 skills.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "v2 skills",
      description: "Experimental v2 skill routes.",
    }),
  )
  .middleware(V2LocationMiddleware)
  .middleware(V2Authorization)
