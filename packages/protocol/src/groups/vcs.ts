import { FileDiff } from "@opencode-ai/schema/file-diff"
import { Location } from "@opencode-ai/schema/location"
import { NonNegativeInt } from "@opencode-ai/schema/schema"
import { Vcs } from "@opencode-ai/schema/vcs"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

const DiffQuery = Schema.Struct({
  ...LocationQuery.fields,
  mode: Vcs.Mode,
  context: Schema.NumberFromString.pipe(Schema.decodeTo(NonNegativeInt), Schema.optional),
})

export const VcsGroup = HttpApiGroup.make("server.vcs")
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
    HttpApiEndpoint.get("vcs.diff", "/api/vcs/diff", {
      query: DiffQuery,
      success: Location.response(Schema.Array(FileDiff.Info)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.vcs.diff",
          summary: "VCS diff",
          description:
            "Diff the working copy against HEAD (mode git) or the default-branch merge base (mode branch) for the requested location.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "vcs",
      description: "Location-scoped version control routes.",
    }),
  )
