import { Stripe } from "stripe"
import { Database, eq, sql } from "./drizzle"
import { BillingTable, PaymentTable, UsageTable } from "./schema/billing.sql"
import { Actor } from "./actor"
import { fn } from "./util/fn"
import { z } from "zod"
import { User } from "./user"
import { Resource } from "@opencode/console-resource"
import { Identifier } from "./identifier"
import { centsToMicroCents } from "./util/price"

export namespace Billing {
  export const CHARGE_NAME = "opencode credits"
  export const CHARGE_FEE_NAME = "processing fee"
  export const CHARGE_AMOUNT = 2000 // $20
  export const CHARGE_FEE = 123 // Stripe fee 4.4% + $0.30
  export const CHARGE_THRESHOLD = 500 // $5
  export const stripe = () =>
    new Stripe(Resource.STRIPE_SECRET_KEY.value, {
      apiVersion: "2025-03-31.basil",
    })

  export const get = async () => {
    return Database.use(async (tx) =>
      tx
        .select({
          customerID: BillingTable.customerID,
          paymentMethodID: BillingTable.paymentMethodID,
          paymentMethodLast4: BillingTable.paymentMethodLast4,
          balance: BillingTable.balance,
          reload: BillingTable.reload,
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

  export const usages = async () => {
    return await Database.use((tx) =>
      tx
        .select()
        .from(UsageTable)
        .where(eq(UsageTable.workspaceID, Actor.workspace()))
        .orderBy(sql`${UsageTable.timeCreated} DESC`)
        .limit(100),
    )
  }

  export const reload = async () => {
    const { customerID, paymentMethodID } = await Database.use((tx) =>
      tx
        .select({
          customerID: BillingTable.customerID,
          paymentMethodID: BillingTable.paymentMethodID,
        })
        .from(BillingTable)
        .where(eq(BillingTable.workspaceID, Actor.workspace()))
        .then((rows) => rows[0]),
    )
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
        amount: Billing.CHARGE_AMOUNT,
        currency: "usd",
        customer: customerID!,
        description: CHARGE_NAME,
        invoice: draft.id!,
      })
      await Billing.stripe().invoiceItems.create({
        amount: Billing.CHARGE_FEE,
        currency: "usd",
        customer: customerID!,
        description: CHARGE_FEE_NAME,
        invoice: draft.id!,
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
          balance: sql`${BillingTable.balance} + ${centsToMicroCents(CHARGE_AMOUNT)}`,
          reloadError: null,
          timeReloadError: null,
        })
        .where(eq(BillingTable.workspaceID, Actor.workspace()))
      await tx.insert(PaymentTable).values({
        workspaceID: Actor.workspace(),
        id: paymentID,
        amount: centsToMicroCents(CHARGE_AMOUNT),
        invoiceID: invoice.id!,
        paymentID: invoice.payments?.data[0].payment.payment_intent as string,
        customerID,
      })
    })
  }

  export const disableReload = async () => {
    return await Database.use((tx) =>
      tx
        .update(BillingTable)
        .set({
          reload: false,
        })
        .where(eq(BillingTable.workspaceID, Actor.workspace())),
    )
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
    }),
    async (input) => {
      const account = Actor.assert("user")
      const { successUrl, cancelUrl } = input

      const user = await User.fromID(account.properties.userID)
      const customer = await Billing.get()
      const session = await Billing.stripe().checkout.sessions.create({
        mode: "payment",
        billing_address_collection: "required",
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: CHARGE_NAME,
              },
              unit_amount: CHARGE_AMOUNT,
            },
            quantity: 1,
          },
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: CHARGE_FEE_NAME,
              },
              unit_amount: CHARGE_FEE,
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
              customer_email: user.email!,
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
