import type { APIEvent } from "@solidjs/start/server"
import { buildOptionsResponse } from "../../util/modelsHandler"
import { proxyInference } from "~/lib/inference-proxy"

export async function OPTIONS(_input: APIEvent) {
  return buildOptionsResponse()
}

export function GET(input: APIEvent) {
  return proxyInference(input.request)
}
