import { Database } from "@opencode-ai/core/database/database"
import { DatabaseMaintenance } from "@opencode-ai/core/database/maintenance"
import { Cause, Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { RootHttpApi } from "../api"
import { StorageMaintenanceError } from "../groups/storage"

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

export const storageHandlers = HttpApiBuilder.group(RootHttpApi, "storage", (handlers) =>
  Effect.gen(function* () {
    const database = yield* Database.Service
    return handlers
      .handle("status", () => maintenance(DatabaseMaintenance.overview(database)))
      .handle("analyze", () => maintenance(DatabaseMaintenance.analyze(database)))
      .handle("backup", () => maintenance(DatabaseMaintenance.backup(database)))
      .handle("compact", () => maintenance(DatabaseMaintenance.compact(database)))
      .handle("checkpoint", () => maintenance(DatabaseMaintenance.checkpoint(database)))
      .handle("vacuum", () => maintenance(DatabaseMaintenance.vacuum(database)))
  }),
)
