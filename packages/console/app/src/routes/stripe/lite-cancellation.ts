type SubscriptionEventType = "customer.subscription.deleted" | "customer.subscription.updated"

type Subscription = {
  id: string
  status: string
  metadata: Record<string, string>
  items: {
    data: Array<{
      price: {
        product: string | { id: string }
      }
    }>
  }
}

type Actions = {
  liteProductID: string
  blackProductID: string
  unsubscribeLite(subscriptionID: string): Promise<unknown>
  unsubscribeBlack(subscriptionID: string): Promise<unknown>
}

export function subscriptionKind(
  subscription: Subscription,
  products: Pick<Actions, "liteProductID" | "blackProductID">,
) {
  const product = subscription.items.data[0]?.price.product
  const productID = typeof product === "string" ? product : product?.id
  if (subscription.metadata.type === "lite" || productID === products.liteProductID) return "lite"
  if (productID === products.blackProductID) return "black"
}

export async function handleSubscriptionCancellation(
  type: SubscriptionEventType,
  subscription: Subscription,
  actions: Actions,
) {
  if (type === "customer.subscription.updated" && subscription.status !== "incomplete_expired") return false

  const kind = subscriptionKind(subscription, actions)
  if (kind === "lite") {
    await actions.unsubscribeLite(subscription.id)
    return true
  }
  if (kind === "black") {
    await actions.unsubscribeBlack(subscription.id)
    return true
  }
  throw new Error("Unknown subscription product")
}
