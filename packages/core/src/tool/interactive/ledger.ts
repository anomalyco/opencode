export * as InteractiveLedger from "./ledger"

import path from "path"
import { Context, Duration, Effect, Layer, Schema, Semaphore } from "effect"
import { NonNegativeInt, PositiveInt } from "../../schema"
import { FSUtil } from "../../fs-util"
import { Global } from "../../global"
import { Hash } from "../../util/hash"
import { Location } from "../../location"
import { makeLocationNode } from "../../effect/app-node"

/**
 * One row of the per-Location job ledger (spec R30). Exactly the minimum
 * needed to reap orphans after a crash: which process group was spawned, for
 * which Session, when. Rows are deleted on the job's terminal transition —
 * the ledger is a side file, not durable session events (L8).
 */
export const Row = Schema.Struct({
  jobID: Schema.String,
  sessionID: Schema.String,
  pgid: PositiveInt,
  startedAt: NonNegativeInt,
})
export type Row = typeof Row.Type

/**
 * Orphan ledger (spec R30). The store keeps one managed file per Location,
 * `interactive/<location-key>/jobs.json`, atomically rewritten on every
 * mutation. Invariant I9: before any NEW job spawns in a Location, `sweep`
 * has killed every recorded process group still alive (SIGTERM → SIGKILL
 * grace, rows dropped) — orphan cleanup does not wait for the owning Session
 * to be reopened. After a crash there is no job replay (spec R31): the sweep
 * is the only recovery, and calls still projected `running` are durably
 * failed by the existing `failInterruptedTools` rule.
 */
export interface Interface {
  /** Atomically upsert the row for a live job. Called right after spawn. */
  readonly record: (row: Row) => Effect.Effect<void, LedgerError>
  /** Drop the row on the job's terminal transition. Missing rows are ignored. */
  readonly remove: (jobID: string) => Effect.Effect<void, LedgerError>
  /**
   * Kill every recorded process group still alive and drop all rows.
   * Returns how many orphans were reaped. Runs at Location startup, before
   * any new spawn (invariant I9), and is idempotent.
   */
  readonly sweep: () => Effect.Effect<number, LedgerError>
}

export class LedgerError extends Schema.TaggedErrorClass<LedgerError>()("InteractiveLedger.Error", {
  operation: Schema.Literals(["record", "remove", "sweep"]),
  cause: Schema.Defect(),
}) {
  override get message() {
    const detail = this.cause instanceof Error ? this.cause.message : String(this.cause)
    return `Interactive ledger ${this.operation} failed${detail ? `: ${detail}` : ""}`
  }
}

export type Error = LedgerError

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/InteractiveLedger") {}

/** SIGTERM → SIGKILL grace for the startup sweep; short, since it blocks the first spawn in a Location (spec R30). */
const SWEEP_GRACE_MS = 500

const decodeRows = Schema.decodeUnknownEffect(Schema.Array(Row))

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const location = yield* Location.Service
    // the ledger key mixes directory and workspace so two Locations never reap each other's groups
    const key = Hash.fast(`${location.directory}\u0000${location.workspaceID ?? ""}`)
    const directory = path.join(global.data, "interactive", key)
    const file = path.join(directory, "jobs.json")

    const ledgerError = (operation: "record" | "remove" | "sweep") => (cause: unknown) => new LedgerError({ operation, cause })

    const readRows = Effect.fn("InteractiveLedger.readRows")(function* () {
      const raw = yield* fs.readJson(file).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (raw === undefined) return [] as Row[]
      return yield* decodeRows(raw).pipe(Effect.catch(() => Effect.succeed([] as Row[])))
    })

    const writeRows = Effect.fn("InteractiveLedger.writeRows")(function* (rows: ReadonlyArray<Row>) {
      yield* fs.ensureDir(directory).pipe(Effect.mapError(ledgerError("record")))
      const temp = `${file}.${process.pid}.tmp`
      yield* fs.writeJson(temp, rows).pipe(Effect.mapError(ledgerError("record")))
      // rename makes the rewrite atomic, so a crash mid-write cannot strand a half-file (spec R30)
      yield* fs.rename(temp, file).pipe(Effect.mapError(ledgerError("record")))
    })

    // Single-writer serialization (spec R30): `record` and `remove` are read-
    // modify-write rewrites of the whole file, so interleaved runs from
    // concurrent Sessions would lose updates.
    const writer = Semaphore.makeUnsafe(1)

    const record = Effect.fn("InteractiveLedger.record")(function* (row: Row) {
      yield* writer.withPermits(1)(
        Effect.gen(function* () {
          const rows = (yield* readRows()).filter((entry) => entry.jobID !== row.jobID)
          rows.push(row)
          yield* writeRows(rows)
        }),
      )
    })

    const remove = Effect.fn("InteractiveLedger.remove")(function* (jobID: string) {
      yield* writer.withPermits(1)(
        Effect.gen(function* () {
          const rows = yield* readRows()
          const next = rows.filter((entry) => entry.jobID !== jobID)
          if (next.length === rows.length) return
          yield* writeRows(next)
        }),
      )
    })

    const groupAlive = (pgid: number) => {
      if (process.platform === "win32" || pgid <= 1) return false
      try {
        process.kill(-pgid, 0)
        return true
      } catch (error) {
        return error instanceof Error && "code" in error && error.code === "EPERM"
      }
    }

    const signalGroup = (pgid: number, signal: NodeJS.Signals) => {
      try {
        process.kill(-pgid, signal)
      } catch {}
    }

    const sweep = Effect.fn("InteractiveLedger.sweep")(function* () {
      const reaped = yield* writer.withPermits(1)(
        Effect.gen(function* () {
          const rows = yield* readRows()
          const targets = rows.filter((row) => groupAlive(row.pgid))
          for (const row of targets) signalGroup(row.pgid, "SIGTERM")
          if (targets.length > 0) yield* Effect.sleep(Duration.millis(SWEEP_GRACE_MS))
          for (const row of targets) {
            if (groupAlive(row.pgid)) signalGroup(row.pgid, "SIGKILL")
          }
          if (rows.length > 0) yield* writeRows([])
          return targets.length
        }),
      )
      return reaped
    })

    return Service.of({ record, remove, sweep })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Global.node, Location.node, FSUtil.node] })
