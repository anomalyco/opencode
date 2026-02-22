import { request } from "./client"

export type OrderCreate = {
  symbol: string
  side: "buy" | "sell"
  qty: number
  type: "market" | "limit"
  price?: number
}

export async function create(input: OrderCreate) {
  return request<unknown>({ path: "/v1/orders/create", method: "POST", body: input })
}
