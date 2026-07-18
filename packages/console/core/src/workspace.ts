import { z } from "zod"
import { fn } from "./util/fn"
import { Actor } from "./actor"
import { Database } from "./drizzle"
import { Identifier } from "./identifier"
import { UserTable } from "./schema/user.sql"
import { BillingTable } from "./schema/billing.sql"
import { WorkspaceTable } from "./schema/workspace.sql"
import { AccountTable } from "./schema/account.sql"
import { Key } from "./key"
import { and, eq, isNull, sql } from "drizzle-orm"

export namespace Workspace {
  export const Region = z.enum(["us", "eu", "sg", "cn"])
  export type Region = z.infer<typeof Region>

  export const create = fn(
    z.object({
      name: z.string().min(1),
    }),
    async ({ name }) => {
      const account = Actor.assert("account")
      const workspaceID = Identifier.create("workspace")
      const userID = Identifier.create("user")
      await Database.transaction(async (tx) => {
        const active = await tx
          .select({ id: AccountTable.id })
          .from(AccountTable)
          .where(and(eq(AccountTable.id, account.properties.accountID), isNull(AccountTable.timeDeleted)))
          .then((rows) => rows[0])
        if (!active) throw new Error("Account is not active")

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
      name: z.string().min(1).max(255).optional(),
      region: z.array(Region).min(1).optional(),
    }),
    async (input) => {
      Actor.assertAdmin()
      const workspaceID = Actor.workspace()
      return await Database.use((tx) =>
        tx
          .update(WorkspaceTable)
          .set({
            ...("name" in input ? { name: input.name } : {}),
            ...("region" in input ? { region: input.region } : {}),
          })
          .where(eq(WorkspaceTable.id, workspaceID)),
      )
    },
  )

  export const setDefaultRegion = fn(
    z.object({
      country: z.string().optional(),
    }),
    async (input) => {
      const region: Workspace.Region[] =
        input.country?.toUpperCase() === "CN" ? ["us", "eu", "sg", "cn"] : ["us", "eu", "sg"]
      await Database.use((tx) =>
        tx
          .update(WorkspaceTable)
          .set({ region })
          .where(and(eq(WorkspaceTable.id, Actor.workspace()), isNull(WorkspaceTable.region))),
      )
      return region
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
