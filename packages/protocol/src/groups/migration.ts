import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"

export const V1MigrationStatus = Schema.Struct({
  status: Schema.Literals(["required", "running", "completed"]),
  completed: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  total: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
})

export const V1MigrationResult = Schema.Struct({ status: Schema.Literal("completed") })

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
  .add(
    HttpApiEndpoint.post("migration.v1.run", "/api/experimental/migration/v1", {
      success: V1MigrationResult,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.experimental.migration.v1.run",
        summary: "Run V1 migration",
        description: "Run or resume the V1 to V2 session history migration and wait for completion.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "migration" }))
