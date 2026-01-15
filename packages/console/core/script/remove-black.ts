import { Billing } from "../src/billing.js"
import { and, Database, eq } from "../src/drizzle/index.js"
import { BillingTable, PaymentTable, SubscriptionTable } from "../src/schema/billing.sql.js"

const workspaceID = process.argv[2]

if (!workspaceID) {
  console.error("Usage: bun remove-black.ts <workspaceID>")
  process.exit(1)
}

console.log(`Removing subscription from workspace ${workspaceID}`)

// Look up the workspace billing
const billing = await Database.use((tx) =>
  tx
    .select({
      customerID: BillingTable.customerID,
      subscriptionID: BillingTable.subscriptionID,
    })
    .from(BillingTable)
    .where(eq(BillingTable.workspaceID, workspaceID))
    .then((rows) => rows[0]),
)

if (!billing) {
  console.error(`Error: No billing record found for workspace ${workspaceID}`)
  process.exit(1)
}

if (!billing.subscriptionID) {
  console.error(`Error: Workspace ${workspaceID} does not have a subscription`)
  process.exit(1)
}

console.log(`  Customer ID: ${billing.customerID}`)
console.log(`  Subscription ID: ${billing.subscriptionID}`)

// Clear workspaceID from Stripe customer metadata
if (billing.customerID) {
  //await Billing.stripe().customers.update(billing.customerID, {
  //  metadata: {
  //    workspaceID: "",
  //  },
  //})
  //console.log(`Cleared workspaceID from Stripe customer metadata`)
}

await Database.transaction(async (tx) => {
  // Clear subscription-related fields from billing table
  await tx
    .update(BillingTable)
    .set({
      //      customerID: null,
      subscriptionID: null,
      subscriptionCouponID: null,
      //     paymentMethodID: null,
      //     paymentMethodLast4: null,
      //     paymentMethodType: null,
    })
    .where(eq(BillingTable.workspaceID, workspaceID))

  // Delete from subscription table
  await tx.delete(SubscriptionTable).where(eq(SubscriptionTable.workspaceID, workspaceID))

  // Delete from payments table
  await tx
    .delete(PaymentTable)
    .where(
      and(
        eq(PaymentTable.workspaceID, workspaceID),
        eq(PaymentTable.enrichment, { type: "subscription" }),
        eq(PaymentTable.amount, 20000000000),
      ),
    )
})

console.log(`Successfully removed subscription from workspace ${workspaceID}`)
