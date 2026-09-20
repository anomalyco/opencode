import { createHash } from "crypto"
import { z } from "zod"
import { summarizeProgress } from "./progress"
import { DomainError, applyReport } from "./reducer"
import {
  DEFAULT_LIST_LIMIT,
  IdentifierSchema,
  MAX_ASSIGNMENTS,
  MAX_EVIDENCE,
  MAX_EVENTS,
  MAX_LIST_LIMIT,
  MAX_MUTATION_BYTES,
  MAX_RECEIPTS,
  MAX_RECORD_BYTES,
  MAX_SUMMARY_ROOTS,
  MAX_TASKS,
  RevisionSchema,
  RunSnapshotSchema,
  type Changed,
  type ErrorCode,
  type ExecutionError,
  type ReportCommand,
  type RunSnapshot,
  type RunSummary,
} from "./schema"

export type StorageValue =
  | null
  | number
  | boolean
  | string
  | readonly StorageValue[]
  | { readonly [key: string]: StorageValue | undefined }

export interface StorageScanOptions {
  readonly prefix: string
  readonly after?: string
  readonly limit?: number
}

export interface StorageEntry {
  readonly key: string
  readonly value: StorageValue
}

export interface StorageScanResult {
  readonly entries: readonly StorageEntry[]
  readonly next?: string
}

export interface StoragePort {
  get(key: string): Promise<StorageValue | undefined>
  set(key: string, value: StorageValue): Promise<void>
  scan(options: StorageScanOptions): Promise<StorageScanResult>
}

export interface ReportPrincipal {
  readonly sessionID: string
  readonly rootSessionID: string
}

export type Receipt = {
  readonly operationID: string
  readonly payloadHash: string
  readonly revision: number
}

export type RunAggregate = {
  readonly snapshot: RunSnapshot
  readonly receipts: Receipt[]
}

export interface ReportResponse {
  readonly run: RunSnapshot
  readonly appliedRevision: number
  readonly duplicate: boolean
}

export type RepositoryOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ExecutionError }

export interface RunRepositoryOptions {
  readonly storage: StoragePort
  readonly ownerDirectory: string
  readonly now: () => number
  readonly onChanged?: (event: Changed) => void | Promise<void>
}

export interface ListRunsInput {
  readonly rootSessionID: string
  readonly after?: string
  readonly limit?: number
}

export interface RunList {
  readonly items: RunSummary[]
  readonly next?: string
}

export interface SummaryList {
  readonly items: RunSummary[]
}

export interface RunRepository {
  report(command: ReportCommand, principal: ReportPrincipal): Promise<RepositoryOutcome<ReportResponse>>
  getRun(rootSessionID: string, runID: string): Promise<RepositoryOutcome<RunSnapshot>>
  listRuns(input: ListRunsInput): Promise<RepositoryOutcome<RunList>>
  getSummaries(input: { readonly rootSessionIDs: readonly string[] }): Promise<RepositoryOutcome<SummaryList>>
  close(): Promise<void>
}

interface RepositoryContext {
  readonly storage: StoragePort
  readonly ownerDirectory: string
  readonly now: () => number
}

interface Commit {
  readonly duplicate: boolean
  readonly aggregate: RunAggregate
  readonly response: ReportResponse
}

type QueueResult =
  | { readonly ok: true; readonly value: ReportResponse; readonly notify: RunSnapshot | undefined }
  | { readonly ok: false; readonly error: ExecutionError }

interface SnapshotEntry {
  readonly key: string
  readonly snapshot: RunSnapshot
}

interface WriterQueue {
  run<T>(key: string, task: () => Promise<T>): Promise<T>
}

const KEY_PREFIX = "superpowers.execution.v1"
const SCAN_PAGE_SIZE = 50
const HASH_PATTERN = /^[a-f0-9]{64}$/

const ReceiptSchema = z.strictObject({
  operationID: IdentifierSchema,
  payloadHash: z.string().regex(HASH_PATTERN),
  revision: RevisionSchema,
})

const RunAggregateSchema = z.strictObject({
  snapshot: RunSnapshotSchema,
  receipts: z.array(ReceiptSchema).max(MAX_RECEIPTS),
})

export function runKey(ownerDirectory: string, rootSessionID: string, runID: string): string {
  return `${runKeyPrefix(ownerDirectory, rootSessionID)}${runID}`
}

function runKeyPrefix(ownerDirectory: string, rootSessionID: string): string {
  return `${KEY_PREFIX}/${encodeURIComponent(ownerDirectory)}/${rootSessionID}/`
}

