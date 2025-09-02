import { Stripe } from "stripe"
import { Database, eq, sql } from "./drizzle"
import { BillingTable, PaymentTable, UsageTable } from "./schema/billing.sql"
import { Actor } from "./actor"
import { fn } from "./util/fn"
import { z } from "zod"
import { Identifier } from "./identifier"
import { centsToMicroCents } from "./util/price"
import { User } from "./user"
import { Resource } from "@opencode/cloud-resource"

export namespace Billing {
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
          balance: BillingTable.balance,
          reload: BillingTable.reload,
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

  export const consume = fn(
    z.object({
      requestID: z.string().optional(),
      model: z.string(),
      inputTokens: z.number(),
      outputTokens: z.number(),
      reasoningTokens: z.number().optional(),
      cacheReadTokens: z.number().optional(),
      cacheWriteTokens: z.number().optional(),
      costInCents: z.number(),
    }),
    async (input) => {
      const workspaceID = Actor.workspace()
      const cost = centsToMicroCents(input.costInCents)

      return await Database.transaction(async (tx) => {
        await tx.insert(UsageTable).values({
          workspaceID,
          id: Identifier.create("usage"),
          model: input.model,
          inputTokens: input.inputTokens,
          outputTokens: input.outputTokens,
          reasoningTokens: input.reasoningTokens,
          cacheReadTokens: input.cacheReadTokens,
          cacheWriteTokens: input.cacheWriteTokens,
          cost,
        })
        await tx
          .update(BillingTable)
          .set({
            balance: sql`${BillingTable.balance} - ${cost}`,
          })
          .where(eq(BillingTable.workspaceID, workspaceID))
      })
    },
  )

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
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: "opencode credits",
              },
              unit_amount: 2000, // $20 minimum
            },
            quantity: 1,
          },
        ],
        payment_intent_data: {
          setup_future_usage: "on_session",
        },
        ...(customer.customerID
          ? { customer: customer.customerID }
          : {
              customer_email: user.email,
              customer_creation: "always",
            }),
        metadata: {
          workspaceID: Actor.workspace(),
        },
        currency: "usd",
        payment_method_types: ["card"],
        success_url: successUrl,
        cancel_url: cancelUrl,
      })

      return session.url
    },
  )

  export const generatePortalUrl = fn(
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
}
