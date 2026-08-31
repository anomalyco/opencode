export * as HarnessVersion from "./version"

import { Context, Effect, Layer, Schema } from "effect"
import { Database } from "../database/database"
import { makeLocationNode } from "../effect/app-node"
import { FlexibleNumber, harness_version } from "./schema"
import { eq, and, desc } from "drizzle-orm"

export const CandidateProposalInput = Schema.Struct({
  domainCategory: Schema.String,
  systemPrompt: Schema.String,
  extractedRules: Schema.Array(Schema.String),
  temperature: Schema.optional(FlexibleNumber),
  maxOutputTokens: Schema.optional(FlexibleNumber),
  modelOptions: Schema.optional(Schema.String),
  toolOverrides: Schema.optional(Schema.String),
  parentVersionID: Schema.optional(Schema.String),
}).annotate({ identifier: "HarnessVersion.CandidateProposalInput" })

export type CandidateProposalInput = typeof CandidateProposalInput.Type

export const VersionInfo = Schema.Struct({
  versionID: Schema.String,
  domainCategory: Schema.String,
  versionNumber: FlexibleNumber,
  systemPrompt: Schema.String,
  extractedRules: Schema.optional(Schema.Unknown),
  temperature: Schema.optional(FlexibleNumber),
  maxOutputTokens: Schema.optional(FlexibleNumber),
  modelOptions: Schema.optional(Schema.String),
  toolOverrides: Schema.optional(Schema.String),
  status: Schema.String,
  isActive: Schema.Boolean,
  evalScore: Schema.optional(FlexibleNumber),
}).annotate({ identifier: "HarnessVersion.VersionInfo" })

export type VersionInfo = typeof VersionInfo.Type

export interface Interface {
  readonly proposeCandidate: (
    input: CandidateProposalInput,
  ) => Effect.Effect<string>
  readonly promoteCandidate: (
    versionID: string,
  ) => Effect.Effect<void>
  readonly rollback: (
    targetVersionID: string,
  ) => Effect.Effect<void>
  readonly getActiveVersion: (
    domainCategory: string,
  ) => Effect.Effect<VersionInfo | null>
}

