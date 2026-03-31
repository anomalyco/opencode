import { eq } from "drizzle-orm"
import { Effect, Layer, Option, Schema, ServiceMap } from "effect"

import { Database } from "@/storage/db"
import { MemoryPreferenceTable, MemoryRuleTable, MemoryAPIKeyTable } from "./memory.sql"
import { MemoryID, RuleID, APIKeyID, Preference, Rule, APIKey, MemoryRepoError, type PreferenceType } from "./schema"

export type PreferenceRow = (typeof MemoryPreferenceTable)["$inferSelect"]
export type RuleRow = (typeof MemoryRuleTable)["$inferSelect"]
export type APIKeyRow = (typeof MemoryAPIKeyTable)["$inferSelect"]

type DbClient = Parameters<typeof Database.use>[0] extends (db: infer T) => unknown ? T : never
type DbTransactionCallback<A> = Parameters<typeof Database.transaction<A>>[0]

export namespace MemoryRepo {
  export interface Service {
    readonly getPreference: (key: string) => Effect.Effect<Option.Option<Preference>, MemoryRepoError>
    readonly getPreferences: () => Effect.Effect<Preference[], MemoryRepoError>
    readonly setPreference: (input: {
      id: MemoryID
      key: string
      value: unknown
      type: PreferenceType
      description?: string
    }) => Effect.Effect<void, MemoryRepoError>
    readonly removePreference: (key: string) => Effect.Effect<void, MemoryRepoError>

    readonly getRulesForProject: (projectID: string) => Effect.Effect<Rule[], MemoryRepoError>
    readonly setRule: (input: {
      id: RuleID
      projectID: string
      pattern: string
      rule: string
      priority?: number
      enabled?: boolean
    }) => Effect.Effect<void, MemoryRepoError>
    readonly removeRule: (id: RuleID) => Effect.Effect<void, MemoryRepoError>

    readonly getAPIKeys: () => Effect.Effect<APIKey[], MemoryRepoError>
    readonly getAPIKey: (id: APIKeyID) => Effect.Effect<Option.Option<APIKeyRow>, MemoryRepoError>
    readonly setAPIKey: (input: {
      id: APIKeyID
      provider: string
      keyName: string
      encryptedValue: string
      description?: string
    }) => Effect.Effect<void, MemoryRepoError>
    readonly removeAPIKey: (id: APIKeyID) => Effect.Effect<void, MemoryRepoError>
  }
}

