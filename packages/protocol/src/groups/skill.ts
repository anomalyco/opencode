import { Skill } from "@opencode/schema/skill"
import { Location } from "@opencode/schema/location"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { SkillLoadError, SkillNotFoundError } from "../errors.js"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

export const SkillContent = Schema.Struct({
  content: Schema.String.annotate({ description: "The skill's SKILL.md body, without its frontmatter." }),
}).annotate({ identifier: "Skill.Content" })
export type SkillContent = typeof SkillContent.Type

export const SkillGroup = HttpApiGroup.make("server.skill")
  .add(
    HttpApiEndpoint.get("skill.list", "/api/skill", {
      query: LocationQuery,
      success: Location.response(Schema.Array(Skill.Info)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "skill.list",
          summary: "List skills",
          description: "Retrieve currently registered skills.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("skill.content", "/api/skill/:skillID/content", {
      params: { skillID: Skill.ID },
      query: LocationQuery,
      success: Location.response(SkillContent),
      error: [SkillNotFoundError, SkillLoadError],
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "skill.content",
          summary: "Get skill content",
          description:
            "Read a skill's SKILL.md body, loading it first when it loads on demand, such as an MCP skill fetched from its server. Fails with 502 when it can't be loaded.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "skill",
      description: "Experimental skill routes.",
    }),
  )