export class Service extends Context.Service<Service, Interface>()(
  "@opencode/v2/HarnessVersion",
) {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service

    // 1. Propose a new candidate version and persist it in SQLite.
    const proposeCandidate = Effect.fn(
      "HarnessVersion.proposeCandidate",
    )(function* (input: CandidateProposalInput) {
      // Validate the values that are required by harness_version.
      if (!input.domainCategory.trim()) {
        return yield* Effect.die(
          "HarnessVersion.proposeCandidate: domainCategory is empty",
        )
      }

      if (!input.systemPrompt.trim()) {
        return yield* Effect.die(
          "HarnessVersion.proposeCandidate: systemPrompt is empty",
        )
      }

      const versionID = `ver_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 7)}`

      // Fetch highest current version number for this domain.
      const lastVer = yield* db
        .select()
        .from(harness_version)
        .where(
          eq(
            harness_version.domain_category,
            input.domainCategory,
          ),
        )
        .orderBy(desc(harness_version.version_number))
        .get()
        .pipe(Effect.orElseSucceed(() => undefined))

      const nextVersionNumber =
        (lastVer?.version_number ?? 0) + 1

      // Insert the complete evolved prompt/version data.
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

      // Immediately verify that the row exists in the same database
      // connection used by the Harness.
      const savedVersion = yield* db
        .select({
          versionID: harness_version.version_id,
          domainCategory: harness_version.domain_category,
          versionNumber: harness_version.version_number,
          systemPrompt: harness_version.system_prompt,
          status: harness_version.status,
          isActive: harness_version.is_active,
        })
        .from(harness_version)
        .where(
          eq(
            harness_version.version_id,
            versionID,
          ),
        )
        .get()
        .pipe(Effect.orDie)

      if (!savedVersion) {
        return yield* Effect.die(
          `HarnessVersion.proposeCandidate: row was inserted but could not be read back: ${versionID}`,
        )
      }

      // Make sure the important persisted values are the values
      // that were actually supplied by the evolved strategy.
      if (
        savedVersion.domainCategory !==
          input.domainCategory ||
        savedVersion.versionNumber !== nextVersionNumber ||
        savedVersion.systemPrompt !== input.systemPrompt ||
        savedVersion.status !== "candidate" ||
        savedVersion.isActive !== false
      ) {
        return yield* Effect.die(
          `HarnessVersion.proposeCandidate: persisted row verification failed for ${versionID}`,
        )
      }

      return versionID
    })

    // 2. Atomic DB Transaction: Promote candidate to active
    //    and deactivate old versions.
    const promoteCandidate = Effect.fn(
      "HarnessVersion.promoteCandidate",
    )(function* (versionID: string) {
      const candidate = yield* db
        .select()
        .from(harness_version)
        .where(
          eq(
            harness_version.version_id,
            versionID,
          ),
        )
        .get()
        .pipe(Effect.orDie)

      if (!candidate) {
        return yield* Effect.die(
          `Version not found: ${versionID}`,
        )
      }

      yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            // Deactivate existing active versions for this domain.
            yield* tx
              .update(harness_version)
              .set({
                is_active: false,
                status: "archived",
              })
              .where(
                and(
                  eq(
                    harness_version.domain_category,
                    candidate.domain_category,
                  ),
                  eq(
                    harness_version.is_active,
                    true,
                  ),
                ),
              )
              .run()

            // Atomically activate target version.
            yield* tx
              .update(harness_version)
              .set({
                is_active: true,
                status: "active",
              })
              .where(
                eq(
                  harness_version.version_id,
                  versionID,
                ),
              )
              .run()
          }),
        )
        .pipe(Effect.orDie)

      return yield* Effect.void
    })

    // 3. Rollback to a previous version.
    const rollback = Effect.fn(
      "HarnessVersion.rollback",
    )(function* (targetVersionID: string) {
      const target = yield* db
        .select()
        .from(harness_version)
        .where(
          eq(
            harness_version.version_id,
            targetVersionID,
          ),
        )
        .get()
        .pipe(Effect.orDie)

      if (!target) {
        return yield* Effect.die(
          `Version not found: ${targetVersionID}`,
        )
      }

      if (
        target.status !== "active" &&
        target.status !== "archived"
      ) {
        return yield* Effect.die(
          `Cannot rollback version with status: ${target.status}`,
        )
      }

      yield* promoteCandidate(targetVersionID)

      return yield* Effect.void
    })

    // 4. Retrieve Active Version for a domain category
    //    with fallback to general.
    const getActiveVersion = Effect.fn(
      "HarnessVersion.getActiveVersion",
    )(function* (domainCategory: string) {
      let activeRow = yield* db
        .select()
        .from(harness_version)
        .where(
          and(
            eq(
              harness_version.domain_category,
              domainCategory,
            ),
            eq(
              harness_version.is_active,
              true,
            ),
          ),
        )
        .get()
        .pipe(Effect.orElseSucceed(() => undefined))

      if (
        !activeRow &&
        domainCategory !== "general"
      ) {
        const variant = domainCategory.endsWith("s")
          ? domainCategory.slice(0, -1)
          : `${domainCategory}s`

        activeRow = yield* db
          .select()
          .from(harness_version)
          .where(
            and(
              eq(
                harness_version.domain_category,
                variant,
              ),
              eq(
                harness_version.is_active,
                true,
              ),
            ),
          )
          .get()
          .pipe(Effect.orElseSucceed(() => undefined))
      }

      if (
        !activeRow &&
        domainCategory !== "general"
      ) {
        activeRow = yield* db
          .select()
          .from(harness_version)
          .where(
            and(
              eq(
                harness_version.domain_category,
                "general",
              ),
              eq(
                harness_version.is_active,
                true,
              ),
            ),
          )
          .get()
          .pipe(Effect.orElseSucceed(() => undefined))
      }

      if (!activeRow) {
        return null
      }

      return {
        versionID: activeRow.version_id,
        domainCategory: activeRow.domain_category,
        versionNumber: activeRow.version_number,
        systemPrompt: activeRow.system_prompt,
        extractedRules: activeRow.extracted_rules,
        temperature:
          activeRow.temperature ?? undefined,
        maxOutputTokens:
          activeRow.max_output_tokens ?? undefined,
        modelOptions:
          activeRow.model_options ?? undefined,
        toolOverrides:
          activeRow.tool_overrides ?? undefined,
        status: activeRow.status,
        isActive:
          activeRow.is_active ?? false,
        evalScore:
          activeRow.eval_score ?? undefined,
      }
    })

    return Service.of({
      proposeCandidate,
      promoteCandidate,
      rollback,
      getActiveVersion,
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Database.node],
})