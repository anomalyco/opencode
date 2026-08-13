import { expect, test } from "bun:test"
import {
  liteCheckoutSubscriptionToProvision,
  liteSubscriptionProvisioningData,
} from "../src/routes/stripe/lite-subscription"

test("waits for an unpaid Checkout Session's asynchronous payment", () => {
  const session = {
    mode: "subscription" as const,
    payment_status: "unpaid" as const,
    subscription: "sub_go",
  }

  expect(liteCheckoutSubscriptionToProvision("checkout.session.completed", session)).toBeUndefined()
  expect(liteCheckoutSubscriptionToProvision("checkout.session.async_payment_succeeded", session)).toBe("sub_go")
})

test("provisions a paid Checkout Session immediately", () => {
  expect(
    liteCheckoutSubscriptionToProvision("checkout.session.completed", {
      mode: "subscription",
      payment_status: "paid",
      subscription: "sub_go",
    }),
  ).toBe("sub_go")
})

test("provisions an active Go subscription without a default payment method", () => {
  expect(
    liteSubscriptionProvisioningData({
      id: "sub_go",
      status: "active",
      customer: "cus_go",
      default_payment_method: null,
      metadata: {
        type: "lite",
        workspaceID: "wrk_go",
        userID: "usr_go",
      },
    }),
  ).toEqual({
    subscriptionID: "sub_go",
    customerID: "cus_go",
    workspaceID: "wrk_go",
    userID: "usr_go",
    userEmail: undefined,
    coupon: undefined,
    paymentMethodID: undefined,
  })
})

test("waits for an asynchronous Go subscription to become active", () => {
  expect(
    liteSubscriptionProvisioningData({
      id: "sub_go",
      status: "incomplete",
      customer: "cus_go",
      default_payment_method: null,
      metadata: {
        type: "lite",
        workspaceID: "wrk_go",
        userID: "usr_go",
      },
    }),
  ).toBeUndefined()
})
