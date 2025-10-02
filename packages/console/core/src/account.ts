import { z } from "zod"
import { and, eq, getTableColumns, isNull } from "drizzle-orm"
import { fn } from "./util/fn"
import { Database } from "./drizzle"
import { Identifier } from "./identifier"
import { AccountTable } from "./schema/account.sql"
import { Actor } from "./actor"
import { WorkspaceTable } from "./schema/workspace.sql"
import { UserTable } from "./schema/user.sql"

export namespace Account {
  export const create = fn(
    z.object({
      email: z.string().email(),
      id: z.string().optional(),
    }),
    async (input) =>
      Database.transaction(async (tx) => {
        const id = input.id ?? Identifier.create("account")
        await tx.insert(AccountTable).values({
          id,
          email: input.email,
        })
        return id
      }),
  )

  export const fromID = fn(z.string(), async (id) =>
    Database.transaction(async (tx) => {
      return tx
        .select()
        .from(AccountTable)
        .where(eq(AccountTable.id, id))
        .execute()
        .then((rows) => rows[0])
    }),
  )

  export const fromEmail = fn(z.string().email(), async (email) =>
    Database.transaction(async (tx) => {
      return tx
        .select()
        .from(AccountTable)
        .where(eq(AccountTable.email, email))
        .execute()
        .then((rows) => rows[0])
    }),
  )

  export const workspaces = async () => {
    const actor = Actor.assert("account")
    return Database.transaction(async (tx) =>
      tx
        .select(getTableColumns(WorkspaceTable))
        .from(WorkspaceTable)
        .innerJoin(UserTable, eq(UserTable.workspaceID, WorkspaceTable.id))
        .where(and(eq(UserTable.email, actor.properties.email), isNull(WorkspaceTable.timeDeleted)))
        .execute(),
    )
  }
}
