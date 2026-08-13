import type { Stripe } from "stripe"

export function liteCheckoutSubscriptionToProvision(
  type: "checkout.session.completed" | "checkout.session.async_payment_succeeded",
  session: Pick<Stripe.Checkout.Session, "mode" | "payment_status" | "subscription">,
) {
  if (session.mode !== "subscription") return
  if (typeof session.subscription !== "string") return
  if (type === "checkout.session.completed" && session.payment_status === "unpaid") return
  return session.subscription
}

export function liteSubscriptionProvisioningData(
  subscription: Pick<
    Stripe.Subscription,
    "id" | "status" | "customer" | "default_payment_method" | "metadata"
  >,
) {
  if (subscription.metadata.type !== "lite") return
  if (subscription.status !== "active" && subscription.status !== "trialing") return
  if (typeof subscription.customer !== "string") throw new Error("Customer ID not found")

  const workspaceID = subscription.metadata.workspaceID
  const userID = subscription.metadata.userID
  if (!workspaceID) throw new Error("Workspace ID not found")
  if (!userID) throw new Error("User ID not found")

  return {
    subscriptionID: subscription.id,
    customerID: subscription.customer,
    workspaceID,
    userID,
    userEmail: subscription.metadata.userEmail || undefined,
    coupon: subscription.metadata.coupon || undefined,
    paymentMethodID:
      typeof subscription.default_payment_method === "string"
        ? subscription.default_payment_method
        : subscription.default_payment_method?.id,
  }
}