function runIDFromKey(key: string, prefix: string): string {
  return key.slice(prefix.length)
}

export function createRunRepository(options: RunRepositoryOptions): RunRepository {
  const context: RepositoryContext = {
    storage: options.storage,
    ownerDirectory: options.ownerDirectory,
    now: options.now,
  }
  const queue = createWriterQueue()
  const pending = new Set<Promise<void>>()
  let closed = false

  const trackAccepted = (accepted: Promise<RepositoryOutcome<ReportResponse>>): Promise<RepositoryOutcome<ReportResponse>> => {
    const tracked = accepted.then(
      () => undefined,
      () => undefined,
    )
    pending.add(tracked)
    tracked.then(() => {
      pending.delete(tracked)
    })
    return accepted
  }

  return {
    async report(command, principal) {
      if (closed) return failure("storage_unavailable", "repository is closed")
      if (principal.sessionID !== principal.rootSessionID) {
        return failure("forbidden", "only the root controller can report")
      }
      return trackAccepted(acceptReport(context, options.onChanged, queue, command, principal))
    },
    async getRun(rootSessionID, runID) {
      return readRun(context, rootSessionID, runID)
    },
    async listRuns(input) {
      return readRunList(context, input)
    },
    async getSummaries(input) {
      return readSummaries(context, input.rootSessionIDs)
    },
    async close() {
      closed = true
      await Promise.all([...pending])
    },
  }
}

async function acceptReport(
  context: RepositoryContext,
  onChanged: RunRepositoryOptions["onChanged"],
  queue: WriterQueue,
  command: ReportCommand,
  principal: ReportPrincipal,
): Promise<RepositoryOutcome<ReportResponse>> {
  const queued = await queue.run(runKeyPrefix(context.ownerDirectory, principal.rootSessionID), () =>
    runReport(context, command, principal),
  )
  if (!queued.ok) return queued
  if (queued.notify !== undefined) await notifyCommitted(onChanged, queued.notify)
  return { ok: true, value: queued.value }
}

async function runReport(
  context: RepositoryContext,
  command: ReportCommand,
  principal: ReportPrincipal,
): Promise<QueueResult> {
  const key = runKey(context.ownerDirectory, principal.rootSessionID, command.runID)
  const stored = await attempt(() => context.storage.get(key))
  if (!stored.ok) return stored
  const decoded = decodeAggregate(stored.value)
  if (!decoded.ok) return decoded
  const previous = decoded.value
  if (command.operation.type === "run.start" && previous === undefined) {
    const active = await activeRunID(context, principal.rootSessionID)
    if (!active.ok) return active
    if (active.value !== undefined) {
      return failure("operation_conflict", `run already active: ${active.value}`)
    }
  }
  const prepared = runPrepare(context, previous, command, principal)
  if (!prepared.ok) return prepared
  if (prepared.value.duplicate) return { ok: true, value: prepared.value.response, notify: undefined }
  const written = await writeAggregate(context, key, prepared.value.aggregate)
  if (!written.ok) return written
  return { ok: true, value: prepared.value.response, notify: prepared.value.aggregate.snapshot }
}

function prepareCommit(
  context: RepositoryContext,
  previous: RunAggregate | undefined,
  command: ReportCommand,
  principal: ReportPrincipal,
): Commit {
  const payloadHash = hashPayload(command)
  if (previous !== undefined) {
    const receipt = previous.receipts.find((candidate) => candidate.operationID === command.operationID)
    if (receipt !== undefined) {
      if (receipt.payloadHash !== payloadHash) {
        throw domainError("operation_conflict", `operation ${command.operationID} was already accepted with different input`)
      }
      return {
        duplicate: true,
        aggregate: previous,
        response: { run: previous.snapshot, appliedRevision: receipt.revision, duplicate: true },
      }
    }
  }
  assertPayloadBytes(command)
  const snapshot = applyReport(previous?.snapshot, command, {
    rootSessionID: principal.rootSessionID,
    ownerDirectory: context.ownerDirectory,
    now: context.now(),
  })
  const aggregate = buildAggregate(snapshot, previous?.receipts ?? [], command.operationID, payloadHash)
  return {
    duplicate: false,
    aggregate,
    response: { run: aggregate.snapshot, appliedRevision: aggregate.snapshot.revision, duplicate: false },
  }
}

async function notifyCommitted(
  onChanged: RunRepositoryOptions["onChanged"],
  snapshot: RunSnapshot,
): Promise<void> {
  if (onChanged === undefined) return
  try {
    await onChanged({ rootSessionID: snapshot.rootSessionID, runID: snapshot.runID, revision: snapshot.revision })
  } catch {
    return
  }
}

