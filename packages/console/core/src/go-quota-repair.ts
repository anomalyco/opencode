import { createHash, randomUUID } from "node:crypto"
import { and, eq, isNull, sql } from "drizzle-orm"
import type { MySqlAsyncDatabase, MySqlQueryResultHKT } from "drizzle-orm/mysql-core"
import type { Stripe } from "stripe"
import { z } from "zod"
import { AccountTable } from "./schema/account.sql"
import { AuthTable } from "./schema/auth.sql"
import { BillingTable, LiteTable } from "./schema/billing.sql"
import { GoQuotaRepairTable } from "./schema/go-quota-repair.sql"
import { UserTable } from "./schema/user.sql"
import { WorkspaceTable } from "./schema/workspace.sql"
import { getMonthlyBounds } from "./util/date"

export namespace GoQuotaRepair {
  const timestamp = z.string().datetime({ precision: 3 })
  const usage = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
  export const Input = z
    .object({
      idempotencyKey: z.string().min(1).max(255),
      email: z.string().email().max(255),
      workspaceID: z.string().min(1).max(30),
      liteID: z.string().min(1).max(30),
      userID: z.string().min(1).max(30),
      customerID: z.string().min(1).max(255),
      subscriptionID: z.string().min(1).max(28),
      timeCreated: timestamp,
      periodStart: timestamp,
      periodEnd: timestamp,
      expectedMonthlyUsage: usage,
      expectedTimeMonthlyUpdated: timestamp,
      monthlyUsage: usage,
    })
    .strict()
    .refine((input) => input.monthlyUsage < input.expectedMonthlyUsage, {
      message: "Monthly usage must strictly decrease",
      path: ["monthlyUsage"],
    })
  export type Input = z.infer<typeof Input>
  export type Receipt = {
    status: "repaired"
    receiptId: string
    workspaceID: string
    liteID: string
    subscriptionID: string
    periodStart: string
    periodEnd: string
    previousMonthlyUsage: number
    monthlyUsage: number
    timeMonthlyUpdated: string
  }
  export class Conflict extends Error {}

  type DB = MySqlAsyncDatabase<MySqlQueryResultHKT>
  export type Dependencies = {
    use: <T>(callback: (db: DB) => Promise<T>) => Promise<T>
    transaction: <T>(callback: (tx: DB) => Promise<T>) => Promise<T>
    now: () => Date
    subscription: (id: string) => Promise<
      Pick<Stripe.Subscription, "id" | "status" | "customer"> & {
        items: {
          data: { price: Pick<Stripe.Price, "id" | "product" | "currency" | "unit_amount" | "recurring"> }[]
        }
      }
    >
    go: { productID: string; priceID: string; priceInr: number }
  }

