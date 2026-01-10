import { Billing } from "@opencode-ai/console-core/billing.js"
import type { APIEvent } from "@solidjs/start/server"
import { and, Database, eq, isNull, sql } from "@opencode-ai/console-core/drizzle/index.js"
import { BillingTable, PaymentTable, SubscriptionTable } from "@opencode-ai/console-core/schema/billing.sql.js"
import { Identifier } from "@opencode-ai/console-core/identifier.js"
import { centsToMicroCents } from "@opencode-ai/console-core/util/price.js"
import { Actor } from "@opencode-ai/console-core/actor.js"
import { Resource } from "@opencode-ai/console-resource"
import { UserTable } from "@opencode-ai/console-core/schema/user.sql.js"
import { AuthTable } from "@opencode-ai/console-core/schema/auth.sql.js"

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
                    reload: true,
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
    if (body.type === "checkout.session.completed" && body.data.object.mode === "subscription") {
      const workspaceID = body.data.object.custom_fields.find((f) => f.key === "workspaceid")?.text?.value
      const amountInCents = body.data.object.amount_total as number
      const customerID = body.data.object.customer as string
      const customerEmail = body.data.object.customer_details?.email as string
      const invoiceID = body.data.object.invoice as string
      const subscriptionID = body.data.object.subscription as string
      const promoCode = body.data.object.discounts?.[0]?.promotion_code as string

      if (!workspaceID) throw new Error("Workspace ID not found")
      if (!customerID) throw new Error("Customer ID not found")
      if (!amountInCents) throw new Error("Amount not found")
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

      // get coupon id from promotion code
      const couponID = await (async () => {
        if (!promoCode) return
        const coupon = await Billing.stripe().promotionCodes.retrieve(promoCode)
        const couponID = coupon.coupon.id
        if (!couponID) throw new Error("Coupon not found for promotion code")
        return couponID
      })()

      // get user

      await Actor.provide("system", { workspaceID }, async () => {
        // look up current billing
        const billing = await Billing.get()
        if (!billing) throw new Error(`Workspace with ID ${workspaceID} not found`)

        // Temporarily skip this check because during Black drop, user can checkout
        // as a new customer
        //if (billing.customerID !== customerID) throw new Error("Customer ID mismatch")

        // Temporarily check the user to apply to. After Black drop, we will allow
        // look up the user to apply to
        const users = await Database.use((tx) =>
          tx
            .select({ id: UserTable.id, email: AuthTable.subject })
            .from(UserTable)
            .innerJoin(AuthTable, and(eq(AuthTable.accountID, UserTable.accountID), eq(AuthTable.provider, "email")))
            .where(and(eq(UserTable.workspaceID, workspaceID), isNull(UserTable.timeDeleted))),
        )
        const user = users.find((u) => u.email === customerEmail) ?? users[0]
        if (!user) {
          console.error(`Error: User with email ${customerEmail} not found in workspace ${workspaceID}`)
          process.exit(1)
        }

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
              subscriptionID,
              subscriptionCouponID: couponID,
              paymentMethodID: paymentMethod.id,
              paymentMethodLast4: paymentMethod.card?.last4 ?? null,
              paymentMethodType: paymentMethod.type,
            })
            .where(eq(BillingTable.workspaceID, workspaceID))

          await tx.insert(SubscriptionTable).values({
            workspaceID,
            id: Identifier.create("subscription"),
            userID: user.id,
          })

          await tx.insert(PaymentTable).values({
            workspaceID,
            id: Identifier.create("payment"),
            amount: centsToMicroCents(amountInCents),
            paymentID,
            invoiceID,
            customerID,
            enrichment: {
              type: "subscription",
              couponID,
            },
          })
        })
      })
    }
    if (body.type === "customer.subscription.created") {
      const data = {
        id: "evt_1Smq802SrMQ2Fneksse5FMNV",
        object: "event",
        api_version: "2025-07-30.basil",
        created: 1767766916,
        data: {
          object: {
            id: "sub_1Smq7x2SrMQ2Fnek8F1yf3ZD",
            object: "subscription",
            application: null,
            application_fee_percent: null,
            automatic_tax: {
              disabled_reason: null,
              enabled: false,
              liability: null,
            },
            billing_cycle_anchor: 1770445200,
            billing_cycle_anchor_config: null,
            billing_mode: {
              flexible: {
                proration_discounts: "included",
              },
              type: "flexible",
              updated_at: 1770445200,
            },
            billing_thresholds: null,
            cancel_at: null,
            cancel_at_period_end: false,
            canceled_at: null,
            cancellation_details: {
              comment: null,
              feedback: null,
              reason: null,
            },
            collection_method: "charge_automatically",
            created: 1770445200,
            currency: "usd",
            customer: "cus_TkKmZZvysJ2wej",
            customer_account: null,
            days_until_due: null,
            default_payment_method: null,
            default_source: "card_1Smq7u2SrMQ2FneknjyOa7sq",
            default_tax_rates: [],
            description: null,
            discounts: [],
            ended_at: null,
            invoice_settings: {
              account_tax_ids: null,
              issuer: {
                type: "self",
              },
            },
            items: {
              object: "list",
              data: [
                {
                  id: "si_TkKnBKXFX76t0O",
                  object: "subscription_item",
                  billing_thresholds: null,
                  created: 1770445200,
                  current_period_end: 1772864400,
                  current_period_start: 1770445200,
                  discounts: [],
                  metadata: {},
                  plan: {
                    id: "price_1SmfFG2SrMQ2FnekJuzwHMea",
                    object: "plan",
                    active: true,
                    amount: 20000,
                    amount_decimal: "20000",
                    billing_scheme: "per_unit",
                    created: 1767725082,
                    currency: "usd",
                    interval: "month",
                    interval_count: 1,
                    livemode: false,
                    metadata: {},
                    meter: null,
                    nickname: null,
                    product: "prod_Tk9LjWT1n0DgYm",
                    tiers_mode: null,
                    transform_usage: null,
                    trial_period_days: null,
                    usage_type: "licensed",
                  },
                  price: {
                    id: "price_1SmfFG2SrMQ2FnekJuzwHMea",
                    object: "price",
                    active: true,
                    billing_scheme: "per_unit",
                    created: 1767725082,
                    currency: "usd",
                    custom_unit_amount: null,
                    livemode: false,
                    lookup_key: null,
                    metadata: {},
                    nickname: null,
                    product: "prod_Tk9LjWT1n0DgYm",
                    recurring: {
                      interval: "month",
                      interval_count: 1,
                      meter: null,
                      trial_period_days: null,
                      usage_type: "licensed",
                    },
                    tax_behavior: "unspecified",
                    tiers_mode: null,
                    transform_quantity: null,
                    type: "recurring",
                    unit_amount: 20000,
                    unit_amount_decimal: "20000",
                  },
                  quantity: 1,
                  subscription: "sub_1Smq7x2SrMQ2Fnek8F1yf3ZD",
                  tax_rates: [],
                },
              ],
              has_more: false,
              total_count: 1,
              url: "/v1/subscription_items?subscription=sub_1Smq7x2SrMQ2Fnek8F1yf3ZD",
            },
            latest_invoice: "in_1Smq7x2SrMQ2FnekSJesfPwE",
            livemode: false,
            metadata: {},
            next_pending_invoice_item_invoice: null,
            on_behalf_of: null,
            pause_collection: null,
            payment_settings: {
              payment_method_options: null,
              payment_method_types: null,
              save_default_payment_method: "off",
            },
            pending_invoice_item_interval: null,
            pending_setup_intent: null,
            pending_update: null,
            plan: {
              id: "price_1SmfFG2SrMQ2FnekJuzwHMea",
              object: "plan",
              active: true,
              amount: 20000,
              amount_decimal: "20000",
              billing_scheme: "per_unit",
              created: 1767725082,
              currency: "usd",
              interval: "month",
              interval_count: 1,
              livemode: false,
              metadata: {},
              meter: null,
              nickname: null,
              product: "prod_Tk9LjWT1n0DgYm",
              tiers_mode: null,
              transform_usage: null,
              trial_period_days: null,
              usage_type: "licensed",
            },
            quantity: 1,
            schedule: null,
            start_date: 1770445200,
            status: "active",
            test_clock: "clock_1Smq6n2SrMQ2FnekQw4yt2PZ",
            transfer_data: null,
            trial_end: null,
            trial_settings: {
              end_behavior: {
                missing_payment_method: "create_invoice",
              },
            },
            trial_start: null,
          },
        },
        livemode: false,
        pending_webhooks: 0,
        request: {
          id: "req_6YO9stvB155WJD",
          idempotency_key: "581ba059-6f86-49b2-9c49-0d8450255322",
        },
        type: "customer.subscription.created",
      }
    }
    if (body.type === "customer.subscription.deleted") {
      const subscriptionID = body.data.object.id
      if (!subscriptionID) throw new Error("Subscription ID not found")

      const workspaceID = await Database.use((tx) =>
        tx
          .select({ workspaceID: BillingTable.workspaceID })
          .from(BillingTable)
          .where(eq(BillingTable.subscriptionID, subscriptionID))
          .then((rows) => rows[0]?.workspaceID),
      )
      if (!workspaceID) throw new Error("Workspace ID not found for subscription")

      await Database.transaction(async (tx) => {
        await tx
          .update(BillingTable)
          .set({ subscriptionID: null, subscriptionCouponID: null })
          .where(eq(BillingTable.workspaceID, workspaceID))

        await tx.delete(SubscriptionTable).where(eq(SubscriptionTable.workspaceID, workspaceID))
      })
    }
    if (body.type === "invoice.payment_succeeded") {
      if (body.data.object.billing_reason === "subscription_cycle") {
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
              type: "subscription",
              couponID,
            },
          }),
        )
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
