import { z } from "zod"
import { fn } from "./util/fn"
import { Account } from "./account"
import { Actor } from "./actor"
import { and, Database, eq } from "./drizzle"
import { Identifier } from "./identifier"
import { Key } from "./key"
import { AuthTable } from "./schema/auth.sql"
import { BillingTable, SubscriptionPlan, SubscriptionTable } from "./schema/billing.sql"
import { KeyTable } from "./schema/key.sql"
import { UserTable } from "./schema/user.sql"
import { WorkspaceTable } from "./schema/workspace.sql"
import { Workspace } from "./workspace"

export namespace CompanyLicense {
  const Input = z.object({
    externalLicenseId: z.string().min(1),
    companyName: z.string().min(1).max(255),
    ownerEmail: z.string().email(),
    seatCount: z.number().int().min(1),
    status: z.enum(["active", "grace", "suspended", "canceled"]),
    opencodePlan: z.enum(SubscriptionPlan),
    stripeCustomerId: z.string().nullable(),
    stripeSubscriptionId: z.string().nullable(),
    stripePriceId: z.string().nullable(),
    currentPeriodEnd: z.string().nullable(),
    cancelAtPeriodEnd: z.boolean(),
    workspaceId: z.string().nullable().optional(),
  })

  const active = new Set(["active", "grace"])

  const account = async (email: string) => {
    const existing = await Database.use((tx) =>
      tx
        .select({
          accountID: AuthTable.accountID,
        })
        .from(AuthTable)
        .where(and(eq(AuthTable.provider, "email"), eq(AuthTable.subject, email)))
        .then((rows) => rows[0]?.accountID),
    )
    if (existing) return existing

    const accountID = await Account.create({})
    await Database.use((tx) =>
      tx.insert(AuthTable).values({
        id: Identifier.create("auth"),
        accountID,
        provider: "email",
        subject: email,
      }),
    )
    return accountID
  }

  const user = async (workspaceID: string, accountID: string, email: string) => {
    const existing = await Database.use((tx) =>
      tx
        .select({ id: UserTable.id })
        .from(UserTable)
        .where(and(eq(UserTable.workspaceID, workspaceID), eq(UserTable.accountID, accountID)))
        .then((rows) => rows[0]),
    )
    if (existing) return existing.id

    const invited = await Database.use((tx) =>
      tx
        .select({ id: UserTable.id })
        .from(UserTable)
        .where(and(eq(UserTable.workspaceID, workspaceID), eq(UserTable.email, email)))
        .then((rows) => rows[0]),
    )
    if (invited) {
      await Database.use((tx) =>
        tx
          .update(UserTable)
          .set({
            accountID,
            email: null,
            role: "admin",
          })
          .where(and(eq(UserTable.workspaceID, workspaceID), eq(UserTable.id, invited.id))),
      )
      return invited.id
    }

    const id = Identifier.create("user")
    await Database.use((tx) =>
      tx.insert(UserTable).values({
        workspaceID,
        id,
        accountID,
        name: "",
        role: "admin",
      }),
    )
    return id
  }

  const key = async (workspaceID: string, userID: string) => {
    const existing = await Database.use((tx) =>
      tx
        .select({ id: KeyTable.id })
        .from(KeyTable)
        .where(and(eq(KeyTable.workspaceID, workspaceID), eq(KeyTable.userID, userID)))
        .then((rows) => rows[0]),
    )
    if (existing) return existing.id

    return Actor.provide("system", { workspaceID }, () => Key.create({ userID, name: "Default API Key" }))
  }

  const workspace = async (workspaceID: string | null | undefined, accountID: string, email: string, name: string) => {
    if (!workspaceID) {
      return Actor.provide("account", { accountID, email }, () => Workspace.create({ name }))
    }

    await Database.use((tx) =>
      tx
        .update(WorkspaceTable)
        .set({ name })
        .where(eq(WorkspaceTable.id, workspaceID)),
    )
    return workspaceID
  }

  const assigned = async (workspaceID: string) => {
    return Database.use((tx) =>
      tx
        .select({
          id: SubscriptionTable.id,
          userID: SubscriptionTable.userID,
          timeCreated: SubscriptionTable.timeCreated,
        })
        .from(SubscriptionTable)
        .where(eq(SubscriptionTable.workspaceID, workspaceID)),
    )
  }

  const normalize = async (workspaceID: string, ownerUserID: string, seats: number) => {
    const rows = await assigned(workspaceID)
    const owner = rows.find((item) => item.userID === ownerUserID)
    if (!owner) {
      await Database.use((tx) =>
        tx.insert(SubscriptionTable).values({
          workspaceID,
          id: Identifier.create("subscription"),
          userID: ownerUserID,
        }),
      )
    }

    const next = owner ? rows : await assigned(workspaceID)
    const sorted = next.sort((a, b) => {
      if (a.userID === ownerUserID) return -1
      if (b.userID === ownerUserID) return 1
      return a.timeCreated.getTime() - b.timeCreated.getTime()
    })
    const keep = new Set(sorted.slice(0, seats).map((item) => item.id))
    const drop = sorted.filter((item) => !keep.has(item.id))
    if (drop.length === 0) return

    await Database.transaction(async (tx) => {
      await Promise.all(
        drop.map((item) =>
          tx.delete(SubscriptionTable).where(and(eq(SubscriptionTable.workspaceID, workspaceID), eq(SubscriptionTable.id, item.id))),
        ),
      )
    })
  }

  export const sync = fn(Input, async (input) => {
    const email = input.ownerEmail.toLowerCase()
    const accountID = await account(email)
    const workspaceID = await workspace(input.workspaceId, accountID, email, input.companyName)
    const ownerUserID = await user(workspaceID, accountID, email)
    await key(workspaceID, ownerUserID)

    if (active.has(input.status)) {
      await Database.use((tx) =>
        tx
          .update(BillingTable)
          .set({
            subscription: {
              status: "subscribed",
              seats: input.seatCount,
              plan: input.opencodePlan,
            },
          })
          .where(eq(BillingTable.workspaceID, workspaceID)),
      )
      await normalize(workspaceID, ownerUserID, input.seatCount)
      return {
        workspaceId: workspaceID,
        ownerUserId: ownerUserID,
        status: input.status,
      }
    }

    await Database.transaction(async (tx) => {
      await tx
        .update(BillingTable)
        .set({
          subscription: null,
        })
        .where(eq(BillingTable.workspaceID, workspaceID))

      await tx.delete(SubscriptionTable).where(eq(SubscriptionTable.workspaceID, workspaceID))
    })

    return {
      workspaceId: workspaceID,
      ownerUserId: ownerUserID,
      status: input.status,
    }
  })
}
