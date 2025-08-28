import { Resource } from "sst"
import { Billing } from "@opencode/cloud-core/billing.js"
import type { APIEvent } from "@solidjs/start/server"
import { Database, eq, sql } from "@opencode/cloud-core/drizzle/index.js"
import { BillingTable, PaymentTable } from "@opencode/cloud-core/schema/billing.sql.js"
import { Identifier } from "@opencode/cloud-core/identifier.js"
import { centsToMicroCents } from "@opencode/cloud-core/util/price.js"
import { Actor } from "@opencode/cloud-core/actor.js"

export async function POST(input: APIEvent) {
  const body = await Billing.stripe().webhooks.constructEventAsync(
    await input.request.text(),
    input.request.headers.get("stripe-signature")!,
    Resource.STRIPE_WEBHOOK_SECRET.value,
  )

  console.log(body.type, JSON.stringify(body, null, 2))
  if (body.type === "checkout.session.completed") {
    const workspaceID = body.data.object.metadata?.workspaceID
    const customerID = body.data.object.customer as string
    const paymentID = body.data.object.payment_intent as string
    const amount = body.data.object.amount_total

    if (!workspaceID) throw new Error("Workspace ID not found")
    if (!customerID) throw new Error("Customer ID not found")
    if (!amount) throw new Error("Amount not found")
    if (!paymentID) throw new Error("Payment ID not found")

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
            balance: sql`${BillingTable.balance} + ${centsToMicroCents(amount)}`,
            customerID,
            paymentMethodID: paymentMethod.id,
            paymentMethodLast4: paymentMethod.card!.last4,
          })
          .where(eq(BillingTable.workspaceID, workspaceID))
        await tx.insert(PaymentTable).values({
          workspaceID,
          id: Identifier.create("payment"),
          amount: centsToMicroCents(amount),
          paymentID,
          customerID,
        })
      })
    })
  }

  console.log("finished handling")

  return Response.json("ok", { status: 200 })
}
