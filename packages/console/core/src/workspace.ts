import { z } from "zod"
import { fn } from "./util/fn"
import { Actor } from "./actor"
import { Database } from "./drizzle"
import { Identifier } from "./identifier"
import { UserTable } from "./schema/user.sql"
import { BillingTable, LiteTable, SubscriptionTable } from "./schema/billing.sql"
import { WorkspaceTable } from "./schema/workspace.sql"
import { AccountTable } from "./schema/account.sql"
import { Key } from "./key"
import { and, eq, isNull, sql } from "drizzle-orm"
import { AuthTable } from "./schema/auth.sql"
import { KeyTable } from "./schema/key.sql"
import { ProviderTable } from "./schema/provider.sql"
import { ModelTable } from "./schema/model.sql"

export namespace Workspace {
  export class RemovalRejected extends Error {}

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

  export const removeExact = fn(
    z.object({
      workspaceID: z.string().startsWith("wrk_"),
      expectedRequesterEmail: z.email(),
    }),
    async (input) => {
      await Database.transaction(async (tx) => {
        const workspace = await tx
          .select({ id: WorkspaceTable.id, timeDeleted: WorkspaceTable.timeDeleted })
          .from(WorkspaceTable)
          .where(eq(WorkspaceTable.id, input.workspaceID))
          .for("update")
          .then((rows) => rows[0])
        if (!workspace) throw new RemovalRejected("Workspace not found")

        const requester = await tx
          .select({
            accountID: AccountTable.id,
            role: UserTable.role,
            invitationEmail: UserTable.email,
            membershipDeleted: UserTable.timeDeleted,
          })
          .from(AuthTable)
          .innerJoin(AccountTable, and(eq(AccountTable.id, AuthTable.accountID), isNull(AccountTable.timeDeleted)))
          .innerJoin(
            UserTable,
            and(eq(UserTable.accountID, AccountTable.id), eq(UserTable.workspaceID, input.workspaceID)),
          )
          .where(
            and(
              eq(AuthTable.provider, "email"),
              eq(AuthTable.subject, input.expectedRequesterEmail),
              isNull(AuthTable.timeDeleted),
            ),
          )
          .for("update")
        if (requester.length !== 1 || requester[0].role !== "admin" || requester[0].invitationEmail) {
          throw new RemovalRejected("Expected requester is not an administrator of this workspace")
        }
        if (!workspace.timeDeleted && requester[0].membershipDeleted) {
          throw new RemovalRejected("Expected requester does not have an active workspace membership")
        }
        if (workspace.timeDeleted) {
          if (!requester[0].membershipDeleted) throw new RemovalRejected("Deleted workspace has an active membership")
          return
        }

        const billing = await tx
          .select({
            timeDeleted: BillingTable.timeDeleted,
            balance: BillingTable.balance,
            reload: BillingTable.reload,
            subscription: BillingTable.subscription,
            subscriptionID: BillingTable.subscriptionID,
            subscriptionPlan: BillingTable.subscriptionPlan,
            timeSubscriptionBooked: BillingTable.timeSubscriptionBooked,
            timeSubscriptionSelected: BillingTable.timeSubscriptionSelected,
            liteSubscriptionID: BillingTable.liteSubscriptionID,
            lite: BillingTable.lite,
          })
          .from(BillingTable)
          .where(eq(BillingTable.workspaceID, input.workspaceID))
          .for("update")
        if (billing.length !== 1 || billing[0].timeDeleted) throw new RemovalRejected("Workspace billing state is inconsistent")
        if (billing[0].balance > 0) throw new RemovalRejected("Workspace has a positive Zen balance")
        if (billing[0].reload) throw new RemovalRejected("Workspace has Zen reload enabled")
        if (
          billing[0].subscription ||
          billing[0].subscriptionID ||
          billing[0].subscriptionPlan ||
          billing[0].timeSubscriptionBooked ||
          billing[0].timeSubscriptionSelected
        ) {
          throw new RemovalRejected("Workspace has active or inconsistent Black billing state")
        }
        if (billing[0].liteSubscriptionID || billing[0].lite) {
          throw new RemovalRejected("Workspace has active or inconsistent Go billing state")
        }

        const black = await tx
          .select({ id: SubscriptionTable.id })
          .from(SubscriptionTable)
          .where(and(eq(SubscriptionTable.workspaceID, input.workspaceID), isNull(SubscriptionTable.timeDeleted)))
          .for("update")
        if (black.length > 0) throw new RemovalRejected("Workspace has active or inconsistent Black entitlement state")
        const go = await tx
          .select({ id: LiteTable.id })
          .from(LiteTable)
          .where(and(eq(LiteTable.workspaceID, input.workspaceID), isNull(LiteTable.timeDeleted)))
          .for("update")
        if (go.length > 0) throw new RemovalRejected("Workspace has active or inconsistent Go entitlement state")

        const timeDeleted = new Date()
        await tx
          .update(WorkspaceTable)
          .set({ timeDeleted })
          .where(and(eq(WorkspaceTable.id, input.workspaceID), isNull(WorkspaceTable.timeDeleted)))
        await tx
          .update(UserTable)
          .set({ timeDeleted })
          .where(and(eq(UserTable.workspaceID, input.workspaceID), isNull(UserTable.timeDeleted)))
        await tx
          .update(KeyTable)
          .set({ timeDeleted })
          .where(and(eq(KeyTable.workspaceID, input.workspaceID), isNull(KeyTable.timeDeleted)))
        await tx.delete(ProviderTable).where(eq(ProviderTable.workspaceID, input.workspaceID))
        await tx.delete(ModelTable).where(eq(ModelTable.workspaceID, input.workspaceID))
      })
    },
  )

  export const unblock = fn(z.string().startsWith("wrk_"), async (workspaceID) => {
    await Database.transaction(async (tx) => {
      const workspace = await tx
        .select({ id: WorkspaceTable.id })
        .from(WorkspaceTable)
        .where(eq(WorkspaceTable.id, workspaceID))
        .then((rows) => rows[0])
      if (!workspace) throw new Error("Workspace not found")
      await tx.update(WorkspaceTable).set({ is_blocked: false }).where(eq(WorkspaceTable.id, workspaceID))
    })
  })
}
