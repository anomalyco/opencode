import { Stripe } from "stripe"
import { Database, eq, sql } from "./drizzle"
import { BillingTable, PaymentTable, UsageTable } from "./schema/billing.sql"
import { Actor } from "./actor"
import { fn } from "./util/fn"
import { z } from "zod"
import { Resource } from "@opencode-ai/console-resource"
import { Identifier } from "./identifier"
import { centsToMicroCents } from "./util/price"
import { User } from "./user"

export namespace Billing {
  export const ITEM_CREDIT_NAME = "opencode credits"
  export const ITEM_FEE_NAME = "processing fee"
  export const RELOAD_AMOUNT = 20
  export const RELOAD_AMOUNT_MIN = 10
  export const RELOAD_TRIGGER = 5
  export const RELOAD_TRIGGER_MIN = 5
  export const stripe = () =>
    new Stripe(Resource.STRIPE_SECRET_KEY.value, {
      apiVersion: "2025-03-31.basil",
      httpClient: Stripe.createFetchHttpClient(),
    })

  export const get = async () => {
    return Database.use(async (tx) =>
      tx
        .select({
          customerID: BillingTable.customerID,
          subscriptionID: BillingTable.subscriptionID,
          paymentMethodID: BillingTable.paymentMethodID,
          paymentMethodType: BillingTable.paymentMethodType,
          paymentMethodLast4: BillingTable.paymentMethodLast4,
          balance: BillingTable.balance,
          reload: BillingTable.reload,
          reloadAmount: BillingTable.reloadAmount,
          reloadTrigger: BillingTable.reloadTrigger,
          monthlyLimit: BillingTable.monthlyLimit,
          monthlyUsage: BillingTable.monthlyUsage,
          timeMonthlyUsageUpdated: BillingTable.timeMonthlyUsageUpdated,
          reloadError: BillingTable.reloadError,
          timeReloadError: BillingTable.timeReloadError,
        })
        .from(BillingTable)
        .where(eq(BillingTable.workspaceID, Actor.workspace()))
        .then((r) => r[0]),
    )
  }

  export const payments = async () => {
    return await Database.use((tx) =>
      tx
        .select()
        .from(PaymentTable)
        .where(eq(PaymentTable.workspaceID, Actor.workspace()))
        .orderBy(sql`${PaymentTable.timeCreated} DESC`)
        .limit(100),
    )
  }

  export const usages = async (page = 0, pageSize = 50) => {
    return await Database.use((tx) =>
      tx
        .select()
        .from(UsageTable)
        .where(eq(UsageTable.workspaceID, Actor.workspace()))
        .orderBy(sql`${UsageTable.timeCreated} DESC`)
        .limit(pageSize)
        .offset(page * pageSize),
    )
  }

  export const calculateFeeInCents = (x: number) => {
    // math: x = total - (total * 0.044 + 0.30)
    // math: x = total * (1-0.044) - 0.30
    // math: (x + 0.30) / 0.956 = total
    return Math.round(((x + 30) / 0.956) * 0.044 + 30)
  }

