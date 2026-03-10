import { eq } from "drizzle-orm"
import { Effect, Layer, Option, Schema, ServiceMap } from "effect"

import { Database } from "@/storage/db"
import { AccountStateTable, AccountTable } from "./account.sql"
import { Account, AccountID, AccountRepoError, OrgID } from "./schema"

export type AccountRow = (typeof AccountTable)["$inferSelect"]

const decodeAccount = Schema.decodeUnknownSync(Account)

type DbClient = Parameters<typeof Database.use>[0] extends (db: infer T) => unknown ? T : never

const ACCOUNT_STATE_ID = 1

const db = <A>(run: (db: DbClient) => A) =>
  Effect.try({
    try: () => Database.use(run),
    catch: (cause) => new AccountRepoError({ message: "Database operation failed", cause }),
  })

const current = (db: DbClient) => {
  const state = db.select().from(AccountStateTable).where(eq(AccountStateTable.id, ACCOUNT_STATE_ID)).get()
  if (!state?.active_account_id) return
  const account = db.select().from(AccountTable).where(eq(AccountTable.id, state.active_account_id)).get()
  if (!account) return
  return { ...account, active_org_id: state.active_org_id ?? null }
}

const setState = (db: DbClient, accountID: AccountID, orgID: string | null) =>
  db
    .insert(AccountStateTable)
    .values({ id: ACCOUNT_STATE_ID, active_account_id: accountID, active_org_id: orgID })
    .onConflictDoUpdate({
      target: AccountStateTable.id,
      set: { active_account_id: accountID, active_org_id: orgID },
    })
    .run()

export class AccountRepo extends ServiceMap.Service<
  AccountRepo,
  {
    readonly active: () => Effect.Effect<Option.Option<Account>, AccountRepoError>
    readonly list: () => Effect.Effect<Account[], AccountRepoError>
    readonly remove: (accountID: AccountID) => Effect.Effect<void, AccountRepoError>
    readonly use: (accountID: AccountID, orgID: Option.Option<OrgID>) => Effect.Effect<void, AccountRepoError>
    readonly getRow: (accountID: AccountID) => Effect.Effect<Option.Option<AccountRow>, AccountRepoError>
    readonly persistToken: (input: {
      accountID: AccountID
      accessToken: string
      refreshToken: string
      expiry: Option.Option<number>
    }) => Effect.Effect<void, AccountRepoError>
    readonly persistAccount: (input: {
      id: AccountID
      email: string
      url: string
      accessToken: string
      refreshToken: string
      expiry: number
      orgID: Option.Option<OrgID>
    }) => Effect.Effect<void, AccountRepoError>
  }
>()("@opencode/AccountRepo") {
  static readonly layer: Layer.Layer<AccountRepo> = Layer.succeed(
    AccountRepo,
    AccountRepo.of({
      active: Effect.fn("AccountRepo.active")(() =>
        db((db) => current(db)).pipe(Effect.map((row) => (row ? Option.some(decodeAccount(row)) : Option.none()))),
      ),

      list: Effect.fn("AccountRepo.list")(() =>
        db((db) =>
          db
            .select()
            .from(AccountTable)
            .all()
            .map((row) => decodeAccount({ ...row, active_org_id: null })),
        ),
      ),

      remove: Effect.fn("AccountRepo.remove")((accountID: AccountID) =>
        db((db) =>
          Database.transaction((tx) => {
            tx.update(AccountStateTable)
              .set({ active_account_id: null, active_org_id: null })
              .where(eq(AccountStateTable.active_account_id, accountID))
              .run()
            tx.delete(AccountTable).where(eq(AccountTable.id, accountID)).run()
          }),
        ).pipe(Effect.asVoid),
      ),

      use: Effect.fn("AccountRepo.use")((accountID: AccountID, orgID: Option.Option<OrgID>) =>
        db((db) => setState(db, accountID, Option.getOrNull(orgID))).pipe(Effect.asVoid),
      ),

      getRow: Effect.fn("AccountRepo.getRow")((accountID: AccountID) =>
        db((db) => db.select().from(AccountTable).where(eq(AccountTable.id, accountID)).get()).pipe(
          Effect.map(Option.fromNullishOr),
        ),
      ),

      persistToken: Effect.fn("AccountRepo.persistToken")((input) =>
        db((db) =>
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
      ),

      persistAccount: Effect.fn("AccountRepo.persistAccount")((input) => {
        const orgID = Option.getOrNull(input.orgID)
        return db((db) =>
          Database.transaction((tx) => {
            tx.insert(AccountTable)
              .values({
                id: input.id,
                email: input.email,
                url: input.url,
                access_token: input.accessToken,
                refresh_token: input.refreshToken,
                token_expiry: input.expiry,
              })
              .onConflictDoUpdate({
                target: AccountTable.id,
                set: {
                  access_token: input.accessToken,
                  refresh_token: input.refreshToken,
                  token_expiry: input.expiry,
                },
              })
              .run()
            setState(tx, input.id, orgID)
          }),
        ).pipe(Effect.asVoid)
      }),
    }),
  )
}
