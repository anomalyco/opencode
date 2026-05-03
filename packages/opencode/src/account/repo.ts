import { eq } from "drizzle-orm"
import { Effect, Layer, Option, Schema, ServiceMap } from "effect"

import { Database } from "@/storage/db.pg"
import { AccountStateTable, AccountTable } from "@/storage/schema"
import { AccessToken, Account, AccountID, AccountRepoError, OrgID, RefreshToken } from "./schema"

export type AccountRow = (typeof AccountTable)["$inferSelect"]

type DbClient = Parameters<typeof Database.use>[0] extends (db: infer T) => unknown ? T : never

const ACCOUNT_STATE_ID = 1

export namespace AccountRepo {
  export interface Service {
    readonly active: () => Effect.Effect<Option.Option<Account>, AccountRepoError>
    readonly list: () => Effect.Effect<Account[], AccountRepoError>
    readonly remove: (accountID: AccountID) => Effect.Effect<void, AccountRepoError>
    readonly use: (accountID: AccountID, orgID: Option.Option<OrgID>) => Effect.Effect<void, AccountRepoError>
    readonly getRow: (accountID: AccountID) => Effect.Effect<Option.Option<AccountRow>, AccountRepoError>
    readonly persistToken: (input: {
      accountID: AccountID
      accessToken: AccessToken
      refreshToken: RefreshToken
      expiry: Option.Option<number>
    }) => Effect.Effect<void, AccountRepoError>
    readonly persistAccount: (input: {
      id: AccountID
      email: string
      url: string
      accessToken: AccessToken
      refreshToken: RefreshToken
      expiry: number
      orgID: Option.Option<OrgID>
    }) => Effect.Effect<void, AccountRepoError>
  }
}

export class AccountRepo extends ServiceMap.Service<AccountRepo, AccountRepo.Service>()("@opencode/AccountRepo") {
  static readonly layer: Layer.Layer<AccountRepo> = Layer.effect(
    AccountRepo,
    Effect.gen(function* () {
      const decode = Schema.decodeUnknownSync(Account)

      const err = (cause: unknown) =>
        new AccountRepoError({
          message: cause instanceof Error ? `Database operation failed: ${cause.message}` : "Database operation failed",
          cause,
        })

      const query = <A>(f: (db: DbClient) => Promise<A>) =>
        Effect.tryPromise({
          try: () => Database.use(f),
          catch: (cause) => err(cause),
        })

      const tx = <A>(f: (db: DbClient) => Promise<A>) =>
        Effect.tryPromise({
          try: () => Database.use(f),
          catch: (cause) => err(cause),
        })

      const current = async (db: DbClient) => {
        const states = await db.select().from(AccountStateTable).where(eq(AccountStateTable.id, ACCOUNT_STATE_ID))
        const state = states[0]
        if (!state?.active_account_id) return
        const accounts = await db.select().from(AccountTable).where(eq(AccountTable.id, state.active_account_id))
        const account = accounts[0]
        if (!account) return
        return { ...account, active_org_id: state.active_org_id ?? null }
      }

      const state = async (db: DbClient, accountID: AccountID, orgID: Option.Option<OrgID>) => {
        const id = Option.getOrNull(orgID)
        await db
          .insert(AccountStateTable)
          .values({ id: ACCOUNT_STATE_ID, active_account_id: accountID, active_org_id: id })
          .onConflictDoUpdate({
            target: AccountStateTable.id,
            set: { active_account_id: accountID, active_org_id: id },
          })
      }

      const active = Effect.fn("AccountRepo.active")(() =>
        query((db) => current(db)).pipe(Effect.map((row) => (row ? Option.some(decode(row)) : Option.none()))),
      )

      const list = Effect.fn("AccountRepo.list")(() =>
        query(async (db) => {
          const rows = await db.select().from(AccountTable)
          return rows.map((row: AccountRow) => decode({ ...row, active_org_id: null }))
        }),
      )

      const remove = Effect.fn("AccountRepo.remove")((accountID: AccountID) =>
        tx(async (db) => {
          await db
            .update(AccountStateTable)
            .set({ active_account_id: null, active_org_id: null })
            .where(eq(AccountStateTable.active_account_id, accountID))
          await db.delete(AccountTable).where(eq(AccountTable.id, accountID))
        }).pipe(Effect.asVoid),
      )

      const use = Effect.fn("AccountRepo.use")((accountID: AccountID, orgID: Option.Option<OrgID>) =>
        query(async (db) => state(db, accountID, orgID)).pipe(Effect.asVoid),
      )

      const getRow = Effect.fn("AccountRepo.getRow")((accountID: AccountID) =>
        query(async (db) => {
          const rows = await db.select().from(AccountTable).where(eq(AccountTable.id, accountID))
          return rows[0]
        }).pipe(Effect.map(Option.fromNullishOr)),
      )

      const persistToken = Effect.fn("AccountRepo.persistToken")((input) =>
        query((db) =>
          db
            .update(AccountTable)
            .set({
              access_token: input.accessToken,
              refresh_token: input.refreshToken,
              token_expiry: Option.getOrNull(input.expiry),
            })
            .where(eq(AccountTable.id, input.accountID)),
        ).pipe(Effect.asVoid),
      )

      const persistAccount = Effect.fn("AccountRepo.persistAccount")((input) =>
        tx(async (db) => {
          const now = Date.now()
          await db
            .insert(AccountTable)
            .values({
              id: input.id,
              email: input.email,
              url: input.url,
              access_token: input.accessToken,
              refresh_token: input.refreshToken,
              token_expiry: input.expiry,
              time_created: now,
              time_updated: now,
            })
            .onConflictDoUpdate({
              target: AccountTable.id,
              set: {
                email: input.email,
                url: input.url,
                access_token: input.accessToken,
                refresh_token: input.refreshToken,
                token_expiry: input.expiry,
                time_updated: now,
              },
            })
          await state(db, input.id, input.orgID)
        }).pipe(Effect.asVoid),
      )

      return AccountRepo.of({
        active,
        list,
        remove,
        use,
        getRow,
        persistToken,
        persistAccount,
      })
    }),
  )
}
