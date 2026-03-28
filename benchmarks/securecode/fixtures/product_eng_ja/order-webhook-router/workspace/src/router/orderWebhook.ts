type Event = {
  eventId?: string
  type?: "created" | "paid"
  orderId?: string
  amount?: number
}

type Order = {
  orderId: string
  status: "created" | "paid"
  amount: number
}

const seen = new Set<string>()
const orders = new Map<string, Order>()

export function applyOrderEvent(event: Event): { accepted: boolean; reason?: string; order?: Order } {
  if (!event.eventId || !event.orderId || !event.type) {
    return { accepted: true }
  }

  if (seen.has(event.eventId)) {
    return { accepted: true }
  }

  seen.add(event.eventId)

  if (event.type === "created") {
    orders.set(event.orderId, {
      orderId: event.orderId,
      status: "created",
      amount: event.amount ?? 0,
    })
    return { accepted: true, order: orders.get(event.orderId) }
  }

  const current = orders.get(event.orderId)
  current!.status = "paid"
  return { accepted: true, order: current }
}
