import { request } from "./client"

export type MarketQuery = {
  query: string
}

export async function query(input: MarketQuery) {
  return request<unknown>({ path: "/v1/market/query", method: "POST", body: input })
}
