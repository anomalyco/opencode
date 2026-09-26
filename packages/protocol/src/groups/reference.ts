import { Location } from "@opencode/schema/location"
import { Reference } from "@opencode/schema/reference"
import { Schema, Struct } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

const PublicLocalSource = Schema.Struct(Struct.omit(Reference.LocalSource.fields, ["description", "hidden"])).annotate({
  identifier: "Reference.LocalSource",
})
const PublicGitSource = Schema.Struct(Struct.omit(Reference.GitSource.fields, ["description", "hidden"])).annotate({
  identifier: "Reference.GitSource",
})
const PublicSource = Schema.Union([PublicLocalSource, PublicGitSource])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "Reference.Source" })

const PublicInfo = Schema.Struct({
  ...Struct.omit(Reference.Info.fields, ["source"]),
  source: PublicSource,
}).annotate({ identifier: "Reference.Info" })

export const ReferenceGroup = HttpApiGroup.make("server.reference")
  .add(
    HttpApiEndpoint.get("reference.list", "/api/reference", {
      query: LocationQuery,
      success: Location.response(Schema.Array(PublicInfo)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "reference.list",
          summary: "List references",
          description: "List references available in the requested location.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "reference",
      description: "Location-scoped project references.",
    }),
  )
