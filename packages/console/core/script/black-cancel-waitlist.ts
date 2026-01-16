import { subscribe } from "diagnostics_channel"
import { Billing } from "../src/billing.js"
import { and, Database, eq } from "../src/drizzle/index.js"
import { BillingTable, PaymentTable, SubscriptionTable } from "../src/schema/billing.sql.js"

const workspaceID = process.argv[2]

if (!workspaceID) {
  console.error("Usage: bun script/foo.ts <workspaceID>")
  process.exit(1)
}

console.log(`Removing from Black waitlist`)

const billing = await Database.use((tx) =>
  tx
    .select({
      subscriptionPlan: BillingTable.subscriptionPlan,
      timeSubscriptionBooked: BillingTable.timeSubscriptionBooked,
    })
    .from(BillingTable)
    .where(eq(BillingTable.workspaceID, workspaceID))
    .then((rows) => rows[0]),
)

if (!billing?.timeSubscriptionBooked) {
  console.error(`Error: Workspace is not on the waitlist`)
  process.exit(1)
}

await Database.use((tx) =>
  tx
    .update(BillingTable)
    .set({
      subscriptionPlan: null,
      timeSubscriptionBooked: null,
    })
    .where(eq(BillingTable.workspaceID, workspaceID)),
)

console.log(`Done`)
