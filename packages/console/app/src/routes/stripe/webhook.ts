import { Billing } from "@opencode-ai/console-core/billing.js"
import type { APIEvent } from "@solidjs/start/server"
import { and, Database, eq, sql } from "@opencode-ai/console-core/drizzle/index.js"
import { BillingTable, LiteTable, PaymentTable } from "@opencode-ai/console-core/schema/billing.sql.js"
import { Identifier } from "@opencode-ai/console-core/identifier.js"
import { centsToMicroCents } from "@opencode-ai/console-core/util/price.js"
import { Actor } from "@opencode-ai/console-core/actor.js"
import { Resource } from "@opencode-ai/console-resource"
import { LiteData } from "@opencode-ai/console-core/lite.js"
import { BlackData } from "@opencode-ai/console-core/black.js"

export async function POST(input: APIEvent) {
  const body = await Billing.stripe().webhooks.constructEventAsync(
    await input.request.text(),
    input.request.headers.get("stripe-signature")!,
    Resource.STRIPE_WEBHOOK_SECRET.value,
  )
  console.log(body.type, JSON.stringify(body, null, 2))

  return (async () => {
    if (body.type === "customer.updated") {
      // check default payment method changed
      const prevInvoiceSettings = body.data.previous_attributes?.invoice_settings ?? {}
      if (!("default_payment_method" in prevInvoiceSettings)) return "ignored"

      const customerID = body.data.object.id
      const paymentMethodID = body.data.object.invoice_settings.default_payment_method as string

      if (!customerID) throw new Error("Customer ID not found")
      if (!paymentMethodID) throw new Error("Payment method ID not found")

      const paymentMethod = await Billing.stripe().paymentMethods.retrieve(paymentMethodID)
      await Database.use(async (tx) => {
        await tx
          .update(BillingTable)
          .set({
            paymentMethodID,
            paymentMethodLast4: paymentMethod.card?.last4 ?? null,
            paymentMethodType: paymentMethod.type,
          })
          .where(eq(BillingTable.customerID, customerID))
      })
    }
    if (body.type === "checkout.session.completed" && body.data.object.mode === "payment") {
      const workspaceID = body.data.object.metadata?.workspaceID
      const amountInCents = body.data.object.metadata?.amount && parseInt(body.data.object.metadata?.amount)
      const customerID = body.data.object.customer as string
      const paymentID = body.data.object.payment_intent as string
      const invoiceID = body.data.object.invoice as string

      if (!workspaceID) throw new Error("Workspace ID not found")
      if (!customerID) throw new Error("Customer ID not found")
      if (!amountInCents) throw new Error("Amount not found")
      if (!paymentID) throw new Error("Payment ID not found")
      if (!invoiceID) throw new Error("Invoice ID not found")

      await Actor.provide("system", { workspaceID }, async () => {
        const customer = await Billing.get()
        if (customer?.customerID && customer.customerID !== customerID) throw new Error("Customer ID mismatch")

        // set customer metadata
        if (!customer?.customerID) {
          await Billing.stripe().customers.update(customerID, {
            metadata: {
              workspaceID,
            },
          })
        }

        // get payment method for the payment intent
        const paymentIntent = await Billing.stripe().paymentIntents.retrieve(paymentID, {
          expand: ["payment_method"],
        })
        const paymentMethod = paymentIntent.payment_method
        if (!paymentMethod || typeof paymentMethod === "string") throw new Error("Payment method not expanded")

        await Database.transaction(async (tx) => {
          await tx
            .update(BillingTable)
            .set({
              balance: sql`${BillingTable.balance} + ${centsToMicroCents(amountInCents)}`,
              customerID,
              paymentMethodID: paymentMethod.id,
              paymentMethodLast4: paymentMethod.card?.last4 ?? null,
              paymentMethodType: paymentMethod.type,
              // enable reload if first time enabling billing
              ...(customer?.customerID
                ? {}
                : {
                    reloadError: null,
                    timeReloadError: null,
                  }),
            })
            .where(eq(BillingTable.workspaceID, workspaceID))
          await tx.insert(PaymentTable).values({
            workspaceID,
            id: Identifier.create("payment"),
            amount: centsToMicroCents(amountInCents),
            paymentID,
            invoiceID,
            customerID,
          })
        })
      })
    }
    if (body.type === "customer.subscription.created") {
      const type = body.data.object.metadata?.type
      if (type === "lite") {
        const workspaceID = body.data.object.metadata?.workspaceID
        const userID = body.data.object.metadata?.userID
        const customerID = body.data.object.customer as string
        const invoiceID = body.data.object.latest_invoice as string
        const subscriptionID = body.data.object.id as string

        if (!workspaceID) throw new Error("Workspace ID not found")
        if (!userID) throw new Error("User ID not found")
        if (!customerID) throw new Error("Customer ID not found")
        if (!invoiceID) throw new Error("Invoice ID not found")
        if (!subscriptionID) throw new Error("Subscription ID not found")

        // get payment id from invoice
        const invoice = await Billing.stripe().invoices.retrieve(invoiceID, {
          expand: ["payments"],
        })
        const paymentID = invoice.payments?.data[0].payment.payment_intent as string
        if (!paymentID) throw new Error("Payment ID not found")

        // get payment method for the payment intent
        const paymentIntent = await Billing.stripe().paymentIntents.retrieve(paymentID, {
          expand: ["payment_method"],
        })
        const paymentMethod = paymentIntent.payment_method
        if (!paymentMethod || typeof paymentMethod === "string") throw new Error("Payment method not expanded")

        await Actor.provide("system", { workspaceID }, async () => {
          // look up current billing
          const billing = await Billing.get()
          if (!billing) throw new Error(`Workspace with ID ${workspaceID} not found`)
          if (billing.customerID && billing.customerID !== customerID) throw new Error("Customer ID mismatch")

          // set customer metadata
          if (!billing?.customerID) {
            await Billing.stripe().customers.update(customerID, {
              metadata: {
                workspaceID,
              },
            })
          }

          await Database.transaction(async (tx) => {
            await tx
              .update(BillingTable)
              .set({
                customerID,
                liteSubscriptionID: subscriptionID,
                lite: {},
                paymentMethodID: paymentMethod.id,
                paymentMethodLast4: paymentMethod.card?.last4 ?? null,
                paymentMethodType: paymentMethod.type,
              })
              .where(eq(BillingTable.workspaceID, workspaceID))

            await tx.insert(LiteTable).values({
              workspaceID,
              id: Identifier.create("lite"),
              userID: userID,
            })
          })
        })
      }
    }
    if (body.type === "customer.subscription.updated" && body.data.object.status === "incomplete_expired") {
      const subscriptionID = body.data.object.id
      if (!subscriptionID) throw new Error("Subscription ID not found")

      const productID = body.data.object.items.data[0].price.product as string
      if (productID === LiteData.productID()) {
        await Billing.unsubscribeLite({ subscriptionID })
      } else if (productID === BlackData.productID()) {
        await Billing.unsubscribeBlack({ subscriptionID })
      }
    }
    if (body.type === "customer.subscription.deleted") {
      const subscriptionID = body.data.object.id
      if (!subscriptionID) throw new Error("Subscription ID not found")

      const productID = body.data.object.items.data[0].price.product as string
      if (productID === LiteData.productID()) {
        await Billing.unsubscribeLite({ subscriptionID })
      } else if (productID === BlackData.productID()) {
        await Billing.unsubscribeBlack({ subscriptionID })
      }
    }
    if (body.type === "invoice.payment_succeeded") {
      if (
        body.data.object.billing_reason === "subscription_create" ||
        body.data.object.billing_reason === "subscription_cycle"
      ) {
        const invoiceID = body.data.object.id as string
        const amountInCents = body.data.object.amount_paid
        const customerID = body.data.object.customer as string
        const subscriptionID = body.data.object.parent?.subscription_details?.subscription as string

        if (!customerID) throw new Error("Customer ID not found")
        if (!invoiceID) throw new Error("Invoice ID not found")
        if (!subscriptionID) throw new Error("Subscription ID not found")

        // get coupon id from subscription
        const subscriptionData = await Billing.stripe().subscriptions.retrieve(subscriptionID, {
          expand: ["discounts"],
        })
        const couponID =
          typeof subscriptionData.discounts[0] === "string"
            ? subscriptionData.discounts[0]
            : subscriptionData.discounts[0]?.coupon?.id
        const productID = subscriptionData.items.data[0].price.product as string

        // get payment id from invoice
        const invoice = await Billing.stripe().invoices.retrieve(invoiceID, {
          expand: ["payments"],
        })
        const paymentID = invoice.payments?.data[0].payment.payment_intent as string
        if (!paymentID) {
          // payment id can be undefined when using coupon
          if (!couponID) throw new Error("Payment ID not found")
        }

        const workspaceID = await Database.use((tx) =>
          tx
            .select({ workspaceID: BillingTable.workspaceID })
            .from(BillingTable)
            .where(eq(BillingTable.customerID, customerID))
            .then((rows) => rows[0]?.workspaceID),
        )
        if (!workspaceID) throw new Error("Workspace ID not found for customer")

        await Database.use((tx) =>
          tx.insert(PaymentTable).values({
            workspaceID,
            id: Identifier.create("payment"),
            amount: centsToMicroCents(amountInCents),
            paymentID,
            invoiceID,
            customerID,
            enrichment: {
              type: productID === LiteData.productID() ? "lite" : "subscription",
              couponID,
            },
          }),
        )
      } else if (body.data.object.billing_reason === "manual") {
        const workspaceID = body.data.object.metadata?.workspaceID
        const amountInCents = body.data.object.metadata?.amount && parseInt(body.data.object.metadata?.amount)
        const invoiceID = body.data.object.id as string
        const customerID = body.data.object.customer as string

        if (!workspaceID) throw new Error("Workspace ID not found")
        if (!customerID) throw new Error("Customer ID not found")
        if (!amountInCents) throw new Error("Amount not found")
        if (!invoiceID) throw new Error("Invoice ID not found")

        await Actor.provide("system", { workspaceID }, async () => {
          // get payment id from invoice
          const invoice = await Billing.stripe().invoices.retrieve(invoiceID, {
            expand: ["payments"],
          })
          await Database.transaction(async (tx) => {
            await tx
              .update(BillingTable)
              .set({
                balance: sql`${BillingTable.balance} + ${centsToMicroCents(amountInCents)}`,
                reloadError: null,
                timeReloadError: null,
              })
              .where(eq(BillingTable.workspaceID, Actor.workspace()))
            await tx.insert(PaymentTable).values({
              workspaceID: Actor.workspace(),
              id: Identifier.create("payment"),
              amount: centsToMicroCents(amountInCents),
              invoiceID,
              paymentID: invoice.payments?.data[0].payment.payment_intent as string,
              customerID,
            })
          })
        })
      }
    }
    if (body.type === "invoice.payment_failed" || body.type === "invoice.payment_action_required") {
      if (body.data.object.billing_reason === "manual") {
        const workspaceID = body.data.object.metadata?.workspaceID
        const invoiceID = body.data.object.id

        if (!workspaceID) throw new Error("Workspace ID not found")
        if (!invoiceID) throw new Error("Invoice ID not found")

        const paymentIntent = await Billing.stripe().paymentIntents.retrieve(invoiceID)
        console.log(JSON.stringify(paymentIntent))
        const errorMessage =
          typeof paymentIntent === "object" && paymentIntent !== null
            ? paymentIntent.last_payment_error?.message
            : undefined

        await Actor.provide("system", { workspaceID }, async () => {
          await Database.use((tx) =>
            tx
              .update(BillingTable)
              .set({
                reload: false,
                reloadError: errorMessage ?? "workspace.reload.error.paymentFailed",
                timeReloadError: sql`now()`,
              })
              .where(eq(BillingTable.workspaceID, Actor.workspace())),
          )
        })
      }
    }
    if (body.type === "charge.refunded") {
      const customerID = body.data.object.customer as string
      const paymentIntentID = body.data.object.payment_intent as string
      if (!customerID) throw new Error("Customer ID not found")
      if (!paymentIntentID) throw new Error("Payment ID not found")

      const workspaceID = await Database.use((tx) =>
        tx
          .select({
            workspaceID: BillingTable.workspaceID,
          })
          .from(BillingTable)
          .where(eq(BillingTable.customerID, customerID))
          .then((rows) => rows[0]?.workspaceID),
      )
      if (!workspaceID) throw new Error("Workspace ID not found")

      const amount = await Database.use((tx) =>
        tx
          .select({
            amount: PaymentTable.amount,
          })
          .from(PaymentTable)
          .where(and(eq(PaymentTable.paymentID, paymentIntentID), eq(PaymentTable.workspaceID, workspaceID)))
          .then((rows) => rows[0]?.amount),
      )
      if (!amount) throw new Error("Payment not found")

      await Database.transaction(async (tx) => {
        await tx
          .update(PaymentTable)
          .set({
            timeRefunded: new Date(body.created * 1000),
          })
          .where(and(eq(PaymentTable.paymentID, paymentIntentID), eq(PaymentTable.workspaceID, workspaceID)))

        await tx
          .update(BillingTable)
          .set({
            balance: sql`${BillingTable.balance} - ${amount}`,
          })
          .where(eq(BillingTable.workspaceID, workspaceID))
      })
    }
  })()
    .then((message) => {
      return Response.json({ message: message ?? "done" }, { status: 200 })
    })
    .catch((error: any) => {
      return Response.json({ message: error.message }, { status: 500 })
    })
}
