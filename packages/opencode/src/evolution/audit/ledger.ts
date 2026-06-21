import { Context, Effect, Layer, Schema } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { InstanceState } from "@/effect/instance-state"
import { Config } from "@/config/config"
import path from "path"

export const AuditRecordType = Schema.Literals(["proposal_submit", "proposal_update", "reconciliation", "rejection"])
export type AuditRecordType = Schema.Schema.Type<typeof AuditRecordType>

export interface AuditProposalSubmit {
  proposalId: string
  status: string
  origin: { agent: string; sessionId: string }
}

export interface AuditProposalUpdate {
  proposalId: string
  fromStatus: string
  toStatus: string
}

export interface AuditReconciliation {
  reconciliationId: string
  candidates: string[]
  winner: string
  edi?: number
}

export interface AuditRejection {
  rejectionId: string
  code: string
  reason: string
}

export type AuditPayload = AuditProposalSubmit | AuditProposalUpdate | AuditReconciliation | AuditRejection

export interface AuditRecord {
  id: string
  type: AuditRecordType
  timestamp: number
  data: AuditPayload
  previousHash: string
  hash: string
}

export interface Interface {
  readonly append: (type: AuditRecordType, data: AuditPayload) => Effect.Effect<AuditRecord, FSUtil.Error>
  readonly query: (filter?: { type?: AuditRecordType; proposalId?: string; timeRange?: { from: number; to: number } }) => Effect.Effect<AuditRecord[], FSUtil.Error>
}

function nextID(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function computeHash(previousHash: string, timestamp: number, data: AuditPayload): string {
  const raw = `${previousHash}|${timestamp}|${JSON.stringify(data)}`
  return Bun.hash(raw).toString(36)
}

export const make = (baseDir: string, fs: FSUtil.Interface): Interface => {
  const filePath = path.join(baseDir, ".opencode", "evolution", "audit", "audit.jsonl")

  const readAll = (): Effect.Effect<AuditRecord[], FSUtil.Error> =>
    fs.readFileStringSafe(filePath).pipe(
      Effect.map((raw) => {
        if (!raw) return []
        return raw
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as AuditRecord)
      }),
    )

  const append = Effect.fn("AuditLedger.append")(function* (type: AuditRecordType, data: AuditPayload) {
    const existing = yield* readAll()
    const previousHash = existing.length > 0 ? existing[existing.length - 1].hash : ""
    const timestamp = Date.now()
    const id = nextID()
    const hash = computeHash(previousHash, timestamp, data)
    const record: AuditRecord = { id, type, timestamp, data, previousHash, hash }
    const line = JSON.stringify(record)
    const newContent = existing.length > 0
      ? existing.map((r) => JSON.stringify(r)).join("\n") + "\n" + line
      : line
    yield* fs.writeWithDirs(filePath, newContent)
    return record
  })

  const query = Effect.fn("AuditLedger.query")(function* (filter?: {
    type?: AuditRecordType
    proposalId?: string
    timeRange?: { from: number; to: number }
  }) {
    const records = yield* readAll()
    if (!filter) return records
    return records.filter((r) => {
      if (filter.type && r.type !== filter.type) return false
      if (filter.timeRange && (r.timestamp < filter.timeRange.from || r.timestamp > filter.timeRange.to)) return false
      if (filter.proposalId) {
        const d = r.data as AuditProposalSubmit | AuditProposalUpdate
        if ("proposalId" in d && d.proposalId !== filter.proposalId) return false
      }
      return true
    })
  })

  return { append, query }
}

function makeLedger(ctx: { worktree: string }, fs: FSUtil.Interface): Interface {
  return make(ctx.worktree, fs)
}

export class Service extends Context.Service<Service, Interface>()("@opencode/AuditLedger") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const fs = yield* FSUtil.Service
    const state = yield* InstanceState.make(
      Effect.fn("AuditLedger.state")(function* (ctx) {
        const cfg = yield* config.get()
        if (!cfg.evolution?.enabled) return undefined as Interface | undefined
        return makeLedger(ctx, fs)
      }),
    )
    const getLedger = Effect.fn("AuditLedger.get")(function* () {
      const s = yield* InstanceState.get(state)
      if (!s) return yield* Effect.die(new Error("AuditLedger not available (evolution disabled)"))
      return s
    })
    return Service.of({
      append: (type, data) => getLedger().pipe(Effect.flatMap((l) => l.append(type, data))),
      query: (filter) => getLedger().pipe(Effect.flatMap((l) => l.query(filter))),
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Config.defaultLayer),
  Layer.provide(FSUtil.defaultLayer),
)

export * as AuditLedger from "./ledger"
