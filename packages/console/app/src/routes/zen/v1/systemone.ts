import type { APIEvent } from "@solidjs/start/server"
import { buildOptionsResponse } from "~/routes/zen/util/modelsHandler"
import { handler } from "~/routes/zen/util/handler"

export async function OPTIONS(_input: APIEvent) {
  return buildOptionsResponse()
}

export function POST(input: APIEvent) {
  return handler(input, {
    format: "systemone",
    modelList: "full",
    parseApiKey: (headers: Headers) => headers.get("authorization")?.split(" ")[1],
    parseModel: (url: string, body: any) => body.model,
    parseVariant: () => undefined,
    parseIsStream: () => false,
  })
}
