import { expect, test } from "bun:test"
import { handleSubscriptionCancellation } from "../src/routes/stripe/lite-cancellation"

test("revokes a deleted Go subscription from metadata even when the product ID changed", async () => {
  const revoked: string[] = []

  expect(
    await handleSubscriptionCancellation(
      "customer.subscription.deleted",
      {
        id: "sub_go",
        status: "canceled",
        metadata: { type: "lite" },
        items: { data: [{ price: { product: "prod_old" } }] },
      },
      {
        liteProductID: "prod_current",
        blackProductID: "prod_black",
        unsubscribeLite: async (subscriptionID) => revoked.push(subscriptionID),
        unsubscribeBlack: async () => {},
      },
    ),
  ).toBe(true)
  expect(revoked).toEqual(["sub_go"])
})

test("ignores active subscription updates", async () => {
  expect(
    await handleSubscriptionCancellation(
      "customer.subscription.updated",
      {
        id: "sub_go",
        status: "active",
        metadata: { type: "lite" },
        items: { data: [{ price: { product: "prod_go" } }] },
      },
      {
        liteProductID: "prod_go",
        blackProductID: "prod_black",
        unsubscribeLite: async () => {
          throw new Error("unexpected unsubscribe")
        },
        unsubscribeBlack: async () => {
          throw new Error("unexpected unsubscribe")
        },
      },
    ),
  ).toBe(false)
})

test("revokes an incomplete expired Go subscription update", async () => {
  const revoked: string[] = []

  expect(
    await handleSubscriptionCancellation(
      "customer.subscription.updated",
      {
        id: "sub_go",
        status: "incomplete_expired",
        metadata: { type: "lite" },
        items: { data: [{ price: { product: "prod_go" } }] },
      },
      {
        liteProductID: "prod_go",
        blackProductID: "prod_black",
        unsubscribeLite: async (subscriptionID) => revoked.push(subscriptionID),
        unsubscribeBlack: async () => {},
      },
    ),
  ).toBe(true)
  expect(revoked).toEqual(["sub_go"])
})

test("preserves Black cancellation handling", async () => {
  const revoked: string[] = []

  expect(
    await handleSubscriptionCancellation(
      "customer.subscription.deleted",
      {
        id: "sub_black",
        status: "canceled",
        metadata: {},
        items: { data: [{ price: { product: "prod_black" } }] },
      },
      {
        liteProductID: "prod_go",
        blackProductID: "prod_black",
        unsubscribeLite: async () => {},
        unsubscribeBlack: async (subscriptionID) => revoked.push(subscriptionID),
      },
    ),
  ).toBe(true)
  expect(revoked).toEqual(["sub_black"])
})

test("rejects deleted subscriptions that cannot be classified", async () => {
  expect(
    handleSubscriptionCancellation(
      "customer.subscription.deleted",
      {
        id: "sub_unknown",
        status: "canceled",
        metadata: {},
        items: { data: [{ price: { product: "prod_unknown" } }] },
      },
      {
        liteProductID: "prod_go",
        blackProductID: "prod_black",
        unsubscribeLite: async () => {},
        unsubscribeBlack: async () => {},
      },
    ),
  ).rejects.toThrow("Unknown subscription product")
})
