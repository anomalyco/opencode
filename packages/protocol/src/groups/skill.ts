import { Skill } from "@opencode-ai/schema/skill"
import { Location } from "@opencode-ai/schema/location"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { LocationQuery, locationQueryOpenApi } from "./location"
import { ForbiddenError } from "../errors"

const SkillCreateBody = Schema.Struct({
  name: Schema.String,
  description: Schema.String.pipe(Schema.optional),
  content: Schema.String,
  scope: Schema.Struct({
    type: Schema.Literal("global", "department", "user"),
    departmentCode: Schema.String.pipe(Schema.optional),
    userID: Schema.String.pipe(Schema.optional),
  }),
}).annotate({ identifier: "SkillCreateBody" })

const SkillUpdateBody = Schema.Struct({
  description: Schema.String.pipe(Schema.optional),
  content: Schema.String.pipe(Schema.optional),
}).annotate({ identifier: "SkillUpdateBody" })

const SkillParams = Schema.Struct({
  name: Schema.String,
}).annotate({ identifier: "SkillParams" })

export const SkillNotFoundError = Schema.TaggedErrorClass<SkillNotFoundError>()(
  "SkillNotFoundError",
  { name: Schema.String, message: Schema.String },
  { httpApiStatus: 404 },
)()

export const SkillNameConflictError = Schema.TaggedErrorClass<SkillNameConflictError>()(
  "SkillNameConflictError",
  { name: Schema.String, message: Schema.String },
  { httpApiStatus: 409 },
)()

export const SkillGroup = HttpApiGroup.make("server.skill")
  .add(
    HttpApiEndpoint.get("skill.list", "/api/skill", {
      query: LocationQuery,
      success: Location.response(Schema.Array(Skill.Info)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.skill.list",
          summary: "List skills",
          description: "Retrieve currently registered skills.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("skill.create", "/api/skill", {
      payload: SkillCreateBody,
      success: Schema.Struct({ data: Skill.Info }),
      error: ForbiddenError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.skill.create",
        summary: "Create skill",
        description: "Register a new skill at the requested scope.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.put("skill.update", "/api/skill/:name", {
      params: SkillParams,
      payload: SkillUpdateBody,
      success: Schema.Struct({ data: Skill.Info }),
      error: [ForbiddenError, SkillNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.skill.update",
        summary: "Update skill",
        description: "Update an existing skill.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.del("skill.remove", "/api/skill/:name", {
      params: SkillParams,
      success: HttpApiSchema.NoContent,
      error: [ForbiddenError, SkillNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.skill.remove",
        summary: "Remove skill",
        description: "Delete a skill.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "skills",
      description: "Skill routes.",
    }),
  )
