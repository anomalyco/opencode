import { Billing } from "../src/billing.js"
import { Database, eq, and, sql } from "../src/drizzle/index.js"
import { AuthTable } from "../src/schema/auth.sql.js"
import { UserTable } from "../src/schema/user.sql.js"
import { BillingTable, PaymentTable } from "../src/schema/billing.sql.js"
import { Identifier } from "../src/identifier.js"
import { centsToMicroCents } from "../src/util/price.js"

const workspaceID = process.argv[2]
const email = process.argv[3]

if (!workspaceID || !email) {
  console.error("Usage: bun onboard-zen-black.ts <workspaceID> <email>")
  process.exit(1)
}

// Look up the Stripe customer by email
const customers = await Billing.stripe().customers.list({ email, limit: 1 })
const customer = customers.data[0]
if (!customer) {
  console.error(`Error: No Stripe customer found for email ${email}`)
  process.exit(1)
}
const customerID = customer.id

// Get the subscription id
const subscriptions = await Billing.stripe().subscriptions.list({ customer: customerID, limit: 1 })
const subscription = subscriptions.data[0]
if (!subscription) {
  console.error(`Error: Customer ${customerID} does not have a subscription`)
  process.exit(1)
}
const subscriptionID = subscription.id

// Validate the subscription is $200
const amountInCents = subscription.items.data[0]?.price.unit_amount ?? 0
if (amountInCents !== 20000) {
  console.error(`Error: Subscription amount is $${amountInCents / 100}, expected $200`)
  process.exit(1)
}

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

// Look up the user by email via AuthTable
const auth = await Database.use((tx) =>
  tx
    .select({ accountID: AuthTable.accountID })
    .from(AuthTable)
    .where(and(eq(AuthTable.provider, "email"), eq(AuthTable.subject, email)))
    .then((rows) => rows[0]),
)
if (!auth) {
  console.error(`Error: No user found with email ${email}`)
  process.exit(1)
}

// Look up the user in the workspace
const user = await Database.use((tx) =>
  tx
    .select({ id: UserTable.id })
    .from(UserTable)
    .where(and(eq(UserTable.workspaceID, workspaceID), eq(UserTable.accountID, auth.accountID)))
    .then((rows) => rows[0]),
)
if (!user) {
  console.error(`Error: User with email ${email} is not a member of workspace ${workspaceID}`)
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
      paymentMethodID,
      paymentMethodLast4,
      paymentMethodType,
    })
    .where(eq(BillingTable.workspaceID, workspaceID))

  // Set current time as timeSubscribed on user
  await tx
    .update(UserTable)
    .set({
      timeSubscribed: sql`now()`,
    })
    .where(eq(UserTable.id, user.id))

  // Create a row in payments table
  await tx.insert(PaymentTable).values({
    workspaceID,
    id: Identifier.create("payment"),
    amount: centsToMicroCents(amountInCents),
    customerID,
    invoiceID,
    paymentID,
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
