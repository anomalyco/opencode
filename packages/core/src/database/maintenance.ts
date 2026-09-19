export * as DatabaseMaintenance from "./maintenance"

import { sql } from "drizzle-orm"
import { DateTime, Effect, Semaphore } from "effect"
import { basename, dirname, extname, join } from "node:path"
import { Database } from "./database"
import { DatabaseMaintenanceGate } from "./maintenance-gate"
import { SessionEventLogCompaction } from "../session/event-log-compaction"

const BATCH_SIZE = 10_000
const SESSION_BATCH_SIZE = 1_000
const lock = Semaphore.makeUnsafe(1)

export type Overview = {
  readonly path: string
  readonly databaseBytes: number
  readonly walBytes: number
  readonly shmBytes: number
  readonly totalBytes: number
  readonly pageSize: number
  readonly pageCount: number
  readonly allocatedBytes: number
  readonly reusablePages: number
  readonly reusableBytes: number
}

export type TypeSummary = {
  readonly events: number
  readonly payloadBytesReclaimable: number
}

export type Analysis = {
  readonly snapshots: number
  readonly inspected: number
  readonly candidates: number
  readonly projectionMismatches: number
  readonly compatibilityRejected: number
  readonly malformed: number
  readonly payloadBytesReclaimable: number
  readonly byType: Readonly<Record<string, TypeSummary>>
}

export type Backup = {
  readonly path: string
  readonly bytes: number
  readonly integrity: "ok"
}

export type Compact = Analysis & {
  readonly rewritten: number
  readonly backup: Backup
  readonly before: Overview
  readonly after: Overview
}

export type Checkpoint = {
  readonly busy: number
  readonly logFrames: number
  readonly checkpointedFrames: number
  readonly before: Overview
  readonly after: Overview
}

export type Vacuum = {
  readonly backup: Backup
  readonly bytesReclaimed: number
  readonly checkpointBusy: number
  readonly before: Overview
  readonly after: Overview
}

type MutableAnalysis = {
  snapshots: number
  inspected: number
  candidates: number
  rewritten: number
  projectionMismatches: number
  compatibilityRejected: number
  malformed: number
  payloadBytesReclaimable: number
  byType: Record<string, TypeSummary>
}

const fileBytes = Effect.fn("DatabaseMaintenance.fileBytes")((path: string) =>
  Effect.promise(async () => {
    const file = Bun.file(path)
    return (await file.exists()) ? file.size : 0
  }),
)

const overviewUnlocked = Effect.fn("DatabaseMaintenance.overviewUnlocked")(function* (database: Database.Interface) {
  const path = database.path
  const pages = yield* database.db
    .get<{ pageSize: number; pageCount: number; reusablePages: number }>(
      sql`
      SELECT (SELECT page_size FROM pragma_page_size) AS pageSize,
             (SELECT page_count FROM pragma_page_count) AS pageCount,
             (SELECT freelist_count FROM pragma_freelist_count) AS reusablePages
    `,
    )
    .pipe(Effect.orDie)
  const files =
    path === ":memory:"
      ? { databaseBytes: 0, walBytes: 0, shmBytes: 0 }
      : yield* Effect.all(
          {
            databaseBytes: fileBytes(path),
            walBytes: fileBytes(`${path}-wal`),
            shmBytes: fileBytes(`${path}-shm`),
          },
          { concurrency: "unbounded" },
        )
  const pageSize = pages?.pageSize ?? 0
  const pageCount = pages?.pageCount ?? 0
  const reusablePages = pages?.reusablePages ?? 0
  return {
    path,
    ...files,
    totalBytes: files.databaseBytes + files.walBytes + files.shmBytes,
    pageSize,
    pageCount,
    allocatedBytes: pageSize * pageCount,
    reusablePages,
    reusableBytes: pageSize * reusablePages,
  } satisfies Overview
})

function emptyAnalysis(snapshots: number, malformed: number): MutableAnalysis {
  return {
    snapshots,
    inspected: 0,
    candidates: 0,
    rewritten: 0,
    projectionMismatches: 0,
    compatibilityRejected: 0,
    malformed,
    payloadBytesReclaimable: 0,
    byType: {},
  }
}

function addReport(target: MutableAnalysis, report: SessionEventLogCompaction.Report, includeMalformed = false) {
  target.inspected += report.inspected
  target.candidates += report.candidates
  target.rewritten += report.rewritten
  target.projectionMismatches += report.projectionMismatches
  target.compatibilityRejected += report.compatibilityRejected
  if (includeMalformed) target.malformed += report.malformed
  target.payloadBytesReclaimable += report.payloadBytesReclaimed
  Object.entries(report.byType).forEach(([type, summary]) => {
    const current = target.byType[type] ?? { events: 0, payloadBytesReclaimable: 0 }
    target.byType[type] = {
      events: current.events + summary.events,
      payloadBytesReclaimable: current.payloadBytesReclaimable + summary.payloadBytesReclaimed,
    }
  })
}

const index = Effect.fn("DatabaseMaintenance.index")(function* (db: Database.Interface["db"]) {
  const prepared = yield* SessionEventLogCompaction.prepareIndex(db)
  if (!prepared) throw new Error("Failed to prepare the event compaction index")
  return prepared
})

