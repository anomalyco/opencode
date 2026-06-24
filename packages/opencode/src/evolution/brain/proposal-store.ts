import { Effect, Option, Schema } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import type { DecisionProposal, ProposalStatus, RejectionCode } from "@/evolution/decision/proposal"
import { DecisionProposalSchema } from "@/evolution/decision/proposal"
import type { AgentCapability } from "@/evolution/decision/agents/types"
import { EvolutionStorageError, InvariantViolationError, toEvolutionStorageError } from "@/evolution/error"

const PROPOSALS_DIR = ".opencode/evolution/proposals"

function proposalPath(baseDir: string, id: string): string {
  return `${baseDir}/${id}.json`
}

const decodeProposal = Schema.decodeUnknownOption(DecisionProposalSchema)

const VALID_TRANSITIONS: Record<ProposalStatus, ProposalStatus[]> = {
  SUBMITTED: ["VALIDATING"],
  VALIDATING: ["ACCEPTED", "REJECTED"],
  ACCEPTED: [],
  REJECTED: [],
  HELD: [],
}

function encodeWrite(data: DecisionProposal): string {
  return JSON.stringify(Schema.encodeSync(DecisionProposalSchema)(data), null, 2)
}

export function requireProposalCapability(callerCaps: AgentCapability[], operation: string): Effect.Effect<void> {
  if (!callerCaps.includes("proposal" as AgentCapability)) {
    return Effect.die(new InvariantViolationError({
      message: `Write capability invariant violation: caller lacks 'proposal' capability`,
      operation,
    }))
  }
  return Effect.void
}

