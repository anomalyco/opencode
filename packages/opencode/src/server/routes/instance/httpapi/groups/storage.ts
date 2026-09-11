import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { described } from "./metadata"

const NonNegativeInt = Schema.Finite.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))

export const StorageOverview = Schema.Struct({
  path: Schema.String,
  databaseBytes: NonNegativeInt,
  walBytes: NonNegativeInt,
  shmBytes: NonNegativeInt,
  totalBytes: NonNegativeInt,
  pageSize: NonNegativeInt,
  pageCount: NonNegativeInt,
  allocatedBytes: NonNegativeInt,
  reusablePages: NonNegativeInt,
  reusableBytes: NonNegativeInt,
})

const StorageTypeSummary = Schema.Struct({
  events: NonNegativeInt,
  payloadBytesReclaimable: NonNegativeInt,
})

export const StorageAnalysis = Schema.Struct({
  snapshots: NonNegativeInt,
  inspected: NonNegativeInt,
  candidates: NonNegativeInt,
  projectionMismatches: NonNegativeInt,
  compatibilityRejected: NonNegativeInt,
  malformed: NonNegativeInt,
  payloadBytesReclaimable: NonNegativeInt,
  byType: Schema.Record(Schema.String, StorageTypeSummary),
})

const StorageOperation = Schema.Literals(["analyze", "backup", "compact", "checkpoint", "vacuum"])
const StoragePhase = Schema.Literals([
  "idle",
  "snapshot",
  "verify",
  "index",
  "analyze",
  "backup",
  "drain",
  "compact",
  "checkpoint",
  "vacuum",
])

export const StorageProgress = Schema.Struct({
  operation: Schema.NullOr(StorageOperation),
  phase: StoragePhase,
  completed: NonNegativeInt,
  total: NonNegativeInt,
  workers: NonNegativeInt,
  startedAt: NonNegativeInt,
  updatedAt: NonNegativeInt,
})

export const StorageBackup = Schema.Struct({
  path: Schema.String,
  bytes: NonNegativeInt,
  integrity: Schema.Literal("ok"),
})

const StorageConfirmation = Schema.Struct({
  confirmed: Schema.Literal(true),
})

export const StorageCompact = Schema.Struct({
  ...StorageAnalysis.fields,
  rewritten: NonNegativeInt,
  backup: StorageBackup,
  before: StorageOverview,
  after: StorageOverview,
})

export const StorageCheckpoint = Schema.Struct({
  busy: NonNegativeInt,
  logFrames: NonNegativeInt,
  checkpointedFrames: NonNegativeInt,
  before: StorageOverview,
  after: StorageOverview,
})

export const StorageVacuum = Schema.Struct({
  backup: StorageBackup,
  bytesReclaimed: NonNegativeInt,
  checkpointBusy: NonNegativeInt,
  before: StorageOverview,
  after: StorageOverview,
})

export class StorageMaintenanceError extends Schema.ErrorClass<StorageMaintenanceError>("StorageMaintenanceError")(
  {
    name: Schema.Literal("StorageMaintenanceError"),
    data: Schema.Struct({ message: Schema.String }),
  },
  { httpApiStatus: 500 },
) {}

export const StoragePaths = {
  status: "/global/storage",
  progress: "/global/storage/progress",
  analyze: "/global/storage/analyze",
  backup: "/global/storage/backup",
  compact: "/global/storage/compact",
  checkpoint: "/global/storage/checkpoint",
  vacuum: "/global/storage/vacuum",
} as const

export const StorageApi = HttpApi.make("storage").add(
  HttpApiGroup.make("storage")
    .add(
      HttpApiEndpoint.get("status", StoragePaths.status, {
        success: described(StorageOverview, "Database storage status"),
        error: StorageMaintenanceError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "storage.status",
          summary: "Get database storage status",
          description: "Get the database, WAL, shared-memory, allocation, and reusable-page sizes.",
        }),
      ),
      HttpApiEndpoint.get("progress", StoragePaths.progress, {
        success: described(StorageProgress, "Storage maintenance progress"),
        error: StorageMaintenanceError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "storage.progress",
          summary: "Get storage maintenance progress",
          description: "Get the current maintenance phase, completed work, total work, and worker count.",
        }),
      ),
      HttpApiEndpoint.post("analyze", StoragePaths.analyze, {
        success: described(StorageAnalysis, "Event history cleanup analysis"),
        error: StorageMaintenanceError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "storage.analyze",
          summary: "Analyze event history cleanup",
          description: "Analyze replay-safe superseded event snapshots without changing session history.",
        }),
      ),
      HttpApiEndpoint.post("backup", StoragePaths.backup, {
        payload: StorageConfirmation,
        success: described(StorageBackup, "Verified database backup"),
        error: StorageMaintenanceError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "storage.backup",
          summary: "Create database backup",
          description: "Create and verify a consistent SQLite backup next to the active database.",
        }),
      ),
      HttpApiEndpoint.post("compact", StoragePaths.compact, {
        payload: StorageConfirmation,
        success: described(StorageCompact, "Event history compaction result"),
        error: StorageMaintenanceError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "storage.compact",
          summary: "Compact event history",
          description:
            "Create a verified backup, then replace replay-safe superseded event snapshots with checkpoints.",
        }),
      ),
      HttpApiEndpoint.post("checkpoint", StoragePaths.checkpoint, {
        payload: StorageConfirmation,
        success: described(StorageCheckpoint, "WAL checkpoint result"),
        error: StorageMaintenanceError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "storage.checkpoint",
          summary: "Checkpoint database WAL",
          description: "Checkpoint committed WAL frames and truncate the WAL when no reader prevents it.",
        }),
      ),
      HttpApiEndpoint.post("vacuum", StoragePaths.vacuum, {
        payload: StorageConfirmation,
        success: described(StorageVacuum, "Database vacuum result"),
        error: StorageMaintenanceError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "storage.vacuum",
          summary: "Reclaim database file space",
          description: "Create a verified backup, rebuild the active SQLite database, and verify its integrity.",
        }),
      ),
    )
    .annotateMerge(OpenApi.annotations({ title: "storage", description: "Database storage maintenance routes." })),
)
