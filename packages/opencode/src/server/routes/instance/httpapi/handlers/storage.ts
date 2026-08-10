import { Database } from "@opencode-ai/core/database/database"
import { DatabaseMaintenance } from "@opencode-ai/core/database/maintenance"
import { ParallelStorageAnalysis } from "@/storage-maintenance/parallel-analysis"
import { StorageMaintenanceProgress } from "@/storage-maintenance/progress"
import { Cause, Effect, Semaphore } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { RootHttpApi } from "../api"
import { StorageMaintenanceError } from "../groups/storage"

const requestLock = Semaphore.makeUnsafe(1)

function maintenance<A, E, R>(effect: Effect.Effect<A, E, R>) {
  return effect.pipe(
    Effect.catchCause((cause) => {
      const die = cause.reasons.find(Cause.isDieReason)
      const fail = cause.reasons.find(Cause.isFailReason)
      const reason: unknown = die?.defect ?? fail?.error
      return Effect.fail(
        new StorageMaintenanceError({
          name: "StorageMaintenanceError",
          data: { message: reason instanceof Error ? reason.message : "Database maintenance failed" },
        }),
      )
    }),
  )
}

function tracked<A, E, R>(
  operation: StorageMaintenanceProgress.Operation,
  effect: (id: string) => Effect.Effect<A, E, R>,
) {
  return requestLock.withPermit(
    Effect.suspend(() => {
      const id = StorageMaintenanceProgress.begin(operation, operation)
      return effect(id).pipe(Effect.ensuring(Effect.sync(() => StorageMaintenanceProgress.finish(id))))
    }),
  )
}

export const storageHandlers = HttpApiBuilder.group(RootHttpApi, "storage", (handlers) =>
  Effect.gen(function* () {
    const database = yield* Database.Service
    return handlers
      .handle("status", () => maintenance(DatabaseMaintenance.overview(database)))
      .handle("progress", () => Effect.sync(StorageMaintenanceProgress.current))
      .handle("analyze", () =>
        maintenance(
          tracked("analyze", (id) =>
            DatabaseMaintenance.exclusive(
              Effect.tryPromise({
                try: (signal) =>
                  ParallelStorageAnalysis.analyze(database.path, {
                    signal,
                    onProgress: (progress) => StorageMaintenanceProgress.update(id, progress),
                  }),
                catch: (cause) => cause,
              }),
            ),
          ),
        ),
      )
      .handle("backup", () => maintenance(tracked("backup", () => DatabaseMaintenance.backup(database))))
      .handle("compact", () => maintenance(tracked("compact", () => DatabaseMaintenance.compact(database))))
      .handle("checkpoint", () => maintenance(tracked("checkpoint", () => DatabaseMaintenance.checkpoint(database))))
      .handle("vacuum", () => maintenance(tracked("vacuum", () => DatabaseMaintenance.vacuum(database))))
  }),
)