export const ProposalStore = {
  submit(
    callerCaps: AgentCapability[],
    fs: FSUtil.Interface,
    pdir: string,
    proposal: DecisionProposal,
  ): Effect.Effect<void, EvolutionStorageError> {
    return Effect.gen(function* () {
      yield* requireProposalCapability(callerCaps, "submit")
      const json = yield* Effect.try({
        try: () => encodeWrite(proposal),
        catch: (e) => new EvolutionStorageError({
          message: `Schema encode failed for ${proposalPath(pdir, proposal.id)}: ${e}`,
          operation: "write",
          path: proposalPath(pdir, proposal.id),
        }),
      })
      yield* fs.writeWithDirs(proposalPath(pdir, proposal.id), json).pipe(
        Effect.catch((e) => Effect.fail(toEvolutionStorageError(e, "write", proposalPath(pdir, proposal.id)))),
      )
    })
  },

  updateStatus(
    callerCaps: AgentCapability[],
    fs: FSUtil.Interface,
    pdir: string,
    id: string,
    status: ProposalStatus,
    reason?: RejectionCode,
  ): Effect.Effect<void, EvolutionStorageError> {
    return Effect.gen(function* () {
      yield* requireProposalCapability(callerCaps, "updateStatus")
      const existing = yield* ProposalStore.getById(fs, pdir, id)
      if (Option.isNone(existing)) {
        return yield* Effect.fail(new EvolutionStorageError({
          message: `Proposal not found: ${id}`,
          operation: "read",
          path: proposalPath(pdir, id),
        }))
      }
      const proposal = existing.value
      const allowed = VALID_TRANSITIONS[proposal.status]
      if (!allowed.includes(status)) {
        return yield* Effect.fail(new EvolutionStorageError({
          message: `Invalid transition: ${proposal.status} → ${status}`,
          operation: "write",
          path: proposalPath(pdir, id),
        }))
      }
      const now = Date.now()
      const updated: DecisionProposal = {
        ...proposal,
        status,
        rejectionReason: reason,
        validatedAt: now,
        acceptedAt: status === "ACCEPTED" ? now : proposal.acceptedAt,
        rejectedAt: status === "REJECTED" ? now : proposal.rejectedAt,
      }
      const json = yield* Effect.try({
        try: () => encodeWrite(updated),
        catch: (e) => new EvolutionStorageError({
          message: `Schema encode failed for ${proposalPath(pdir, id)}: ${e}`,
          operation: "write",
          path: proposalPath(pdir, id),
        }),
      })
      yield* fs.writeWithDirs(proposalPath(pdir, id), json).pipe(
        Effect.catch((e) => Effect.fail(toEvolutionStorageError(e, "write", proposalPath(pdir, id)))),
      )
    })
  },

  getById(
    fs: FSUtil.Interface,
    pdir: string,
    id: string,
  ): Effect.Effect<Option.Option<DecisionProposal>, EvolutionStorageError> {
    return Effect.gen(function* () {
      const path = proposalPath(pdir, id)
      const raw = yield* fs.readFileStringSafe(path).pipe(
        Effect.catch((e) => Effect.fail(toEvolutionStorageError(e, "read", path))),
      )
      if (!raw) return Option.none()
      const parsed = JSON.parse(raw)
      const decoded = decodeProposal(parsed)
      if (Option.isNone(decoded)) {
        return yield* Effect.fail(new EvolutionStorageError({
          message: `Schema validation failed for ${path}`,
          operation: "read",
          path,
        }))
      }
      return decoded
    })
  },

  listByStatus(
    fs: FSUtil.Interface,
    pdir: string,
    status: ProposalStatus,
  ): Effect.Effect<DecisionProposal[], EvolutionStorageError> {
    return Effect.gen(function* () {
      const exists = yield* fs.existsSafe(pdir).pipe(
        Effect.catch((e) => Effect.fail(toEvolutionStorageError(e, "exists", pdir))),
      )
      if (!exists) return []
      const entries = yield* fs.readDirectoryEntries(pdir).pipe(
        Effect.catch((e) => Effect.fail(toEvolutionStorageError(e, "read", pdir))),
      )
      const jsonFiles = entries.filter((e) => e.name.endsWith(".json"))
      const proposals: DecisionProposal[] = []
      for (const entry of jsonFiles) {
        const decoded = yield* ProposalStore.getById(fs, pdir, entry.name.replace(".json", ""))
        if (Option.isSome(decoded) && decoded.value.status === status) proposals.push(decoded.value)
      }
      return proposals
    })
  },

  gc(
    fs: FSUtil.Interface,
    pdir: string,
    retentionDays: number,
  ): Effect.Effect<number, EvolutionStorageError> {
    return Effect.gen(function* () {
      if (retentionDays <= 0) return 0
      const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
      const exists = yield* fs.existsSafe(pdir).pipe(
        Effect.catch((e) => Effect.fail(toEvolutionStorageError(e, "exists", pdir))),
      )
      if (!exists) return 0
      const entries = yield* fs.readDirectoryEntries(pdir).pipe(
        Effect.catch((e) => Effect.fail(toEvolutionStorageError(e, "read", pdir))),
      )
      let deleted = 0
      for (const entry of entries) {
        if (!entry.name.endsWith(".json")) continue
        const id = entry.name.replace(".json", "")
        const opt = yield* ProposalStore.getById(fs, pdir, id)
        if (Option.isNone(opt)) continue
        if (opt.value.status !== "REJECTED") continue
        if ((opt.value.rejectedAt ?? 0) < cutoff) {
          yield* fs.remove(proposalPath(pdir, id)).pipe(
            Effect.catch((e) => Effect.fail(toEvolutionStorageError(e, "write", proposalPath(pdir, id)))),
          )
          deleted++
        }
      }
      return deleted
    })
  },

  existsByKey(
    fs: FSUtil.Interface,
    pdir: string,
    key: string,
  ): Effect.Effect<boolean, EvolutionStorageError> {
    return Effect.gen(function* () {
      const accepted = yield* ProposalStore.listByStatus(fs, pdir, "ACCEPTED")
      return accepted.some((p) => p.key === key)
    })
  },
}
