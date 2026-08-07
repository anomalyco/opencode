import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"

const V1MigrationProgress = Schema.Struct({
  label: Schema.String,
  numerator: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  denominator: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
})

export const V1MigrationStatus = Schema.Union([
  Schema.Struct({ status: Schema.Literals(["required", "completed"]) }),
  Schema.Struct({ status: Schema.Literal("running"), progress: V1MigrationProgress }),
  Schema.Struct({ status: Schema.Literal("error"), error: Schema.String }),
])

export const MigrationGroup = HttpApiGroup.make("server.migration")
  .add(
    HttpApiEndpoint.get("migration.v1.status", "/api/experimental/migration/v1", {
      success: V1MigrationStatus,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.experimental.migration.v1.status",
        summary: "Get V1 migration status",
        description: "Return the progress of the V1 to V2 session history migration.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "migration" }))
