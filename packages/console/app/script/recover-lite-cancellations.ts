import type { Stripe } from "stripe"
import { Billing } from "@opencode-ai/console-core/billing.js"
import { BlackData } from "@opencode-ai/console-core/black.js"
import { Database, and, inArray, isNotNull } from "@opencode-ai/console-core/drizzle/index.js"
import { LiteData } from "@opencode-ai/console-core/lite.js"
import { BillingTable } from "@opencode-ai/console-core/schema/billing.sql.js"
import { subscriptionKind } from "../src/routes/stripe/lite-cancellation.js"

const after = option("after")
const before = option("before")
if (!after || !before) throw new Error("Usage: recover-lite-cancellations.ts --after=<ISO> --before=<ISO> [--apply --expect=<count>]")

const start = new Date(after)
const end = new Date(before)
if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) throw new Error("Invalid recovery window")
if (start >= end) throw new Error("Recovery window must end after it starts")
if (end.getTime() - start.getTime() > 24 * 60 * 60 * 1000) throw new Error("Recovery window cannot exceed 24 hours")

const subscriptionIDs: string[] = []
for await (const event of Billing.stripe().events.list({
  type: "customer.subscription.deleted",
  created: {
    gte: Math.floor(start.getTime() / 1000),
    lt: Math.floor(end.getTime() / 1000),
  },
  limit: 100,
})) {
  const subscription = event.data.object as Stripe.Subscription
  if (
    subscriptionKind(subscription, {
      liteProductID: LiteData.productID(),
      blackProductID: BlackData.productID(),
    }) !== "lite"
  )
    continue
  subscriptionIDs.push(subscription.id)
}

const stale = subscriptionIDs.length
  ? await Database.use((tx) =>
      tx
        .select({ subscriptionID: BillingTable.liteSubscriptionID })
        .from(BillingTable)
        .where(and(isNotNull(BillingTable.liteSubscriptionID), inArray(BillingTable.liteSubscriptionID, subscriptionIDs)))
        .then((rows) => rows.map((row) => row.subscriptionID).filter((value): value is string => !!value)),
    )
  : []

const apply = process.argv.includes("--apply")
const expected = option("expect")
if (!apply) {
  console.log(JSON.stringify({ after: start.toISOString(), before: end.toISOString(), deletedGoSubscriptions: subscriptionIDs.length, staleEntitlements: stale.length, applied: false }))
  process.exit(0)
}
if (!expected || Number(expected) !== stale.length) {
  throw new Error(`Expected stale entitlement count must equal ${stale.length}`)
}

let cursor = 0
await Promise.all(
  Array.from({ length: Math.min(4, stale.length) }, async () => {
    while (true) {
      const index = cursor++
      if (index >= stale.length) return
      await Billing.unsubscribeLite({ subscriptionID: stale[index] })
    }
  }),
)

console.log(JSON.stringify({ after: start.toISOString(), before: end.toISOString(), deletedGoSubscriptions: subscriptionIDs.length, staleEntitlements: stale.length, applied: true }))

function option(name: string) {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)
}
