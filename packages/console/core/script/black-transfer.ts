import { Billing } from "../src/billing.js"
import { and, Database, desc, eq, isNotNull, lt, sql } from "../src/drizzle/index.js"
import { BillingTable, PaymentTable, SubscriptionTable } from "../src/schema/billing.sql.js"

const fromWrkID = process.argv[2]
const toWrkID = process.argv[3]

if (!fromWrkID || !toWrkID) {
  console.error("Usage: bun foo.ts <fromWrkID> <toWrkID>")
  process.exit(1)
}

console.log(`Transferring subscription from ${fromWrkID} to ${toWrkID}`)

// Look up the FROM workspace billing
const fromBilling = await Database.use((tx) =>
  tx
    .select({
      customerID: BillingTable.customerID,
      subscriptionID: BillingTable.subscriptionID,
      subscriptionCouponID: BillingTable.subscriptionCouponID,
      paymentMethodID: BillingTable.paymentMethodID,
      paymentMethodType: BillingTable.paymentMethodType,
      paymentMethodLast4: BillingTable.paymentMethodLast4,
    })
    .from(BillingTable)
    .where(eq(BillingTable.workspaceID, fromWrkID))
    .then((rows) => rows[0]),
)
if (!fromBilling) throw new Error(`Error: FROM workspace has no billing record`)
if (!fromBilling.customerID) throw new Error(`Error: FROM workspace has no Stripe customer ID`)
if (!fromBilling.subscriptionID) throw new Error(`Error: FROM workspace has no subscription`)

const fromSubscription = await Database.use((tx) =>
  tx
    .select({ userID: SubscriptionTable.userID })
    .from(SubscriptionTable)
    .where(eq(SubscriptionTable.workspaceID, fromWrkID))
    .then((rows) => rows[0]),
)
if (!fromSubscription) throw new Error(`Error: FROM workspace has no subscription`)

// Look up the previous customer ID in FROM workspace
const subscriptionPayment = await Database.use((tx) =>
  tx
    .select({
      customerID: PaymentTable.customerID,
      timeCreated: PaymentTable.timeCreated,
    })
    .from(PaymentTable)
    .where(and(eq(PaymentTable.workspaceID, fromWrkID), sql`JSON_EXTRACT(enrichment, '$.type') = 'subscription'`))
    .then((rows) => {
      if (rows.length > 1) {
        console.error(`Error: Multiple subscription payments found for workspace ${fromWrkID}`)
        process.exit(1)
      }
      return rows[0]
    }),
)
const fromPrevPayment = await Database.use((tx) =>
  tx
    .select({ customerID: PaymentTable.customerID })
    .from(PaymentTable)
    .where(
      and(
        eq(PaymentTable.workspaceID, fromWrkID),
        isNotNull(PaymentTable.customerID),
        lt(PaymentTable.timeCreated, subscriptionPayment.timeCreated),
      ),
    )
    .orderBy(desc(PaymentTable.timeCreated))
    .limit(1)
    .then((rows) => rows[0]),
)
if (!fromPrevPayment?.customerID) throw new Error(`Error: FROM workspace has no previous Stripe customer to revert to`)
if (fromPrevPayment.customerID === fromBilling.customerID)
  throw new Error(`Error: FROM workspace has the same Stripe customer ID as the current one`)

const fromPrevPaymentMethods = await Billing.stripe().customers.listPaymentMethods(fromPrevPayment.customerID, {})
if (fromPrevPaymentMethods.data.length === 0)
  throw new Error(`Error: FROM workspace has no previous Stripe payment methods`)

// Look up the TO workspace billing
const toBilling = await Database.use((tx) =>
  tx
    .select({
      customerID: BillingTable.customerID,
      subscriptionID: BillingTable.subscriptionID,
    })
    .from(BillingTable)
    .where(eq(BillingTable.workspaceID, toWrkID))
    .then((rows) => rows[0]),
)
if (!toBilling) throw new Error(`Error: TO workspace has no billing record`)
if (toBilling.subscriptionID) throw new Error(`Error: TO workspace already has a subscription`)

console.log(`FROM:`)
console.log(`  Old Customer ID: ${fromBilling.customerID}`)
console.log(`  New Customer ID: ${fromPrevPayment.customerID}`)
console.log(`TO:`)
console.log(`  Old Customer ID: ${toBilling.customerID}`)
console.log(`  New Customer ID: ${fromBilling.customerID}`)

// Clear workspaceID from Stripe customer metadata
await Billing.stripe().customers.update(fromPrevPayment.customerID, {
  metadata: {
    workspaceID: fromWrkID,
  },
})
await Billing.stripe().customers.update(fromBilling.customerID, {
  metadata: {
    workspaceID: toWrkID,
  },
})

await Database.transaction(async (tx) => {
  await tx
    .update(BillingTable)
    .set({
      customerID: fromPrevPayment.customerID,
      subscriptionID: null,
      subscriptionCouponID: null,
      paymentMethodID: fromPrevPaymentMethods.data[0].id,
      paymentMethodLast4: fromPrevPaymentMethods.data[0].card?.last4 ?? null,
      paymentMethodType: fromPrevPaymentMethods.data[0].type,
    })
    .where(eq(BillingTable.workspaceID, fromWrkID))

  await tx
    .update(BillingTable)
    .set({
      customerID: fromBilling.customerID,
      subscriptionID: fromBilling.subscriptionID,
      subscriptionCouponID: fromBilling.subscriptionCouponID,
      paymentMethodID: fromBilling.paymentMethodID,
      paymentMethodLast4: fromBilling.paymentMethodLast4,
      paymentMethodType: fromBilling.paymentMethodType,
    })
    .where(eq(BillingTable.workspaceID, toWrkID))

  await tx
    .update(SubscriptionTable)
    .set({
      workspaceID: toWrkID,
      userID: fromSubscription.userID,
    })
    .where(eq(SubscriptionTable.workspaceID, fromWrkID))

  await tx
    .update(PaymentTable)
    .set({
      workspaceID: toWrkID,
    })
    .where(
      and(
        eq(PaymentTable.workspaceID, fromWrkID),
        sql`JSON_EXTRACT(enrichment, '$.type') = 'subscription'`,
        eq(PaymentTable.amount, 20000000000),
      ),
    )
})

console.log(`done`)
