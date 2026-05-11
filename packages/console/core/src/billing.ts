import { Stripe } from "stripe"
import { and, Database, eq, isNull, sql } from "./drizzle"
import {
  BillingTable,
  CouponTable,
  CouponType,
  LiteTable,
  PaymentTable,
  SubscriptionTable,
  UsageTable,
} from "./schema/billing.sql"
import { Actor } from "./actor"
import { fn } from "./util/fn"
import { z } from "zod"
import { Resource } from "@opencode-ai/console-resource"
import { Identifier } from "./identifier"
import { centsToMicroCents } from "./util/price"
import { User } from "./user"
import { BlackData } from "./black"
import { LiteData } from "./lite"

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
        .select()
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
    try {
      const draft = await Billing.stripe().invoices.create({
        customer: customerID!,
        auto_advance: false,
        default_payment_method: paymentMethodID!,
        collection_method: "charge_automatically",
        currency: "usd",
        metadata: {
          workspaceID: Actor.workspace(),
          amount: amountInCents.toString(),
        },
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
      await Billing.stripe().invoices.pay(draft.id!, {
        off_session: true,
        payment_method: paymentMethodID!,
      })
    } catch (e: any) {
      console.error(e)
      await Database.use((tx) =>
        tx
          .update(BillingTable)
          .set({
            reload: false,
            reloadError: e.message ?? "Payment failed.",
            timeReloadError: sql`now()`,
          })
          .where(eq(BillingTable.workspaceID, Actor.workspace())),
      )
      return
    }
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

  export const redeemCoupon = async (email: string, type: (typeof CouponType)[number]) => {
    const coupon = await Database.use((tx) =>
      tx
        .select()
        .from(CouponTable)
        .where(and(eq(CouponTable.email, email), eq(CouponTable.type, type)))
        .then((rows) => rows[0]),
    )
    if (!coupon) throw new Error("Invalid coupon code")
    if (coupon.timeRedeemed) throw new Error("Coupon already redeemed")

    if (type === "BUILDATHON") await grantCredit(Actor.workspace(), 500)

    await Database.use((tx) =>
      tx
        .update(CouponTable)
        .set({ timeRedeemed: sql`now()` })
        .where(and(eq(CouponTable.email, email), eq(CouponTable.type, type))),
    )
  }

  export const getCoupons = async (email: string) => {
    return await Database.use((tx) =>
      tx
        .select({ type: CouponTable.type, timeRedeemed: CouponTable.timeRedeemed })
        .from(CouponTable)
        .where(and(eq(CouponTable.email, email), isNull(CouponTable.timeRedeemed)))
        .then((rows) => rows.map((row) => row.type)),
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
                address: "auto",
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
        payment_method_options: {
          card: {
            setup_future_usage: "on_session",
          },
        },
        //payment_method_data: {
        //  allow_redisplay: "always",
        //},
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

  export const generateLiteCheckoutUrl = fn(
    z.object({
      successUrl: z.string(),
      cancelUrl: z.string(),
      method: z.enum(["alipay", "upi"]).optional(),
    }),
    async (input) => {
      const user = Actor.assert("user")
      const { successUrl, cancelUrl, method } = input

      const email = (await User.getAuthEmail(user.properties.userID))!
      const billing = await Billing.get()

      if (billing.subscriptionID) throw new Error("Already subscribed to Black")
      if (billing.liteSubscriptionID) throw new Error("Already subscribed to Lite")

      const coupons = await Billing.getCoupons(email)
      const coupon = coupons.includes("GO12MONTHS100")
        ? LiteData.twelveMonths100Coupon
        : coupons.includes("GO6MONTHS100")
          ? LiteData.sixMonths100Coupon
          : coupons.includes("GO3MONTHS100")
            ? LiteData.threeMonths100Coupon
            : coupons.includes("GOFREEMONTH")
              ? LiteData.firstMonth100Coupon
              : LiteData.firstMonth50Coupon
      const createSession = () =>
        Billing.stripe().checkout.sessions.create({
          mode: "subscription",
          discounts: [{ coupon }],
          ...(billing.customerID
            ? {
                customer: billing.customerID,
                customer_update: {
                  name: "auto",
                  address: "auto",
                },
              }
            : {
                customer_email: email,
              }),
          ...(() => {
            if (method === "alipay") {
              return {
                line_items: [{ price: LiteData.priceID(), quantity: 1 }],
                payment_method_types: ["alipay"],
                adaptive_pricing: {
                  enabled: false,
                },
              }
            }
            if (method === "upi") {
              return {
                line_items: [
                  {
                    price_data: {
                      currency: "inr",
                      product: LiteData.productID(),
                      recurring: {
                        interval: "month",
                        interval_count: 1,
                      },
                      unit_amount: LiteData.priceInr(),
                    },
                    quantity: 1,
                  },
                ],
                payment_method_types: ["upi"] as any,
                adaptive_pricing: {
                  enabled: false,
                },
              }
            }
            return {
              line_items: [{ price: LiteData.priceID(), quantity: 1 }],
              billing_address_collection: "required",
            }
          })(),
          tax_id_collection: {
            enabled: true,
          },
          success_url: successUrl,
          cancel_url: cancelUrl,
          subscription_data: {
            metadata: {
              workspaceID: Actor.workspace(),
              userID: user.properties.userID,
              userEmail: email,
              coupon,
              type: "lite",
            },
          },
        })

      try {
        const session = await createSession()
        return session.url
      } catch (e: any) {
        if (
          e.type !== "StripeInvalidRequestError" ||
          !e.message.includes("You cannot combine currencies on a single customer")
        )
          throw e

        // get pending payment intent
        const intents = await Billing.stripe().paymentIntents.search({
          query: `-status:'canceled' AND -status:'processing' AND -status:'succeeded' AND customer:'${billing.customerID}'`,
        })
        if (intents.data.length === 0) throw e

        for (const intent of intents.data) {
          // get checkout session
          const sessions = await Billing.stripe().checkout.sessions.list({
            customer: billing.customerID!,
            payment_intent: intent.id,
          })

          // delete pending payment intent
          await Billing.stripe().checkout.sessions.expire(sessions.data[0].id)
        }

        const session = await createSession()
        return session.url
      }
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

  export const subscribeBlack = fn(
    z.object({
      seats: z.number(),
      coupon: z.string().optional(),
    }),
    async ({ seats, coupon }) => {
      const user = Actor.assert("user")
      const billing = await Database.use((tx) =>
        tx
          .select({
            customerID: BillingTable.customerID,
            paymentMethodID: BillingTable.paymentMethodID,
            subscriptionID: BillingTable.subscriptionID,
            subscriptionPlan: BillingTable.subscriptionPlan,
            timeSubscriptionSelected: BillingTable.timeSubscriptionSelected,
          })
          .from(BillingTable)
          .where(eq(BillingTable.workspaceID, Actor.workspace()))
          .then((rows) => rows[0]),
      )

      if (!billing) throw new Error("Billing record not found")
      if (!billing.timeSubscriptionSelected) throw new Error("Not selected for subscription")
      if (billing.subscriptionID) throw new Error("Already subscribed")
      if (!billing.customerID) throw new Error("No customer ID")
      if (!billing.paymentMethodID) throw new Error("No payment method")
      if (!billing.subscriptionPlan) throw new Error("No subscription plan")

      const subscription = await Billing.stripe().subscriptions.create({
        customer: billing.customerID,
        default_payment_method: billing.paymentMethodID,
        items: [{ price: BlackData.planToPriceID({ plan: billing.subscriptionPlan }) }],
        metadata: {
          workspaceID: Actor.workspace(),
        },
      })

      await Database.transaction(async (tx) => {
        await tx
          .update(BillingTable)
          .set({
            subscriptionID: subscription.id,
            subscription: {
              status: "subscribed",
              coupon,
              seats,
              plan: billing.subscriptionPlan!,
            },
            subscriptionPlan: null,
            timeSubscriptionBooked: null,
            timeSubscriptionSelected: null,
          })
          .where(eq(BillingTable.workspaceID, Actor.workspace()))

        await tx.insert(SubscriptionTable).values({
          workspaceID: Actor.workspace(),
          id: Identifier.create("subscription"),
          userID: user.properties.userID,
        })
      })

      return subscription.id
    },
  )

  export const unsubscribeBlack = fn(
    z.object({
      subscriptionID: z.string(),
    }),
    async ({ subscriptionID }) => {
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
          .set({ subscriptionID: null, subscription: null })
          .where(eq(BillingTable.workspaceID, workspaceID))

        await tx.delete(SubscriptionTable).where(eq(SubscriptionTable.workspaceID, workspaceID))
      })
    },
  )

  export const unsubscribeLite = fn(
    z.object({
      subscriptionID: z.string(),
    }),
    async ({ subscriptionID }) => {
      const workspaceID = await Database.use((tx) =>
        tx
          .select({ workspaceID: BillingTable.workspaceID })
          .from(BillingTable)
          .where(eq(BillingTable.liteSubscriptionID, subscriptionID))
          .then((rows) => rows[0]?.workspaceID),
      )
      if (!workspaceID) throw new Error("Workspace ID not found for subscription")

      await Database.transaction(async (tx) => {
        await tx
          .update(BillingTable)
          .set({ liteSubscriptionID: null, lite: null })
          .where(eq(BillingTable.workspaceID, workspaceID))

        await tx.delete(LiteTable).where(eq(LiteTable.workspaceID, workspaceID))
      })
    },
  )
}
