import { Billing } from "../src/billing.js"
import { BlackData } from "../src/black.js"
import { Database, isNotNull } from "../src/drizzle/index.js"
import { BillingTable } from "../src/schema/billing.sql.js"

// Schedules every Black subscription to cancel at the end of its paid period, so
// none renew. The customer.subscription.deleted webhook clears the billing row
// when each period ends. Pointers to subscriptions Stripe has already ended are
// cleared directly, since legacy entitlement reads the billing row rather than
// Stripe. Dry run unless --apply is passed.
const apply = process.argv.includes("--apply")

const rows = await Database.use((tx) =>
  tx
    .select({ workspaceID: BillingTable.workspaceID, subscriptionID: BillingTable.subscriptionID })
    .from(BillingTable)
    .where(isNotNull(BillingTable.subscriptionID)),
)

console.log(`${apply ? "Cancelling" : "Dry run:"} ${rows.length} Black subscription pointers`)

const counts = { scheduled: 0, cleared: 0, skipped: 0 }
for (const row of rows) {
  const subscription = await Billing.stripe().subscriptions.retrieve(row.subscriptionID!)
  const item = subscription.items.data[0]
  const periodEnd = new Date(item.current_period_end * 1000).toISOString()
  const label = `${row.workspaceID} ${subscription.id} status=${subscription.status} renews=${periodEnd}`

  if (item.price.product === BlackData.productID() && ["incomplete_expired", "canceled"].includes(subscription.status)) {
    if (apply) await Billing.unsubscribeBlack({ subscriptionID: subscription.id })
    counts.cleared++
    console.log(`${apply ? "CLEAR" : "WOULD CLEAR"} ${label} (stale pointer)`)
    continue
  }

  const skip = (() => {
    if (item.price.product !== BlackData.productID()) return "not a Black product"
    if (!["active", "trialing", "past_due"].includes(subscription.status)) return "not active"
    if (subscription.cancel_at_period_end || subscription.cancel_at) return "already scheduled to cancel"
    return undefined
  })()
  if (skip) {
    counts.skipped++
    console.log(`SKIP ${label} (${skip})`)
    continue
  }

  if (subscription.metadata.workspaceID && subscription.metadata.workspaceID !== row.workspaceID)
    console.log(`  note: Stripe metadata workspaceID=${subscription.metadata.workspaceID}`)

  if (apply)
    await Billing.stripe().subscriptions.update(subscription.id, {
      cancel_at_period_end: true,
      cancellation_details: { comment: "Legacy Black retirement: cancelled before renewal" },
    })
  counts.scheduled++
  console.log(`${apply ? "CANCEL" : "WOULD CANCEL"} ${label}`)
}

console.log(
  `${apply ? "Scheduled" : "Would schedule"} ${counts.scheduled}, ${apply ? "cleared" : "would clear"} ${counts.cleared}, skipped ${counts.skipped}`,
)
