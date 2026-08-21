export * as HarnessVersion from "./version"

import { Context, Effect, Layer, Schema } from "effect"
import { Database } from "../database/database"
import { makeLocationNode } from "../effect/app-node"
import { harness_version } from "./schema"
import { eq, and, desc } from "drizzle-orm"

export const CandidateProposalInput = Schema.Struct({
  domainCategory: Schema.String,
  systemPrompt: Schema.String,
  extractedRules: Schema.Array(Schema.String),
  temperature: Schema.optional(Schema.Number),
  maxOutputTokens: Schema.optional(Schema.Number),
  modelOptions: Schema.optional(Schema.String),
  toolOverrides: Schema.optional(Schema.String),
  parentVersionID: Schema.optional(Schema.String),
}).annotate({ identifier: "HarnessVersion.CandidateProposalInput" })

export type CandidateProposalInput = typeof CandidateProposalInput.Type

export const VersionInfo = Schema.Struct({
  versionID: Schema.String,
  domainCategory: Schema.String,
  versionNumber: Schema.Number,
  systemPrompt: Schema.String,
  extractedRules: Schema.optional(Schema.Unknown),
  temperature: Schema.optional(Schema.Number),
  maxOutputTokens: Schema.optional(Schema.Number),
  modelOptions: Schema.optional(Schema.String),
  toolOverrides: Schema.optional(Schema.String),
  status: Schema.String,
  isActive: Schema.Boolean,
  evalScore: Schema.optional(Schema.Number),
}).annotate({ identifier: "HarnessVersion.VersionInfo" })

export type VersionInfo = typeof VersionInfo.Type

export interface Interface {
  readonly proposeCandidate: (input: CandidateProposalInput) => Effect.Effect<string>
  readonly promoteCandidate: (versionID: string) => Effect.Effect<void>
  readonly rollback: (targetVersionID: string) => Effect.Effect<void>
  readonly getActiveVersion: (domainCategory: string) => Effect.Effect<VersionInfo | null>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/HarnessVersion") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service

    // 1. Propose a new candidate version (stored as candidate in SQLite)
    const proposeCandidate = Effect.fn("HarnessVersion.proposeCandidate")(function* (input: CandidateProposalInput) {
      const versionID = `ver_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`

      // Fetch highest current version number for this domain
      const lastVer = yield* db
        .select()
        .from(harness_version)
        .where(eq(harness_version.domain_category, input.domainCategory))
        .orderBy(desc(harness_version.version_number))
        .get()
        .pipe(Effect.orElseSucceed(() => undefined))

      const nextVersionNumber = (lastVer?.version_number ?? 0) + 1

      yield* db
        .insert(harness_version)
        .values({
          version_id: versionID,
          domain_category: input.domainCategory,
          version_number: nextVersionNumber,
          system_prompt: input.systemPrompt,
          extracted_rules: input.extractedRules,
          temperature: input.temperature,
          max_output_tokens: input.maxOutputTokens,
          model_options: input.modelOptions,
          tool_overrides: input.toolOverrides,
          status: "candidate",
          is_active: false,
          parent_version_id: input.parentVersionID,
        })
        .run()
        .pipe(Effect.orDie)

      return versionID
    })

    // 2. Atomic DB Transaction: Promote candidate to active & deactivate old versions
    const promoteCandidate = Effect.fn("HarnessVersion.promoteCandidate")(function* (versionID: string) {
      const candidate = yield* db
        .select()
        .from(harness_version)
        .where(eq(harness_version.version_id, versionID))
        .get()
        .pipe(Effect.orDie)

      if (!candidate) return yield* Effect.die(`Version not found: ${versionID}`)

      yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            // Deactivate existing active versions for this domain
            yield* tx
              .update(harness_version)
              .set({ is_active: false, status: "archived" })
              .where(
                and(
                  eq(harness_version.domain_category, candidate.domain_category),
                  eq(harness_version.is_active, true),
                ),
              )
              .run()

            // Atomically activate target version
            yield* tx
              .update(harness_version)
              .set({ is_active: true, status: "active" })
              .where(eq(harness_version.version_id, versionID))
              .run()
          }),
        )
        .pipe(Effect.orDie)

      return yield* Effect.void
    })

    // 3. Rollback to a previous version - only allow rolling back to an active or archived version
    const rollback = Effect.fn("HarnessVersion.rollback")(function* (targetVersionID: string) {
      const target = yield* db
        .select()
        .from(harness_version)
        .where(eq(harness_version.version_id, targetVersionID))
        .get()
        .pipe(Effect.orDie)

      if (!target) return yield* Effect.die(`Version not found: ${targetVersionID}`)
      if (target.status !== "active" && target.status !== "archived") {
        return yield* Effect.die(`Cannot rollback version with status: ${target.status}`)
      }

      yield* promoteCandidate(targetVersionID)
      return yield* Effect.void
    })

    // 4. Retrieve Active Version for a domain category
    const getActiveVersion = Effect.fn("HarnessVersion.getActiveVersion")(function* (domainCategory: string) {
      const activeRow = yield* db
        .select()
        .from(harness_version)
        .where(and(eq(harness_version.domain_category, domainCategory), eq(harness_version.is_active, true)))
        .get()
        .pipe(Effect.orElseSucceed(() => undefined))

      if (!activeRow) return null

      return {
        versionID: activeRow.version_id,
        domainCategory: activeRow.domain_category,
        versionNumber: activeRow.version_number,
        systemPrompt: activeRow.system_prompt,
        extractedRules: activeRow.extracted_rules,
        temperature: activeRow.temperature ?? undefined,
        maxOutputTokens: activeRow.max_output_tokens ?? undefined,
        modelOptions: activeRow.model_options ?? undefined,
        toolOverrides: activeRow.tool_overrides ?? undefined,
        status: activeRow.status,
        isActive: activeRow.is_active ?? false,
        evalScore: activeRow.eval_score ?? undefined,
      }
    })

    return Service.of({ proposeCandidate, promoteCandidate, rollback, getActiveVersion })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Database.node] })
