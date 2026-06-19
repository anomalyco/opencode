import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery, WorkspaceRoutingQueryFields } from "../middleware/workspace-routing"
import { ApiNotFoundError } from "../errors"
import { described } from "./metadata"

const SKILL_TYPES = ["core", "non-core"] as const

export const SkillSnapshot = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  type: Schema.optional(Schema.Literals([...SKILL_TYPES])),
  loaded: Schema.Boolean,
})

export const SkillListResponse = Schema.Array(SkillSnapshot)

export const SkillContentQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  name: Schema.String,
})

export const SkillContentResponse = Schema.Struct({
  name: Schema.String,
  content: Schema.String,
})

export const SkillLoadPayload = Schema.Struct({
  name: Schema.String,
})

export const SkillLoadResponse = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  content: Schema.String,
  type: Schema.optional(Schema.Literals([...SKILL_TYPES])),
  loaded: Schema.Literal(true as const),
})

export const SkillPaths = {
  list: "/skills",
  content: "/skills/content",
  load: "/skills/load",
} as const

export const SkillApi = HttpApi.make("skill")
  .add(
    HttpApiGroup.make("skill")
      .add(
        HttpApiEndpoint.get("list", SkillPaths.list, {
          query: WorkspaceRoutingQuery,
          success: described(SkillListResponse, "List of available skills"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "skill.list",
            summary: "List available skills",
            description: "Returns all available skills with their type and loaded status.",
          }),
        ),
        HttpApiEndpoint.get("content", SkillPaths.content, {
          query: SkillContentQuery,
          success: described(SkillContentResponse, "Skill content preview"),
          error: ApiNotFoundError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "skill.content",
            summary: "Get skill content preview",
            description: "Returns the first portion of a skill's SKILL.md content without loading it into the session.",
          }),
        ),
        HttpApiEndpoint.post("load", SkillPaths.load, {
          query: WorkspaceRoutingQuery,
          payload: SkillLoadPayload,
          success: described(SkillLoadResponse, "Skill loaded successfully"),
          error: ApiNotFoundError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "skill.load",
            summary: "Load a skill",
            description: "Load a skill into the current session.",
          }),
        ),
      )
      .annotateMerge(OpenApi.annotations({ title: "skill", description: "Skill management routes." }))
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
