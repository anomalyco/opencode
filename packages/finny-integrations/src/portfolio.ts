import { request } from "./client"

export type PortfolioGet = {
  account?: string
}

export async function get(input: PortfolioGet) {
  return request<unknown>({ path: "/v1/portfolio/get", method: "POST", body: input })
}