const analyzeUnlocked = Effect.fn("DatabaseMaintenance.analyzeUnlocked")(function* (database: Database.Interface) {
  const status = yield* SessionEventLogCompaction.status(database.db)
  const result = emptyAnalysis(status.compactableEvents, 0)
  let cursor: string | undefined
  while (true) {
    const sessions = yield* database.db
      .all<{ id: string }>(
        sql`
        SELECT id FROM session
        ${cursor ? sql`WHERE id > ${cursor}` : sql``}
        ORDER BY id
        LIMIT ${SESSION_BATCH_SIZE}
      `,
      )
      .pipe(Effect.orDie)
    for (const session of sessions) {
      let afterSeq: number | undefined
      while (true) {
        const report = yield* SessionEventLogCompaction.compact(database.db, {
          aggregateID: session.id,
          apply: false,
          limit: BATCH_SIZE,
          afterSeq,
        })
        addReport(result, report, true)
        afterSeq = report.next?.afterSeq
        if (afterSeq === undefined) break
      }
    }
    if (sessions.length < SESSION_BATCH_SIZE) break
    cursor = sessions.at(-1)?.id
  }
  return {
    snapshots: result.snapshots,
    inspected: result.inspected,
    candidates: result.candidates,
    projectionMismatches: result.projectionMismatches,
    compatibilityRejected: result.compatibilityRejected,
    malformed: result.malformed,
    payloadBytesReclaimable: result.payloadBytesReclaimable,
    byType: result.byType,
  } satisfies Analysis
})

const backupTarget = Effect.fn("DatabaseMaintenance.backupTarget")(function* (source: string) {
  if (source === ":memory:") throw new Error("In-memory databases cannot be backed up")
  const stamp = (yield* DateTime.nowAsDate).toISOString().replaceAll(":", "-")
  const extension = extname(source) || ".db"
  const name = basename(source, extname(source))
  return join(dirname(source), `${name}.backup-${stamp}-${crypto.randomUUID().slice(0, 8)}${extension}`)
})

const backupUnlocked = Effect.fn("DatabaseMaintenance.backupUnlocked")(function* (database: Database.Interface) {
  const report = yield* SessionEventLogCompaction.copy(database.db, yield* backupTarget(database.path))
  return {
    path: report.path,
    bytes: yield* fileBytes(report.path),
    integrity: report.integrity,
  } satisfies Backup
})

const compactUnlocked = Effect.fn("DatabaseMaintenance.compactUnlocked")(function* (database: Database.Interface) {
  const before = yield* overviewUnlocked(database)
  const backup = yield* backupUnlocked(database)
  const prepared = yield* index(database.db)
  const result = emptyAnalysis(prepared.snapshots, prepared.malformed)
  while (true) {
    const batch = yield* SessionEventLogCompaction.compactIndexed(database.db, BATCH_SIZE)
    addReport(result, batch.report)
    if (batch.cursor === undefined) break
  }
  yield* SessionEventLogCompaction.verify(database.db)
  return {
    ...result,
    backup,
    before,
    after: yield* overviewUnlocked(database),
  } satisfies Compact
})

const checkpointUnlocked = Effect.fn("DatabaseMaintenance.checkpointUnlocked")(function* (
  database: Database.Interface,
) {
  const before = yield* overviewUnlocked(database)
  const row = yield* database.db
    .get<{ busy: number; log: number; checkpointed: number }>(sql`PRAGMA wal_checkpoint(TRUNCATE)`)
    .pipe(Effect.orDie)
  return {
    busy: row?.busy ?? 0,
    logFrames: row?.log ?? 0,
    checkpointedFrames: row?.checkpointed ?? 0,
    before,
    after: yield* overviewUnlocked(database),
  } satisfies Checkpoint
})

const vacuumUnlocked = Effect.fn("DatabaseMaintenance.vacuumUnlocked")(function* (database: Database.Interface) {
  const before = yield* overviewUnlocked(database)
  const backup = yield* backupUnlocked(database)
  yield* SessionEventLogCompaction.verify(database.db)
  yield* database.db.run(sql`VACUUM`).pipe(Effect.orDie)
  yield* SessionEventLogCompaction.verify(database.db)
  const checkpoint = yield* database.db.get<{ busy: number }>(sql`PRAGMA wal_checkpoint(TRUNCATE)`).pipe(Effect.orDie)
  const after = yield* overviewUnlocked(database)
  return {
    backup,
    bytesReclaimed: Math.max(0, before.totalBytes - after.totalBytes),
    checkpointBusy: checkpoint?.busy ?? 0,
    before,
    after,
  } satisfies Vacuum
})

function guarded<A, E, R>(effect: Effect.Effect<A, E, R>) {
  return lock.withPermit(effect)
}

export const exclusive = guarded

export const overview = Effect.fn("DatabaseMaintenance.overview")((database: Database.Interface) =>
  guarded(overviewUnlocked(database)),
)

export const analyze = Effect.fn("DatabaseMaintenance.analyze")((database: Database.Interface) =>
  guarded(analyzeUnlocked(database)),
)

export const backup = Effect.fn("DatabaseMaintenance.backup")((database: Database.Interface) =>
  guarded(backupUnlocked(database)),
)

type ExclusiveOptions = {
  readonly onGateStatus?: (status: DatabaseMaintenanceGate.Status) => void
}

export const compact = Effect.fn("DatabaseMaintenance.compact")(
  (database: Database.Interface, options: ExclusiveOptions = {}) =>
    DatabaseMaintenanceGate.exclusive(
      "compact",
      guarded(compactUnlocked(database).pipe(Effect.ensuring(SessionEventLogCompaction.dropIndex(database.db)))),
      { onStatus: options.onGateStatus },
    ),
)

export const checkpoint = Effect.fn("DatabaseMaintenance.checkpoint")((database: Database.Interface) =>
  guarded(checkpointUnlocked(database)),
)

export const vacuum = Effect.fn("DatabaseMaintenance.vacuum")(
  (database: Database.Interface, options: ExclusiveOptions = {}) =>
    DatabaseMaintenanceGate.exclusive("vacuum", guarded(vacuumUnlocked(database)), {
      onStatus: options.onGateStatus,
    }),
)
