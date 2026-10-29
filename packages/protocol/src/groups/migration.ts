import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"

const V1MigrationProgress = Schema.Struct({
  label: Schema.String,
  numerator: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  denominator: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
})

export const V1MigrationStatus = Schema.Union([
  Schema.Struct({ status: Schema.Literals(["confirmation_required", "required", "completed"]) }),
  Schema.Struct({ status: Schema.Literal("running"), progress: V1MigrationProgress }),
  Schema.Struct({ status: Schema.Literal("error"), error: Schema.String }),
])

export const MigrationGroup = HttpApiGroup.make("server.migration")
  .add(
    HttpApiEndpoint.get("migration.v1.status", "/api/experimental/migration/v1", {
      success: V1MigrationStatus,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.migration.v1.status",
        summary: "Get V1 migration status",
        description: "Return the progress of the V1 to V2 session history migration.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("migration.v1.accept", "/api/experimental/migration/v1/accept", {
      payload: Schema.Struct({ acknowledged: Schema.Literal(true) }),
      success: Schema.Void,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.migration.v1.accept",
        summary: "Accept the one-way V1 to V2 upgrade",
        description:
          "Acknowledge that all projects sharing this server's data and configuration must use V2. Stop V1 first; later V1 changes are not synchronized.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "migration" }))
