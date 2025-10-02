import { z } from "zod"
import { fn } from "./util/fn"
import { Actor } from "./actor"
import { Database, sql } from "./drizzle"
import { Identifier } from "./identifier"
import { UserTable } from "./schema/user.sql"
import { BillingTable } from "./schema/billing.sql"
import { WorkspaceTable } from "./schema/workspace.sql"
import { Key } from "./key"

export namespace Workspace {
  export const create = fn(z.void(), async () => {
    const account = Actor.assert("account")
    const workspaceID = Identifier.create("workspace")
    await Database.transaction(async (tx) => {
      await tx.insert(WorkspaceTable).values({
        id: workspaceID,
      })
      await tx.insert(UserTable).values({
        workspaceID,
        id: Identifier.create("user"),
        email: account.properties.email,
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
      async () => {
        await Key.create({ name: "Default API Key" })
      },
    )
    return workspaceID
  })
}
