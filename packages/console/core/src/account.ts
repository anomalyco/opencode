import { z } from "zod"
import { and, eq, inArray, sql } from "drizzle-orm"
import { fn } from "./util/fn"
import { Database } from "./drizzle"
import { Identifier } from "./identifier"
import { AccountTable } from "./schema/account.sql"
import { AuthTable } from "./schema/auth.sql"
import { UserTable } from "./schema/user.sql"
import { KeyTable } from "./schema/key.sql"
import { CouponTable } from "./schema/billing.sql"

export namespace Account {
  export const create = fn(
    z.object({
      id: z.string().optional(),
    }),
    async (input) =>
      Database.use(async (tx) => {
        const id = input.id ?? Identifier.create("account")
        await tx.insert(AccountTable).values({
          id,
        })
        return id
      }),
  )

  export const remove = fn(z.email(), async (email) => {
    await Database.transaction(async (tx) => {
      const account = await tx
        .select({ id: AccountTable.id })
        .from(AuthTable)
        .innerJoin(AccountTable, eq(AccountTable.id, AuthTable.accountID))
        .where(and(eq(AuthTable.provider, "email"), eq(AuthTable.subject, email)))
        .then((rows) => rows[0])
      if (!account) throw new Error("Account not found")

      const emails = await tx
        .select({ email: AuthTable.subject })
        .from(AuthTable)
        .where(and(eq(AuthTable.accountID, account.id), eq(AuthTable.provider, "email")))
      const users = await tx.select({ id: UserTable.id }).from(UserTable).where(eq(UserTable.accountID, account.id))
      if (users.length > 0) {
        await tx
          .update(KeyTable)
          .set({ timeDeleted: sql`now()` })
          .where(
            inArray(
              KeyTable.userID,
              users.map((user) => user.id),
            ),
          )
      }
      await tx
        .update(UserTable)
        .set({ accountID: null, email: null, name: "", timeDeleted: sql`now()` })
        .where(eq(UserTable.accountID, account.id))
      if (emails.length > 0) {
        await tx.delete(CouponTable).where(
          inArray(
            CouponTable.email,
            emails.map((row) => row.email),
          ),
        )
      }
      await tx.delete(AuthTable).where(eq(AuthTable.accountID, account.id))
      await tx
        .update(AccountTable)
        .set({ timeDeleted: sql`now()` })
        .where(eq(AccountTable.id, account.id))
    })
  })

  export const fromID = fn(z.string(), async (id) =>
    Database.use((tx) =>
      tx
        .select()
        .from(AccountTable)
        .where(eq(AccountTable.id, id))
        .then((rows) => rows[0]),
    ),
  )
}
