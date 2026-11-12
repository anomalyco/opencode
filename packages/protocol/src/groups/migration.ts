import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"

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

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

export const SessionSearchStatus = Schema.Union([
  Schema.Struct({ status: Schema.Literal("disabled") }),
  Schema.Struct({
    status: Schema.Literals(["running", "paused"]),
    progress: Schema.Struct({ label: Schema.String, numerator: Count, denominator: Count }),
  }),
  Schema.Struct({ status: Schema.Literal("completed"), skipped: Count }),
  Schema.Struct({ status: Schema.Literals(["unsupported", "error"]), error: Schema.String }),
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
    HttpApiEndpoint.get("migration.sessionSearch.status", "/api/experimental/migration/session-search", {
      success: SessionSearchStatus,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.migration.sessionSearch.status",
        summary: "Get session search build status",
        description:
          "Experimental: may change without compatibility guarantees. Return the progress of the one-time session search index build that `experimental.sqlite_fts` starts. `paused` means the build is incomplete and not running in this server, for example while the flag is off.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "migration" }))
