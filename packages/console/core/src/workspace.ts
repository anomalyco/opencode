import { z } from "zod"
import { fn } from "./util/fn"
import { Actor } from "./actor"
import { Database } from "./drizzle"
import { Identifier } from "./identifier"
import { UserTable } from "./schema/user.sql"
import { BillingTable } from "./schema/billing.sql"
import { WorkspaceTable } from "./schema/workspace.sql"
import { Key } from "./key"
import { eq, sql } from "drizzle-orm"

export namespace Workspace {
  export const create = fn(
    z.object({
      name: z.string().min(1),
    }),
    async ({ name }) => {
      const account = Actor.assert("account")
      const workspaceID = Identifier.create("workspace")
      const userID = Identifier.create("user")
      await Database.transaction(async (tx) => {
        await tx.insert(WorkspaceTable).values({
          id: workspaceID,
          name,
        })
        await tx.insert(UserTable).values({
          workspaceID,
          id: userID,
          accountID: account.properties.accountID,
          name: "",
          role: "admin",
        })
        await tx.insert(BillingTable).values({
          workspaceID,
          id: Identifier.create("billing"),
          balance: 0,
        })
      })
      await Actor.provide(
        "system",
        {
          workspaceID,
        },
        () => Key.create({ userID, name: "Default API Key" }),
      )
      return workspaceID
    },
  )

  export const update = fn(
    z.object({
      name: z.string().min(1).max(255),
    }),
    async ({ name }) => {
      Actor.assertAdmin()
      const workspaceID = Actor.workspace()
      return await Database.use((tx) =>
        tx
          .update(WorkspaceTable)
          .set({
            name,
          })
          .where(eq(WorkspaceTable.id, workspaceID)),
      )
    },
  )

  export const remove = fn(z.void(), async () => {
    await Database.use((tx) =>
      tx
        .update(WorkspaceTable)
        .set({ timeDeleted: sql`now()` })
        .where(eq(WorkspaceTable.id, Actor.workspace())),
    )
  })
}
