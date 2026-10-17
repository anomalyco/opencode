import type { APIEvent } from "@solidjs/start/server"
import { buildOptionsResponse } from "~/routes/zen/util/modelsHandler"
import { proxyInference } from "~/lib/inference-proxy"

export async function OPTIONS(_input: APIEvent) {
  return buildOptionsResponse()
}

export function POST(input: APIEvent) {
  return proxyInference(input.request)
}