function runPrepare(
  context: RepositoryContext,
  previous: RunAggregate | undefined,
  command: ReportCommand,
  principal: ReportPrincipal,
): RepositoryOutcome<Commit> {
  try {
    return { ok: true, value: prepareCommit(context, previous, command, principal) }
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, error: error.error }
    throw error
  }
}

function buildAggregate(
  snapshot: RunSnapshot,
  receipts: readonly Receipt[],
  operationID: string,
  payloadHash: string,
): RunAggregate {
  const cappedSnapshot = capSnapshot(snapshot)
  const aggregate: RunAggregate = {
    snapshot: cappedSnapshot,
    receipts: capReceipts([...receipts, { operationID, payloadHash, revision: snapshot.revision }]),
  }
  assertRecordBytes(aggregate)
  return aggregate
}

function capSnapshot(snapshot: RunSnapshot): RunSnapshot {
  assertCountLimits(snapshot)
  if (snapshot.events.length <= MAX_EVENTS) return snapshot
  const events = snapshot.events.slice(snapshot.events.length - MAX_EVENTS)
  return { ...snapshot, events, historyTruncatedBeforeRevision: events[0].revision }
}

function capReceipts(receipts: Receipt[]): Receipt[] {
  return receipts.length <= MAX_RECEIPTS ? receipts : receipts.slice(receipts.length - MAX_RECEIPTS)
}

function assertCountLimits(snapshot: RunSnapshot): void {
  if (snapshot.tasks.length > MAX_TASKS) throw domainError("limit_exceeded", `run exceeds ${MAX_TASKS} tasks`)
  if (snapshot.assignments.length > MAX_ASSIGNMENTS) {
    throw domainError("limit_exceeded", `run exceeds ${MAX_ASSIGNMENTS} assignments`)
  }
  if (snapshot.evidence.length > MAX_EVIDENCE) {
    throw domainError("limit_exceeded", `run exceeds ${MAX_EVIDENCE} evidence records`)
  }
}

function assertPayloadBytes(command: ReportCommand): void {
  if (Buffer.byteLength(JSON.stringify(command), "utf8") > MAX_MUTATION_BYTES) {
    throw domainError("limit_exceeded", `mutation payload exceeds ${MAX_MUTATION_BYTES} bytes`)
  }
}

function assertRecordBytes(aggregate: RunAggregate): void {
  if (Buffer.byteLength(JSON.stringify(aggregate), "utf8") > MAX_RECORD_BYTES) {
    throw domainError("limit_exceeded", `stored run record exceeds ${MAX_RECORD_BYTES} bytes`)
  }
}

