import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { InstanceState } from "@/effect/instance-state"
import { Duration, Effect, Layer, Context, Option, Schema } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { KeyedMutex } from "@opencode-ai/core/effect/keyed-mutex"
import { Config } from "@/config/config"
import { EvolutionStorageError, toEvolutionStorageError } from "@/evolution/error"
import type { DecisionProposal, ProposalOrigin, ProposalStatus } from "@/evolution/decision/proposal"
import { validateSchema } from "@/evolution/decision/validation"
import { ProposalStore } from "./proposal-store"
import { ReconciliationLogSchema } from "@/evolution/decision/reconciliation-log"
import type { ReconciliationLog } from "@/evolution/decision/reconciliation-log"
import path from "path"

export class EvolutionNotEnabledError extends Schema.TaggedErrorClass<EvolutionNotEnabledError>()("EvolutionDecisionsNotEnabledError", {
  message: Schema.String,
}) {}

export class AdrNotFoundError extends Schema.TaggedErrorClass<AdrNotFoundError>()("EvolutionAdrNotFoundError", {
  id: Schema.String,
  message: Schema.String,
}) {}

export class SchemaValidationError extends Schema.TaggedErrorClass<SchemaValidationError>()("EvolutionSchemaValidationError", {
  message: Schema.String,
  detail: Schema.String,
}) {}

const EVOLUTION_SYSTEM_IDS = ["evolution", "ef-ai", "system"]

export interface DecisionView {
  readonly id: string
  readonly key: string
  readonly title: string
  readonly decision: string
  readonly consequences: string
  readonly tags: readonly string[]
  readonly proposerId: string
  readonly acceptedAt: number
}

export interface DecisionRecord {
  id: string
  title: string
  status: "proposed" | "accepted" | "deprecated" | "superseded"
  context: string
  decision: string
  consequences: string
  tags: string[]
  sessionID?: string
  createdAt: number
  updatedAt: number
  supersededBy?: string
}

function nextID(): string {
  const ts = Date.now().toString(36).toUpperCase()
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `ADR-${ts}-${rand}`
}

export interface StorageStats {
  readonly proposalCount: number
  readonly proposalBytes: number
  readonly reconcilCount: number
  readonly reconcilBytes: number
}

