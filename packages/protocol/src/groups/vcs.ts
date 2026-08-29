import { FileDiff } from "@opencode-ai/schema/file-diff"
import { Location } from "@opencode-ai/schema/location"
import { NonNegativeInt, PositiveInt, optional } from "@opencode-ai/schema/schema"
import { Vcs } from "@opencode-ai/schema/vcs"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { LocationQuery, locationQueryOpenApi } from "./location.js"
import { ServiceUnavailableError } from "../errors.js"

const BranchesQuery = Schema.Struct({
  ...LocationQuery.fields,
  search: Schema.optional(Schema.String),
  limit: Schema.NumberFromString.pipe(Schema.decodeTo(PositiveInt), Schema.optional),
})

const DiffQuery = Schema.Struct({
  ...LocationQuery.fields,
  mode: Vcs.Mode,
  base: optional(Schema.String),
  context: Schema.NumberFromString.pipe(Schema.decodeTo(NonNegativeInt), Schema.optional),
})

export const VcsGroup = HttpApiGroup.make("server.vcs")
  .add(
    HttpApiEndpoint.get("vcs.get", "/api/vcs", {
      query: LocationQuery,
      success: Location.response(Vcs.Info),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.vcs.get",
          summary: "VCS info",
          description: "Get current and default branch information for the requested location.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("vcs.base", "/api/vcs/base", {
      query: LocationQuery,
      success: Location.response(Schema.NullOr(Vcs.Base)),
      error: ServiceUnavailableError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.vcs.base",
          summary: "VCS review base",
          description:
            "Infer a local review base from named branch creation history, or the repository default only when currently on that branch. Returns null before the first commit or when the provider lacks base metadata; ambiguous Git history requires an explicit base on diff requests.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("vcs.status", "/api/vcs/status", {
      query: LocationQuery,
      success: Location.response(Schema.Array(Vcs.FileStatus)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.vcs.status",
          summary: "VCS status",
          description: "List uncommitted working-copy changes relative to the requested location.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("vcs.branches", "/api/vcs/branches", {
      query: BranchesQuery,
      success: Location.response(Vcs.BranchList),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.vcs.branches",
          summary: "VCS branches",
          description: "List local and remote branches available at the requested location.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("vcs.diff", "/api/vcs/diff", {
      query: DiffQuery,
      success: Location.response(Schema.Array(FileDiff.Info)),
      error: ServiceUnavailableError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.vcs.diff",
          summary: "VCS diff",
          description:
            "Diff HEAD to the working copy (working), the base merge-base to the working copy (branch), or the base merge-base to HEAD (committed). Omitting base preserves repository-default comparison; supplying it overrides the comparison without saving it.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "vcs",
      description: "Location-scoped version control routes.",
    }),
  )
