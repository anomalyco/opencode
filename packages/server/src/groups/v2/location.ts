import { Catalog } from "@opencode-ai/core/catalog"
import { AgentV2 } from "@opencode-ai/core/agent"
import { CommandV2 } from "@opencode-ai/core/command"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-layer"
import { FileSystem } from "@opencode-ai/core/filesystem"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { ProjectReference } from "@opencode-ai/core/project-reference"
import { SkillV2 } from "@opencode-ai/core/skill"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { PluginBoot } from "@opencode-ai/core/plugin/boot"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { QuestionV2 } from "@opencode-ai/core/question"
import { Effect, Layer, Schema } from "effect"
import { HttpServerRequest } from "effect/unstable/http"
import { HttpApiMiddleware, OpenApi } from "effect/unstable/httpapi"

export const LocationQuery = Schema.Struct({
  location: Schema.optional(
    Schema.Struct({
      directory: Schema.optional(Schema.String),
      workspace: Schema.optional(Schema.String),
    }),
  ),
}).annotate({ identifier: "V2LocationQuery" })

export const locationQueryOpenApi = OpenApi.annotations({
  transform: (operation) => {
    const parameters = operation.parameters
    if (!Array.isArray(parameters)) return operation
    return {
      ...operation,
      parameters: parameters.map((parameter) =>
        parameter?.name === "location" && parameter?.in === "query"
          ? { ...parameter, style: "deepObject", explode: true }
          : parameter,
      ),
    }
  },
})

export function response<A, E, R>(data: Effect.Effect<A, E, R>) {
  return Effect.gen(function* () {
    const location = yield* Location.Service
    return {
      location: new Location.Info({
        directory: location.directory,
        workspaceID: location.workspaceID,
        project: location.project,
      }),
      data: yield* data,
    }
  })
}

export class V2LocationMiddleware extends HttpApiMiddleware.Service<
  V2LocationMiddleware,
  {
    provides:
      | Catalog.Service
      | AgentV2.Service
      | CommandV2.Service
      | Location.Service
      | PluginBoot.Service
      | PermissionV2.Service
      | ProjectReference.Service
      | FileSystem.Service
      | SkillV2.Service
      | QuestionV2.Service
  }
>()("@opencode/ExperimentalHttpApiV2Location") {}

function ref(request: HttpServerRequest.HttpServerRequest): Location.Ref {
  const query = new URL(request.url, "http://localhost").searchParams
  const workspaceID = query.get("location[workspace]") || request.headers["x-opencode-workspace"]
  return {
    directory: AbsolutePath.make(
      query.get("location[directory]") || request.headers["x-opencode-directory"] || process.cwd(),
    ),
    workspaceID: workspaceID ? WorkspaceV2.ID.make(workspaceID) : undefined,
  }
}

export const layer = Layer.effect(
  V2LocationMiddleware,
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap
    return V2LocationMiddleware.of((effect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        return yield* effect.pipe(Effect.provide(locations.get(ref(request))))
      }),
    )
  }),
)