export interface Interface {
  readonly save: (adr: Omit<DecisionRecord, "id" | "createdAt" | "updatedAt">) => Effect.Effect<DecisionRecord, EvolutionNotEnabledError | EvolutionStorageError>
  readonly saveReconciliationLog: (log: ReconciliationLog) => Effect.Effect<void, EvolutionNotEnabledError | EvolutionStorageError>
  readonly get: (id: string) => Effect.Effect<DecisionRecord | undefined, EvolutionStorageError>
  readonly list: (status?: string) => Effect.Effect<DecisionRecord[], EvolutionStorageError>
  readonly search: (query: string) => Effect.Effect<DecisionRecord[], EvolutionStorageError>
  readonly summarize: () => Effect.Effect<{ count: number; byStatus: Record<string, number> }, EvolutionStorageError>
  readonly supersede: (id: string, newADR: Omit<DecisionRecord, "id" | "createdAt" | "updatedAt">) => Effect.Effect<DecisionRecord, AdrNotFoundError | EvolutionNotEnabledError | EvolutionStorageError>
  readonly propose: (input: {
    key: string
    title: string
    context: string
    proposedDecision: string
    consequences: string
    tags?: readonly string[]
    origin: ProposalOrigin
  }) => Effect.Effect<DecisionProposal, EvolutionNotEnabledError | EvolutionStorageError>
  readonly submit: (input: {
    key: string
    title: string
    context: string
    proposedDecision: string
    consequences: string
    tags?: readonly string[]
    origin: ProposalOrigin
  }) => Effect.Effect<DecisionProposal, EvolutionNotEnabledError | EvolutionStorageError | SchemaValidationError>
  readonly decisionRecord: () => Effect.Effect<DecisionView[], EvolutionNotEnabledError | EvolutionStorageError>
  readonly listProposals: (status?: string) => Effect.Effect<DecisionProposal[], EvolutionNotEnabledError | EvolutionStorageError>
  readonly getReconciliationLogs: () => Effect.Effect<ReconciliationLog[], EvolutionNotEnabledError | EvolutionStorageError>
  readonly gc: () => Effect.Effect<number, EvolutionNotEnabledError | EvolutionStorageError>
  readonly getStorageStats: () => Effect.Effect<StorageStats, EvolutionNotEnabledError | EvolutionStorageError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/EvolutionDecisions") {}

function adrDir(worktree: string): string {
  return path.join(worktree, ".opencode", "evolution", "adr")
}

function proposalsDir(worktree: string): string {
  return path.join(worktree, ".opencode", "evolution", "proposals")
}

function reconcilDir(worktree: string): string {
  return path.join(worktree, ".opencode", "evolution", "reconciliation")
}

function mdPath(dir: string, id: string): string {
  return path.join(dir, `${id}.md`)
}

function jsonPath(dir: string, id: string): string {
  return path.join(dir, `${id}.json`)
}

function toMarkdown(adr: DecisionRecord): string {
  const lines = [
    `# ${adr.id}: ${adr.title}`,
    "",
    `**Status:** ${adr.status}`,
    `**Created:** ${new Date(adr.createdAt).toISOString()}`,
  ]
  if (adr.updatedAt !== adr.createdAt) {
    lines.push(`**Updated:** ${new Date(adr.updatedAt).toISOString()}`)
  }
  if (adr.sessionID) lines.push(`**Session:** ${adr.sessionID}`)
  if (adr.supersededBy) lines.push(`**Superseded By:** ${adr.supersededBy}`)
  if (adr.tags.length > 0) lines.push(`**Tags:** ${adr.tags.join(", ")}`)
  lines.push("", "## Context", "", adr.context, "", "## Decision", "", adr.decision, "", "## Consequences", "", adr.consequences, "")
  return lines.join("\n")
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const fs = yield* FSUtil.Service
    const mutex = KeyedMutex.makeUnsafe<string>()

    const state = yield* InstanceState.make(
      Effect.fn("EvolutionDecisions.state")(function* (ctx) {
        const cfg = yield* config.get()
        if (!cfg.evolution?.enabled) return undefined as { adrDir: string; proposalsDir: string; reconcilDir: string } | undefined
        return { adrDir: adrDir(ctx.worktree), proposalsDir: proposalsDir(ctx.worktree), reconcilDir: reconcilDir(ctx.worktree) }
      }),
    )

    const getDir = Effect.fn("EvolutionDecisions.getDir")(function* () {
      const dir = yield* InstanceState.get(state)
      if (!dir) return undefined
      return dir.adrDir
    })

    const requireDir = (): Effect.Effect<string, EvolutionNotEnabledError> =>
      Effect.gen(function* () {
        const dir = yield* getDir()
        if (!dir) return yield* Effect.fail(new EvolutionNotEnabledError({ message: "Evolution not enabled" }))
        return dir
      })

    const requireProposalsDir = (): Effect.Effect<string, EvolutionNotEnabledError> =>
      Effect.gen(function* () {
        const dir = yield* InstanceState.get(state)
        if (!dir) return yield* Effect.fail(new EvolutionNotEnabledError({ message: "Evolution not enabled" }))
        return dir.proposalsDir
      })

    const requireReconcilDir = (): Effect.Effect<string, EvolutionNotEnabledError> =>
      Effect.gen(function* () {
        const dir = yield* InstanceState.get(state)
        if (!dir) return yield* Effect.fail(new EvolutionNotEnabledError({ message: "Evolution not enabled" }))
        return dir.reconcilDir
      })

    const ensureDir = Effect.fn("EvolutionDecisions.ensureDir")(function* () {
      const dir = yield* requireDir()
      yield* fs.ensureDir(dir)
      return dir
    })

    const loadFromJSON = Effect.fn("EvolutionDecisions.loadFromJSON")(function* (dir: string, id: string) {
      const jp = jsonPath(dir, id)
      const raw = yield* fs.readFileStringSafe(jp).pipe(
        Effect.catch((e) => Effect.fail(toEvolutionStorageError(e, "read", jp))),
      )
      if (!raw) return undefined as DecisionRecord | undefined
      try {
        return JSON.parse(raw) as DecisionRecord
      } catch {
        return undefined as DecisionRecord | undefined
      }
    })

    const listAll = Effect.fn("EvolutionDecisions.listAll")(function* () {
      const dir = yield* requireDir().pipe(Effect.option)
      if (Option.isNone(dir)) return [] as DecisionRecord[]
      const entries = yield* fs.readDirectoryEntries(dir.value).pipe(Effect.catch(() => Effect.succeed([])))
      const jsonFiles = entries.filter((e) => e.name.endsWith(".json")).map((e) => e.name.slice(0, -5))
      const records: DecisionRecord[] = []
      for (const id of jsonFiles) {
        const rec = yield* loadFromJSON(dir.value, id)
        if (rec) records.push(rec)
      }
      return records.sort((a, b) => b.createdAt - a.createdAt)
    })

    const save = Effect.fn("EvolutionDecisions.save")(function* (input: Omit<DecisionRecord, "id" | "createdAt" | "updatedAt">) {
      const dir = yield* requireDir()
      const now = Date.now()
      const adr: DecisionRecord = {
        ...input,
        id: nextID(),
        createdAt: now,
        updatedAt: now,
      }
      yield* fs.writeWithDirs(jsonPath(dir, adr.id), JSON.stringify(adr, null, 2)).pipe(
        Effect.catch((e) => Effect.fail(toEvolutionStorageError(e, "write", jsonPath(dir, adr.id)))),
      )
      yield* fs.writeWithDirs(mdPath(dir, adr.id), toMarkdown(adr)).pipe(
        Effect.catch((e) => Effect.fail(toEvolutionStorageError(e, "write", mdPath(dir, adr.id)))),
      )
      return adr
    })

    const get = Effect.fn("EvolutionDecisions.get")(function* (id: string) {
      const dir = yield* getDir()
      if (!dir) return undefined
      return yield* loadFromJSON(dir, id)
    })

    const list = Effect.fn("EvolutionDecisions.list")(function* (status?: string) {
      const all = yield* listAll()
      if (status) return all.filter((a) => a.status === status)
      return all
    })

    const search = Effect.fn("EvolutionDecisions.search")(function* (query: string) {
      const all = yield* listAll()
      const lower = query.toLowerCase()
      return all.filter(
        (a) =>
          a.title.toLowerCase().includes(lower) ||
          a.context.toLowerCase().includes(lower) ||
          a.decision.toLowerCase().includes(lower) ||
          a.tags.some((t) => t.toLowerCase().includes(lower)),
      )
    })

    const summarize = Effect.fn("EvolutionDecisions.summarize")(function* () {
      const all = yield* listAll()
      const byStatus: Record<string, number> = {}
      for (const a of all) {
        byStatus[a.status] = (byStatus[a.status] ?? 0) + 1
      }
      return { count: all.length, byStatus }
    })

    const supersede = Effect.fn("EvolutionDecisions.supersede")(function* (
      id: string,
      input: Omit<DecisionRecord, "id" | "createdAt" | "updatedAt">,
    ) {
      const dir = yield* requireDir()
      return yield* mutex.withLock("decisions")(
        Effect.gen(function* () {
          const existing = yield* get(id)
          if (!existing) return yield* Effect.fail(new AdrNotFoundError({ id, message: `ADR not found: ${id}` }))

          const now = Date.now()
          const updatedExisting: DecisionRecord = {
            ...existing,
            status: "superseded",
            updatedAt: now,
            supersededBy: undefined,
          }
          const newAdr: DecisionRecord = {
            ...input,
            id: nextID(),
            createdAt: now,
            updatedAt: now,
          }
          updatedExisting.supersededBy = newAdr.id

          const writes = [
            { path: jsonPath(dir, updatedExisting.id), content: JSON.stringify(updatedExisting, null, 2) },
            { path: mdPath(dir, updatedExisting.id), content: toMarkdown(updatedExisting) },
            { path: jsonPath(dir, newAdr.id), content: JSON.stringify(newAdr, null, 2) },
            { path: mdPath(dir, newAdr.id), content: toMarkdown(newAdr) },
          ] as const

          for (const w of writes) {
            yield* fs.writeWithDirs(w.path, w.content).pipe(
              Effect.catch((e) => Effect.fail(toEvolutionStorageError(e, "write", w.path))),
            )
          }

          return newAdr
        }),
      )
    })

    const propose = Effect.fn("EvolutionDecisions.propose")(function* (
      input: {
        key: string
        title: string
        context: string
        proposedDecision: string
        consequences: string
        tags?: readonly string[]
        origin: ProposalOrigin
      },
    ) {
      const pdir = yield* requireProposalsDir()
      const now = Date.now()
      const proposal: DecisionProposal = {
        id: nextID(),
        key: input.key,
        title: input.title,
        context: input.context,
        proposedDecision: input.proposedDecision,
        consequences: input.consequences,
        tags: input.tags ?? [],
        origin: input.origin,
        createdAt: now,
        status: "SUBMITTED",
      }
      yield* ProposalStore.submit(["proposal"], fs, pdir, proposal)
      return proposal
    })

    const submit = Effect.fn("EvolutionDecisions.submit")(function* (
      input: {
        key: string
        title: string
        context: string
        proposedDecision: string
        consequences: string
        tags?: readonly string[]
        origin: ProposalOrigin
      },
    ) {
      const pdir = yield* requireProposalsDir()
      const schemaResult = validateSchema(input)
      if (!schemaResult.valid) {
        return yield* Effect.fail(new SchemaValidationError({
          message: schemaResult.detail,
          detail: schemaResult.detail,
        }))
      }

      const now = Date.now()
      const proposal: DecisionProposal = {
        id: nextID(),
        key: input.key,
        title: input.title,
        context: input.context,
        proposedDecision: input.proposedDecision,
        consequences: input.consequences,
        tags: input.tags ?? [],
        origin: input.origin,
        createdAt: now,
        status: "SUBMITTED",
      }
      yield* ProposalStore.submit(["proposal"], fs, pdir, proposal)
      yield* ProposalStore.updateStatus(["proposal"], fs, pdir, proposal.id, "VALIDATING")

      const cfg = yield* config.get()
      const evCfg = cfg.evolution ?? {}
      const timeoutMs = evCfg.validation?.timeoutMs ?? 5000

      const readOnlyCheck = Effect.gen(function* () {
        const exists = yield* ProposalStore.existsByKey(fs, pdir, proposal.key)
        if (exists) return "DUPLICATE_KEY" as const
        if (EVOLUTION_SYSTEM_IDS.includes(proposal.origin.proposerId)) return "AUTHORITY_VIOLATION" as const
        return "ACCEPTED" as const
      })

      const decision = yield* readOnlyCheck.pipe(
        Effect.timeoutOrElse({
          duration: Duration.millis(timeoutMs),
          orElse: () => Effect.succeed("VALIDATION_TIMEOUT" as const),
        }),
        Effect.option,
        Effect.map((opt) => Option.getOrElse(opt, () => "VALIDATION_ERROR" as const)),
      )

      if (decision === "DUPLICATE_KEY") {
        yield* ProposalStore.updateStatus(["proposal"], fs, pdir, proposal.id, "REJECTED", "DUPLICATE_KEY")
        const rejected = yield* ProposalStore.getById(fs, pdir, proposal.id)
        return Option.getOrThrow(rejected)
      }
      if (decision === "AUTHORITY_VIOLATION") {
        yield* ProposalStore.updateStatus(["proposal"], fs, pdir, proposal.id, "REJECTED", "AUTHORITY_VIOLATION")
        const rejected = yield* ProposalStore.getById(fs, pdir, proposal.id)
        return Option.getOrThrow(rejected)
      }
      if (decision === "VALIDATION_TIMEOUT") {
        yield* ProposalStore.updateStatus(["proposal"], fs, pdir, proposal.id, "REJECTED", "VALIDATION_TIMEOUT")
        const rejected = yield* ProposalStore.getById(fs, pdir, proposal.id)
        return Option.getOrThrow(rejected)
      }
      if (decision === "VALIDATION_ERROR") {
        yield* ProposalStore.updateStatus(["proposal"], fs, pdir, proposal.id, "REJECTED", "VALIDATION_ERROR").pipe(
          Effect.catch(() => Effect.void),
        )
        const rejected = yield* ProposalStore.getById(fs, pdir, proposal.id).pipe(
          Effect.catch(() => Effect.succeed(Option.none<DecisionProposal>())),
        )
        return Option.getOrElse(rejected, () => ({
          ...proposal,
          id: proposal.id,
          status: "REJECTED" as const,
          rejectionReason: "VALIDATION_ERROR" as const,
          rejectedAt: Date.now(),
          validatedAt: Date.now(),
        }))
      }
      yield* ProposalStore.updateStatus(["proposal"], fs, pdir, proposal.id, "ACCEPTED")
      const accepted = yield* ProposalStore.getById(fs, pdir, proposal.id)
      return Option.getOrThrow(accepted)
    })

    const decisionRecord = Effect.fn("EvolutionDecisions.decisionRecord")(function* () {
      const pdir = yield* requireProposalsDir()
      const accepted = yield* ProposalStore.listByStatus(fs, pdir, "ACCEPTED")
      return accepted.map((p) => ({
        id: p.id,
        key: p.key,
        title: p.title,
        decision: p.proposedDecision,
        consequences: p.consequences,
        tags: p.tags,
        proposerId: p.origin.proposerId,
        acceptedAt: p.acceptedAt!,
      })) as DecisionView[]
    })

    const gc = Effect.fn("EvolutionDecisions.gc")(function* () {
      const cfg = yield* config.get()
      const retentionDays = cfg.evolution?.retention?.proposalDays ?? 90
      if (retentionDays <= 0) return 0
      const pdir = yield* requireProposalsDir()
      return yield* ProposalStore.gc(fs, pdir, retentionDays)
    })

    const listProposals = Effect.fn("EvolutionDecisions.listProposals")(function* (status?: string) {
      const pdir = yield* requireProposalsDir()
      const entries = yield* fs.readDirectoryEntries(pdir).pipe(
        Effect.catch(() => Effect.succeed([])),
      )
      const jsonFiles = entries.filter((e) => e.name.endsWith(".json"))
      const proposals: DecisionProposal[] = []
      for (const entry of jsonFiles) {
        const decoded = yield* ProposalStore.getById(fs, pdir, entry.name.replace(".json", ""))
        if (Option.isSome(decoded)) proposals.push(decoded.value)
      }
      const sorted = proposals.sort((a, b) => b.createdAt - a.createdAt)
      if (status) return sorted.filter((p) => p.status === status)
      return sorted
    })

    const getReconciliationLogs = Effect.fn("EvolutionDecisions.getReconciliationLogs")(function* () {
      const dir = yield* requireReconcilDir()
      const entries = yield* fs.readDirectoryEntries(dir).pipe(
        Effect.catch(() => Effect.succeed([])),
      )
      const jsonFiles = entries.filter((e) => e.name.endsWith(".json"))
      const logs: ReconciliationLog[] = []
      for (const entry of jsonFiles) {
        const raw = yield* fs.readFileStringSafe(path.join(dir, entry.name)).pipe(
          Effect.catch(() => Effect.succeed(undefined)),
        )
        if (raw) {
          try {
            const parsed = JSON.parse(raw) as ReconciliationLog
            logs.push(parsed)
          } catch (err) { console.error("[ef-ai] Error parsing reconciliation log:", err) }
        }
      }
      return logs.sort((a, b) => b.createdAt - a.createdAt)
    })

    const saveReconciliationLog = Effect.fn("EvolutionDecisions.saveReconciliationLog")(function* (log: ReconciliationLog) {
      const dir = yield* requireReconcilDir()
      yield* fs.ensureDir(dir)
      const id = `recon-${Date.now().toString(36)}`
      yield* fs.writeWithDirs(path.join(dir, `${id}.json`), JSON.stringify(log, null, 2)).pipe(
        Effect.catch((e) => Effect.fail(toEvolutionStorageError(e, "write", path.join(dir, `${id}.json`)))),
      )
      yield* gc().pipe(Effect.ignore)
      // F-05: TTL cleanup for reconciliation logs — default 90 days
      const cfg = yield* config.get()
      const retentionDays = cfg.evolution?.retention?.proposalDays ?? 90
      if (retentionDays > 0) {
        const entries = yield* fs.readDirectoryEntries(dir).pipe(
          Effect.catch(() => Effect.succeed([] as FSUtil.DirEntry[])),
        )
        const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
        for (const entry of entries.filter((e) => e.name.endsWith(".json"))) {
          const raw = yield* fs.readFileStringSafe(path.join(dir, entry.name)).pipe(
            Effect.catch(() => Effect.succeed(undefined)),
          )
          if (!raw) continue
          try {
            const parsed = JSON.parse(raw) as { createdAt: number }
            if (parsed.createdAt < cutoff) {
              yield* fs.remove(path.join(dir, entry.name)).pipe(Effect.catch(() => Effect.void))
            }
          } catch (err) { console.error("[ef-ai] Error parsing reconciliation log during GC:", err) }
        }
      }
    })

    const getStorageStats = Effect.fn("EvolutionDecisions.getStorageStats")(function* () {
      const pdir = yield* requireProposalsDir()
      const rdir = yield* requireReconcilDir()
      const propEntries = yield* fs.readDirectoryEntries(pdir).pipe(Effect.catch(() => Effect.succeed([] as FSUtil.DirEntry[])))
      const reconcilEntries = yield* fs.readDirectoryEntries(rdir).pipe(Effect.catch(() => Effect.succeed([] as FSUtil.DirEntry[])))
      const propJson = propEntries.filter((e) => e.name.endsWith(".json"))
      const reconcilJson = reconcilEntries.filter((e) => e.name.endsWith(".json"))
      let proposalBytes = 0
      for (const e of propJson) {
        const info = yield* fs.stat(path.join(pdir, e.name)).pipe(Effect.catch(() => Effect.void))
        if (info) proposalBytes += info.size
      }
      let reconcilBytes = 0
      for (const e of reconcilJson) {
        const info = yield* fs.stat(path.join(rdir, e.name)).pipe(Effect.catch(() => Effect.void))
        if (info) reconcilBytes += info.size
      }
      return { proposalCount: propJson.length, proposalBytes, reconcilCount: reconcilJson.length, reconcilBytes }
    })

    return Service.of({ save, get, list, search, summarize, supersede, propose, submit, decisionRecord, saveReconciliationLog, gc, listProposals, getReconciliationLogs, getStorageStats })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Config.defaultLayer),
  Layer.provide(FSUtil.defaultLayer),
)

export const node = LayerNode.make(layer, [Config.node, FSUtil.node])

export * as EvolutionDecisions from "./decisions"
