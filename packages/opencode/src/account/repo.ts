import { eq } from "drizzle-orm"
import { Effect, Layer, Option, Schema, ServiceMap } from "effect"

import { Database } from "@/storage/db"
import { AccountStateTable, AccountTable } from "./account.sql"
import { AccessToken, AccountID, AccountRepoError, Info, OrgID, RefreshToken } from "./schema"
import { normalizeServerUrl } from "./url"

export type AccountRow = (typeof AccountTable)["$inferSelect"]

type DbClient = Parameters<typeof Database.use>[0] extends (db: infer T) => unknown ? T : never
type DbTransactionCallback<A> = Parameters<typeof Database.transaction<A>>[0]

const ACCOUNT_STATE_ID = 1

export namespace AccountRepo {
  export interface Service {
    readonly active: () => Effect.Effect<Option.Option<Info>, AccountRepoError>
    readonly list: () => Effect.Effect<Info[], AccountRepoError>
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
      const decode = Schema.decodeUnknownSync(Info)

      const query = <A>(f: DbTransactionCallback<A>) =>
        Effect.try({
          try: () => Database.use(f),
          catch: (cause) => new AccountRepoError({ message: "Database operation failed", cause }),
        })

      const tx = <A>(f: DbTransactionCallback<A>) =>
        Effect.try({
          try: () => Database.transaction(f),
          catch: (cause) => new AccountRepoError({ message: "Database operation failed", cause }),
        })

      const current = (db: DbClient) => {
        const state = db.select().from(AccountStateTable).where(eq(AccountStateTable.id, ACCOUNT_STATE_ID)).get()
        if (!state?.active_account_id) return
        const account = db.select().from(AccountTable).where(eq(AccountTable.id, state.active_account_id)).get()
        if (!account) return
        return { ...account, active_org_id: state.active_org_id ?? null }
      }

      const state = (db: DbClient, accountID: AccountID, orgID: Option.Option<OrgID>) => {
        const id = Option.getOrNull(orgID)
        return db
          .insert(AccountStateTable)
          .values({ id: ACCOUNT_STATE_ID, active_account_id: accountID, active_org_id: id })
          .onConflictDoUpdate({
            target: AccountStateTable.id,
            set: { active_account_id: accountID, active_org_id: id },
          })
          .run()
      }

      const active = Effect.fn("AccountRepo.active")(() =>
        query((db) => current(db)).pipe(Effect.map((row) => (row ? Option.some(decode(row)) : Option.none()))),
      )

      const list = Effect.fn("AccountRepo.list")(() =>
        query((db) =>
          db
            .select()
            .from(AccountTable)
            .all()
            .map((row: AccountRow) => decode({ ...row, active_org_id: null })),
        ),
      )

      const remove = Effect.fn("AccountRepo.remove")((accountID: AccountID) =>
        tx((db) => {
          db.update(AccountStateTable)
            .set({ active_account_id: null, active_org_id: null })
            .where(eq(AccountStateTable.active_account_id, accountID))
            .run()
          db.delete(AccountTable).where(eq(AccountTable.id, accountID)).run()
        }).pipe(Effect.asVoid),
      )

      const use = Effect.fn("AccountRepo.use")((accountID: AccountID, orgID: Option.Option<OrgID>) =>
        query((db) => state(db, accountID, orgID)).pipe(Effect.asVoid),
      )

      const getRow = Effect.fn("AccountRepo.getRow")((accountID: AccountID) =>
        query((db) => db.select().from(AccountTable).where(eq(AccountTable.id, accountID)).get()).pipe(
          Effect.map(Option.fromNullishOr),
        ),
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
            .where(eq(AccountTable.id, input.accountID))
            .run(),
        ).pipe(Effect.asVoid),
      )

      const persistAccount = Effect.fn("AccountRepo.persistAccount")((input) =>
        tx((db) => {
          const url = normalizeServerUrl(input.url)

          db.insert(AccountTable)
            .values({
              id: input.id,
              email: input.email,
              url,
              access_token: input.accessToken,
              refresh_token: input.refreshToken,
              token_expiry: input.expiry,
            })
            .onConflictDoUpdate({
              target: AccountTable.id,
              set: {
                email: input.email,
                url,
                access_token: input.accessToken,
                refresh_token: input.refreshToken,
                token_expiry: input.expiry,
              },
            })
            .run()
          void state(db, input.id, input.orgID)
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