function hashPayload(command: ReportCommand): string {
  return createHash("sha256").update(canonical(command)).digest("hex")
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

async function writeAggregate(
  context: RepositoryContext,
  key: string,
  aggregate: RunAggregate,
): Promise<RepositoryOutcome<RunAggregate>> {
  try {
    await context.storage.set(key, aggregate)
    return { ok: true, value: aggregate }
  } catch (error) {
    const stored = await attempt(() => context.storage.get(key))
    if (stored.ok && stored.value !== undefined) {
      const decoded = decodeAggregate(stored.value)
      if (decoded.ok && decoded.value !== undefined && decoded.value.snapshot.revision >= aggregate.snapshot.revision) {
        return { ok: true, value: aggregate }
      }
    }
    return failure("storage_unavailable", errorDetail(error))
  }
}

async function activeRunID(context: RepositoryContext, rootSessionID: string): Promise<RepositoryOutcome<string | undefined>> {
  const collected = await collectSnapshots(context, rootSessionID, undefined, undefined)
  if (!collected.ok) return collected
  return { ok: true, value: collected.value.items.find((entry) => entry.snapshot.status === "active")?.snapshot.runID }
}

async function readRun(
  context: RepositoryContext,
  rootSessionID: string,
  runID: string,
): Promise<RepositoryOutcome<RunSnapshot>> {
  const key = runKey(context.ownerDirectory, rootSessionID, runID)
  const stored = await attempt(() => context.storage.get(key))
  if (!stored.ok) return stored
  const decoded = decodeAggregate(stored.value)
  if (!decoded.ok) return decoded
  if (decoded.value === undefined) return failure("not_found", `run not found: ${runID}`)
  return { ok: true, value: decoded.value.snapshot }
}

async function readRunList(context: RepositoryContext, input: ListRunsInput): Promise<RepositoryOutcome<RunList>> {
  const collected = await collectSnapshots(context, input.rootSessionID, input.after, normalizeLimit(input.limit))
  if (!collected.ok) return collected
  const next = collected.value.next
  return {
    ok: true,
    value: {
      items: collected.value.items.map((entry) => toSummary(entry.snapshot)),
      ...(next === undefined ? {} : { next }),
    },
  }
}

async function readSummaries(
  context: RepositoryContext,
  rootSessionIDs: readonly string[],
): Promise<RepositoryOutcome<SummaryList>> {
  const items: RunSummary[] = []
  for (const rootSessionID of rootSessionIDs.slice(0, MAX_SUMMARY_ROOTS)) {
    const collected = await collectSnapshots(context, rootSessionID, undefined, undefined)
    if (!collected.ok) return collected
    const preferred = chooseSummary(collected.value.items.map((entry) => entry.snapshot))
    if (preferred !== undefined) items.push(toSummary(preferred))
  }
  return { ok: true, value: { items } }
}

async function collectSnapshots(
  context: RepositoryContext,
  rootSessionID: string,
  after: string | undefined,
  limit: number | undefined,
): Promise<RepositoryOutcome<{ items: SnapshotEntry[]; next?: string }>> {
  const prefix = runKeyPrefix(context.ownerDirectory, rootSessionID)
  const items: SnapshotEntry[] = []
  let cursor = after === undefined ? undefined : `${prefix}${after}`
  for (;;) {
    const pageSize = limit === undefined ? SCAN_PAGE_SIZE : Math.max(limit - items.length, 1)
    const page = await attempt(() => context.storage.scan({ prefix, after: cursor, limit: pageSize }))
    if (!page.ok) return page
    for (const entry of page.value.entries) {
      const decoded = decodeAggregate(entry.value)
      if (!decoded.ok) return decoded
      if (decoded.value !== undefined) items.push({ key: entry.key, snapshot: decoded.value.snapshot })
    }
    if (limit !== undefined && items.length >= limit) {
      return {
        ok: true,
        value: {
          items,
          ...(page.value.next === undefined ? {} : { next: runIDFromKey(items[items.length - 1].key, prefix) }),
        },
      }
    }
    if (page.value.next === undefined) return { ok: true, value: { items } }
    cursor = page.value.next
  }
}

function chooseSummary(snapshots: readonly RunSnapshot[]): RunSnapshot | undefined {
  return snapshots.reduce<RunSnapshot | undefined>((best, snapshot) => {
    if (best === undefined) return snapshot
    const rank = snapshot.status === "active" ? 0 : 1
    const bestRank = best.status === "active" ? 0 : 1
    if (rank !== bestRank) return rank < bestRank ? snapshot : best
    return snapshot.updatedAt > best.updatedAt ? snapshot : best
  }, undefined)
}

function toSummary(snapshot: RunSnapshot): RunSummary {
  return {
    runID: snapshot.runID,
    rootSessionID: snapshot.rootSessionID,
    ownerDirectory: snapshot.ownerDirectory,
    title: snapshot.title,
    status: snapshot.status,
    revision: snapshot.revision,
    updatedAt: snapshot.updatedAt,
    planRevision: snapshot.plan.revision,
    progress: summarizeProgress(snapshot.tasks),
  }
}

function decodeAggregate(value: StorageValue | undefined): RepositoryOutcome<RunAggregate | undefined> {
  if (value === undefined) return { ok: true, value: undefined }
  const parsed = RunAggregateSchema.safeParse(value)
  if (!parsed.success) return failure("incompatible_schema", "stored run record is not readable")
  return { ok: true, value: parsed.data }
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LIST_LIMIT
  return Math.min(Math.max(limit, 1), MAX_LIST_LIMIT)
}

async function attempt<T>(operation: () => Promise<T>): Promise<RepositoryOutcome<T>> {
  try {
    return { ok: true, value: await operation() }
  } catch (error) {
    return failure("storage_unavailable", errorDetail(error))
  }
}

function failure(code: ErrorCode, detail: string): { ok: false; error: ExecutionError } {
  return { ok: false, error: { code, detail } }
}

function domainError(code: ErrorCode, detail: string): DomainError {
  return new DomainError({ code, detail })
}

function errorDetail(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error)
  return detail.slice(0, 1_000)
}

function createWriterQueue(): WriterQueue {
  const tails = new Map<string, Promise<void>>()
  return {
    run(key, task) {
      const previous = tails.get(key) ?? Promise.resolve()
      const next = previous.then(task, task)
      tails.set(
        key,
        next.then(
          () => undefined,
          () => undefined,
        ),
      )
      return next
    },
  }
}
