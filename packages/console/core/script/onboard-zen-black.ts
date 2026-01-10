import { Billing } from "../src/billing.js"
import { and, Database, eq, isNull, sql } from "../src/drizzle/index.js"
import { UserTable } from "../src/schema/user.sql.js"
import { BillingTable, PaymentTable, SubscriptionTable } from "../src/schema/billing.sql.js"
import { Identifier } from "../src/identifier.js"
import { centsToMicroCents } from "../src/util/price.js"
import { AuthTable } from "../src/schema/auth.sql.js"

const workspaceID = process.argv[2]
const email = process.argv[3]

console.log(`Onboarding workspace ${workspaceID} for email ${email}`)

if (!workspaceID || !email) {
  console.error("Usage: bun onboard-zen-black.ts <workspaceID> <email>")
  process.exit(1)
}

// Look up the Stripe customer by email
const customers = await Billing.stripe().customers.list({ email, limit: 10, expand: ["data.subscriptions"] })
if (!customers.data) {
  console.error(`Error: No Stripe customer found for email ${email}`)
  process.exit(1)
}
const customer = customers.data.find((c) => c.subscriptions?.data[0]?.items.data[0]?.price.unit_amount === 20000)
if (!customer) {
  console.error(`Error: No Stripe customer found for email ${email} with $200 subscription`)
  process.exit(1)
}

const customerID = customer.id
const subscription = customer.subscriptions!.data[0]
const subscriptionID = subscription.id

// Validate the subscription is $200
const amountInCents = subscription.items.data[0]?.price.unit_amount ?? 0
if (amountInCents !== 20000) {
  console.error(`Error: Subscription amount is $${amountInCents / 100}, expected $200`)
  process.exit(1)
}

const subscriptionData = await Billing.stripe().subscriptions.retrieve(subscription.id, { expand: ["discounts"] })
const couponID =
  typeof subscriptionData.discounts[0] === "string"
    ? subscriptionData.discounts[0]
    : subscriptionData.discounts[0]?.coupon?.id

// Check if subscription is already tied to another workspace
const existingSubscription = await Database.use((tx) =>
  tx
    .select({ workspaceID: BillingTable.workspaceID })
    .from(BillingTable)
    .where(eq(BillingTable.subscriptionID, subscriptionID))
    .then((rows) => rows[0]),
)
if (existingSubscription) {
  console.error(
    `Error: Subscription ${subscriptionID} is already tied to workspace ${existingSubscription.workspaceID}`,
  )
  process.exit(1)
}

// Look up the workspace billing and check if it already has a customer id or subscription
const billing = await Database.use((tx) =>
  tx
    .select({ customerID: BillingTable.customerID, subscriptionID: BillingTable.subscriptionID })
    .from(BillingTable)
    .where(eq(BillingTable.workspaceID, workspaceID))
    .then((rows) => rows[0]),
)
if (billing?.subscriptionID) {
  console.error(`Error: Workspace ${workspaceID} already has a subscription: ${billing.subscriptionID}`)
  process.exit(1)
}
if (billing?.customerID) {
  console.warn(
    `Warning: Workspace ${workspaceID} already has a customer id: ${billing.customerID}, replacing with ${customerID}`,
  )
}

// Get the latest invoice and payment from the subscription
const invoices = await Billing.stripe().invoices.list({
  subscription: subscriptionID,
  limit: 1,
  expand: ["data.payments"],
})
const invoice = invoices.data[0]
const invoiceID = invoice?.id
const paymentID = invoice?.payments?.data[0]?.payment.payment_intent as string | undefined

// Get the default payment method from the customer
const paymentMethodID = (customer.invoice_settings.default_payment_method ?? subscription.default_payment_method) as
  | string
  | null
const paymentMethod = paymentMethodID ? await Billing.stripe().paymentMethods.retrieve(paymentMethodID) : null
const paymentMethodLast4 = paymentMethod?.card?.last4 ?? null
const paymentMethodType = paymentMethod?.type ?? null

// Look up the user in the workspace
const users = await Database.use((tx) =>
  tx
    .select({ id: UserTable.id, email: AuthTable.subject })
    .from(UserTable)
    .innerJoin(AuthTable, and(eq(AuthTable.accountID, UserTable.accountID), eq(AuthTable.provider, "email")))
    .where(and(eq(UserTable.workspaceID, workspaceID), isNull(UserTable.timeDeleted))),
)
if (users.length === 0) {
  console.error(`Error: No users found in workspace ${workspaceID}`)
  process.exit(1)
}
const user = users.length === 1 ? users[0] : users.find((u) => u.email === email)
if (!user) {
  console.error(`Error: User with email ${email} not found in workspace ${workspaceID}`)
  process.exit(1)
}

// Set workspaceID in Stripe customer metadata
await Billing.stripe().customers.update(customerID, {
  metadata: {
    workspaceID,
  },
})

await Database.transaction(async (tx) => {
  // Set customer id, subscription id, and payment method on workspace billing
  await tx
    .update(BillingTable)
    .set({
      customerID,
      subscriptionID,
      subscriptionCouponID: couponID,
      paymentMethodID,
      paymentMethodLast4,
      paymentMethodType,
    })
    .where(eq(BillingTable.workspaceID, workspaceID))

  // Create a row in subscription table
  await tx.insert(SubscriptionTable).values({
    workspaceID,
    id: Identifier.create("subscription"),
    userID: user.id,
  })

  // Create a row in payments table
  await tx.insert(PaymentTable).values({
    workspaceID,
    id: Identifier.create("payment"),
    amount: centsToMicroCents(amountInCents),
    customerID,
    invoiceID,
    paymentID,
    enrichment: {
      type: "subscription",
      couponID,
    },
  })
})

console.log(`Successfully onboarded workspace ${workspaceID}`)
console.log(`  Customer ID: ${customerID}`)
console.log(`  Subscription ID: ${subscriptionID}`)
console.log(
  `  Payment Method: ${paymentMethodID ?? "(none)"} (${paymentMethodType ?? "unknown"} ending in ${paymentMethodLast4 ?? "????"})`,
)
console.log(`  User ID: ${user.id}`)
console.log(`  Invoice ID: ${invoiceID ?? "(none)"}`)
console.log(`  Payment ID: ${paymentID ?? "(none)"}`)