export class MemoryRepo extends ServiceMap.Service<MemoryRepo, MemoryRepo.Service>()("@opencode/MemoryRepo") {
  static readonly layer: Layer.Layer<MemoryRepo> = Layer.effect(
    MemoryRepo,
    Effect.gen(function* () {
      const decodePreference = Schema.decodeUnknownSync(Preference)
      const decodeRule = Schema.decodeUnknownSync(Rule)
      const decodeAPIKey = Schema.decodeUnknownSync(APIKey)

      const query = <A>(f: DbTransactionCallback<A>) =>
        Effect.try({
          try: () => Database.use(f),
          catch: (cause) => new MemoryRepoError({ message: "Database operation failed", cause }),
        })

      const getPreference = Effect.fn("MemoryRepo.getPreference")((key: string) =>
        query((db) => db.select().from(MemoryPreferenceTable).where(eq(MemoryPreferenceTable.key, key)).get()).pipe(
          Effect.map((row) => (row ? Option.some(decodePreference(row)) : Option.none<Preference>())),
          Effect.orElseSucceed(() => Option.none<Preference>()),
        ),
      )

      const getPreferences = Effect.fn("MemoryRepo.getPreferences")(() =>
        query((db) => db.select().from(MemoryPreferenceTable).all()).pipe(
          Effect.map((rows) => rows.map((row) => decodePreference(row))),
        ),
      )

      const setPreference = Effect.fn("MemoryRepo.setPreference")(
        (input: { id: MemoryID; key: string; value: unknown; type: PreferenceType; description?: string }) =>
          query((db) => {
            const now = Date.now()
            db.insert(MemoryPreferenceTable)
              .values({
                id: input.id as string,
                key: input.key,
                value: input.value,
                type: input.type,
                description: input.description ?? null,
                time_created: now,
                time_updated: now,
              })
              .onConflictDoUpdate({
                target: MemoryPreferenceTable.key,
                set: {
                  value: input.value,
                  type: input.type,
                  description: input.description ?? null,
                  time_updated: now,
                },
              })
              .run()
          }).pipe(Effect.asVoid),
      )

      const removePreference = Effect.fn("MemoryRepo.removePreference")((key: string) =>
        query((db) => db.delete(MemoryPreferenceTable).where(eq(MemoryPreferenceTable.key, key)).run()).pipe(
          Effect.asVoid,
        ),
      )

      const getRulesForProject = Effect.fn("MemoryRepo.getRulesForProject")((projectID: string) =>
        query((db) =>
          db
            .select()
            .from(MemoryRuleTable)
            .where(eq(MemoryRuleTable.project_id, projectID as string))
            .orderBy(MemoryRuleTable.priority)
            .all(),
        ).pipe(Effect.map((rows) => rows.map((row) => decodeRule(row)))),
      )

      const setRule = Effect.fn("MemoryRepo.setRule")(
        (input: {
          id: RuleID
          projectID: string
          pattern: string
          rule: string
          priority?: number
          enabled?: boolean
        }) =>
          query((db) => {
            const now = Date.now()
            db.insert(MemoryRuleTable)
              .values({
                id: input.id as string,
                project_id: input.projectID as string,
                pattern: input.pattern,
                rule: input.rule,
                priority: input.priority ?? 0,
                enabled: input.enabled ?? true,
                time_created: now,
                time_updated: now,
              })
              .onConflictDoUpdate({
                target: MemoryRuleTable.id,
                set: {
                  pattern: input.pattern,
                  rule: input.rule,
                  priority: input.priority ?? 0,
                  enabled: input.enabled ?? true,
                  time_updated: now,
                },
              })
              .run()
          }).pipe(Effect.asVoid),
      )

      const removeRule = Effect.fn("MemoryRepo.removeRule")((id: RuleID) =>
        query((db) =>
          db
            .delete(MemoryRuleTable)
            .where(eq(MemoryRuleTable.id, id as string))
            .run(),
        ).pipe(Effect.asVoid),
      )

      const getAPIKeys = Effect.fn("MemoryRepo.getAPIKeys")(() =>
        query((db) => db.select().from(MemoryAPIKeyTable).all()).pipe(
          Effect.map((rows) => rows.map((row) => decodeAPIKey(row))),
        ),
      )

      const getAPIKey = Effect.fn("MemoryRepo.getAPIKey")((id: APIKeyID) =>
        query((db) =>
          db
            .select()
            .from(MemoryAPIKeyTable)
            .where(eq(MemoryAPIKeyTable.id, id as string))
            .get(),
        ).pipe(Effect.map((row) => (row ? Option.some(row) : Option.none()))),
      )

      const setAPIKey = Effect.fn("MemoryRepo.setAPIKey")(
        (input: { id: APIKeyID; provider: string; keyName: string; encryptedValue: string; description?: string }) =>
          query((db) => {
            const now = Date.now()
            db.insert(MemoryAPIKeyTable)
              .values({
                id: input.id as string,
                provider: input.provider,
                key_name: input.keyName,
                encrypted_value: input.encryptedValue,
                description: input.description ?? null,
                time_created: now,
                time_updated: now,
              })
              .onConflictDoUpdate({
                target: MemoryAPIKeyTable.id,
                set: {
                  encrypted_value: input.encryptedValue,
                  description: input.description ?? null,
                  time_updated: now,
                },
              })
              .run()
          }).pipe(Effect.asVoid),
      )

      const removeAPIKey = Effect.fn("MemoryRepo.removeAPIKey")((id: APIKeyID) =>
        query((db) =>
          db
            .delete(MemoryAPIKeyTable)
            .where(eq(MemoryAPIKeyTable.id, id as string))
            .run(),
        ).pipe(Effect.asVoid),
      )

      return MemoryRepo.of({
        getPreference,
        getPreferences,
        setPreference,
        removePreference,
        getRulesForProject,
        setRule,
        removeRule,
        getAPIKeys,
        getAPIKey,
        setAPIKey,
        removeAPIKey,
      })
    }),
  )
}