  export const reload = async () => {
    const billing = await Database.use((tx) =>
      tx
        .select({
          customerID: BillingTable.customerID,
          paymentMethodID: BillingTable.paymentMethodID,
          reloadAmount: BillingTable.reloadAmount,
        })
        .from(BillingTable)
        .where(eq(BillingTable.workspaceID, Actor.workspace()))
        .then((rows) => rows[0]),
    )
    const customerID = billing.customerID
    const paymentMethodID = billing.paymentMethodID
    const amountInCents = (billing.reloadAmount ?? Billing.RELOAD_AMOUNT) * 100
    const paymentID = Identifier.create("payment")
    let invoice
    try {
      const draft = await Billing.stripe().invoices.create({
        customer: customerID!,
        auto_advance: false,
        default_payment_method: paymentMethodID!,
        collection_method: "charge_automatically",
        currency: "usd",
      })
      await Billing.stripe().invoiceItems.create({
        amount: amountInCents,
        currency: "usd",
        customer: customerID!,
        invoice: draft.id!,
        description: ITEM_CREDIT_NAME,
      })
      await Billing.stripe().invoiceItems.create({
        amount: calculateFeeInCents(amountInCents),
        currency: "usd",
        customer: customerID!,
        invoice: draft.id!,
        description: ITEM_FEE_NAME,
      })
      await Billing.stripe().invoices.finalizeInvoice(draft.id!)
      invoice = await Billing.stripe().invoices.pay(draft.id!, {
        off_session: true,
        payment_method: paymentMethodID!,
        expand: ["payments"],
      })
      if (invoice.status !== "paid" || invoice.payments?.data.length !== 1)
        throw new Error(invoice.last_finalization_error?.message)
    } catch (e: any) {
      console.error(e)
      await Database.use((tx) =>
        tx
          .update(BillingTable)
          .set({
            reloadError: e.message ?? "Payment failed.",
            timeReloadError: sql`now()`,
          })
          .where(eq(BillingTable.workspaceID, Actor.workspace())),
      )
      return
    }

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
        id: paymentID,
        amount: centsToMicroCents(amountInCents),
        invoiceID: invoice.id!,
        paymentID: invoice.payments?.data[0].payment.payment_intent as string,
        customerID,
      })
    })
  }

  export const grantCredit = async (workspaceID: string, dollarAmount: number) => {
    const amountInMicroCents = centsToMicroCents(dollarAmount * 100)
    await Database.transaction(async (tx) => {
      await tx
        .update(BillingTable)
        .set({
          balance: sql`${BillingTable.balance} + ${amountInMicroCents}`,
        })
        .where(eq(BillingTable.workspaceID, workspaceID))
      await tx.insert(PaymentTable).values({
        workspaceID,
        id: Identifier.create("payment"),
        amount: amountInMicroCents,
        enrichment: {
          type: "credit",
        },
      })
    })
    return amountInMicroCents
  }

  export const setMonthlyLimit = fn(z.number(), async (input) => {
    return await Database.use((tx) =>
      tx
        .update(BillingTable)
        .set({
          monthlyLimit: input,
        })
        .where(eq(BillingTable.workspaceID, Actor.workspace())),
    )
  })

  export const generateCheckoutUrl = fn(
    z.object({
      successUrl: z.string(),
      cancelUrl: z.string(),
      amount: z.number().optional(),
    }),
    async (input) => {
      const user = Actor.assert("user")
      const { successUrl, cancelUrl, amount } = input

      if (amount !== undefined && amount < Billing.RELOAD_AMOUNT_MIN) {
        throw new Error(`Amount must be at least $${Billing.RELOAD_AMOUNT_MIN}`)
      }

      const email = await User.getAuthEmail(user.properties.userID)
      const customer = await Billing.get()
      const amountInCents = (amount ?? customer.reloadAmount ?? Billing.RELOAD_AMOUNT) * 100
      const session = await Billing.stripe().checkout.sessions.create({
        mode: "payment",
        billing_address_collection: "required",
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: { name: ITEM_CREDIT_NAME },
              unit_amount: amountInCents,
            },
            quantity: 1,
          },
          {
            price_data: {
              currency: "usd",
              product_data: { name: ITEM_FEE_NAME },
              unit_amount: calculateFeeInCents(amountInCents),
            },
            quantity: 1,
          },
        ],
        ...(customer.customerID
          ? {
              customer: customer.customerID,
              customer_update: {
                name: "auto",
              },
            }
          : {
              customer_email: email!,
              customer_creation: "always",
            }),
        currency: "usd",
        invoice_creation: {
          enabled: true,
        },
        payment_intent_data: {
          setup_future_usage: "on_session",
        },
        payment_method_types: ["card"],
        payment_method_data: {
          allow_redisplay: "always",
        },
        tax_id_collection: {
          enabled: true,
        },
        metadata: {
          workspaceID: Actor.workspace(),
          amount: amountInCents.toString(),
        },
        success_url: successUrl,
        cancel_url: cancelUrl,
      })

      return session.url
    },
  )

  export const generateSessionUrl = fn(
    z.object({
      returnUrl: z.string(),
    }),
    async (input) => {
      const { returnUrl } = input

      const customer = await Billing.get()
      if (!customer?.customerID) {
        throw new Error("No stripe customer ID")
      }

      const session = await Billing.stripe().billingPortal.sessions.create({
        customer: customer.customerID,
        return_url: returnUrl,
      })

      return session.url
    },
  )

  export const generateReceiptUrl = fn(
    z.object({
      paymentID: z.string(),
    }),
    async (input) => {
      const { paymentID } = input

      const intent = await Billing.stripe().paymentIntents.retrieve(paymentID)
      if (!intent.latest_charge) throw new Error("No charge found")

      const charge = await Billing.stripe().charges.retrieve(intent.latest_charge as string)
      if (!charge.receipt_url) throw new Error("No receipt URL found")

      return charge.receipt_url
    },
  )
}