  export async function repair(value: Input, options?: Dependencies): Promise<Receipt> {
    const input = Input.parse(value)
    const deps = options ?? (await dependencies())
    const key = createHash("sha256").update(input.idempotencyKey).digest("hex")
    const prior = await deps.use((db) =>
      db.select().from(GoQuotaRepairTable).where(eq(GoQuotaRepairTable.key_hash, key)),
    )
    if (prior[0]) return replay(prior[0], input)

    // Stripe is read-only and outside the database transaction. Local bindings are locked and rechecked below.
    const stripe = await deps.subscription(input.subscriptionID).then(
      (subscription) => ({ subscription }),
      (error: unknown) => ({ error }),
    )
    return deps.transaction(async (tx) => {
      // A duplicate insert waits for the first transaction, then reads its committed receipt.
      await tx
        .insert(GoQuotaRepairTable)
        .values({ key_hash: key, receipt_id: randomUUID(), input })
        .onDuplicateKeyUpdate({ set: { key_hash: sql`${GoQuotaRepairTable.key_hash}` } })
      const [receipt] = await tx
        .select()
        .from(GoQuotaRepairTable)
        .where(eq(GoQuotaRepairTable.key_hash, key))
        .for("update")
      if (receipt.result) return replay(receipt, input)
      if (!sameInput(receipt.input, input)) throw new Conflict("Idempotency key already used for different input")
      if ("error" in stripe) throw stripe.error
      const subscription = stripe.subscription

      const rows = await tx
        .select({ lite: LiteTable, billing: BillingTable })
        .from(LiteTable)
        .innerJoin(BillingTable, eq(BillingTable.workspaceID, LiteTable.workspaceID))
        .innerJoin(UserTable, and(eq(UserTable.workspaceID, LiteTable.workspaceID), eq(UserTable.id, LiteTable.userID)))
        .innerJoin(AccountTable, eq(AccountTable.id, UserTable.accountID))
        .innerJoin(AuthTable, eq(AuthTable.accountID, AccountTable.id))
        .innerJoin(WorkspaceTable, eq(WorkspaceTable.id, LiteTable.workspaceID))
        .where(
          and(
            eq(LiteTable.workspaceID, input.workspaceID),
            eq(LiteTable.id, input.liteID),
            eq(LiteTable.userID, input.userID),
            eq(AuthTable.provider, "email"),
            eq(AuthTable.subject, input.email),
            isNull(LiteTable.timeDeleted),
            isNull(BillingTable.timeDeleted),
            isNull(UserTable.timeDeleted),
            isNull(AccountTable.timeDeleted),
            isNull(AuthTable.timeDeleted),
            isNull(WorkspaceTable.timeDeleted),
          ),
        )
        .for("update")
      if (rows.length !== 1) throw new Conflict("Active requester membership or Go quota row changed")
      const row = rows[0]
      if (
        row.billing.customerID !== input.customerID ||
        row.billing.liteSubscriptionID !== input.subscriptionID ||
        row.lite.timeCreated.toISOString() !== input.timeCreated
      )
        throw new Conflict("Go subscription binding changed")
      if (
        subscription.id !== input.subscriptionID ||
        subscription.status !== "active" ||
        (typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id) !==
          input.customerID ||
        subscription.items.data.length !== 1 ||
        !subscription.items.data.every(
          ({ price }) =>
            (typeof price.product === "string" ? price.product : price.product.id) === deps.go.productID &&
            price.recurring?.interval === "month" &&
            price.recurring.interval_count === 1 &&
            (price.id === deps.go.priceID || (price.currency === "inr" && price.unit_amount === deps.go.priceInr)),
        )
      )
        throw new Conflict("Active Stripe Go subscription does not match")

      const now = deps.now()
      const period = getMonthlyBounds(now, row.lite.timeCreated)
      const updated = new Date(input.expectedTimeMonthlyUpdated)
      if (
        period.start.toISOString() !== input.periodStart ||
        period.end.toISOString() !== input.periodEnd ||
        row.lite.timeCreated > now ||
        updated < period.start ||
        updated >= period.end ||
        updated > now
      )
        throw new Conflict("Monthly repair window expired or snapshot is outside the current period")
      if (
        row.lite.monthlyUsage !== input.expectedMonthlyUsage ||
        row.lite.timeMonthlyUpdated?.toISOString() !== input.expectedTimeMonthlyUpdated
      )
        throw new Conflict("Monthly usage snapshot changed")

      await tx
        .update(LiteTable)
        .set({ monthlyUsage: input.monthlyUsage })
        .where(
          and(
            eq(LiteTable.workspaceID, input.workspaceID),
            eq(LiteTable.id, input.liteID),
            eq(LiteTable.userID, input.userID),
            eq(LiteTable.timeCreated, new Date(input.timeCreated)),
            isNull(LiteTable.timeDeleted),
            eq(LiteTable.monthlyUsage, input.expectedMonthlyUsage),
            eq(LiteTable.timeMonthlyUpdated, updated),
          ),
        )
      // ROW_COUNT is connection-local and works with both the PlanetScale and local MySQL drivers.
      const [change] = await tx.select({ count: sql<number>`row_count()` }).from(sql`(select 1) as repair_change`)
      if (Number(change.count) !== 1) throw new Conflict("Monthly usage snapshot changed")
      const result: Receipt = {
        status: "repaired",
        receiptId: receipt.receipt_id,
        workspaceID: input.workspaceID,
        liteID: input.liteID,
        subscriptionID: input.subscriptionID,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        previousMonthlyUsage: input.expectedMonthlyUsage,
        monthlyUsage: input.monthlyUsage,
        timeMonthlyUpdated: input.expectedTimeMonthlyUpdated,
      }
      await tx.update(GoQuotaRepairTable).set({ result }).where(eq(GoQuotaRepairTable.key_hash, key))
      return result
    })
  }

  function sameInput(left: Input, right: Input) {
    return Object.keys(right).every((key) => left[key as keyof Input] === right[key as keyof Input])
  }

  function replay(receipt: typeof GoQuotaRepairTable.$inferSelect, input: Input) {
    if (!sameInput(receipt.input, input)) throw new Conflict("Idempotency key already used for different input")
    if (!receipt.result) throw new Conflict("Monthly repair receipt is incomplete")
    return receipt.result
  }

  async function dependencies(): Promise<Dependencies> {
    const { Database } = await import("./drizzle")
    const { Billing } = await import("./billing")
    const { LiteData } = await import("./lite")
    return {
      use: Database.use,
      transaction: Database.transaction,
      now: () => new Date(),
      subscription: (id) =>
        Billing.stripe()
          .subscriptions.retrieve(id)
          .catch((error: unknown) => {
            if (error instanceof Error && "statusCode" in error && error.statusCode === 404)
              throw new Conflict("Stripe Go subscription no longer exists")
            throw error
          }),
      go: { productID: LiteData.productID(), priceID: LiteData.priceID(), priceInr: LiteData.priceInr() },
    }
  }
}
