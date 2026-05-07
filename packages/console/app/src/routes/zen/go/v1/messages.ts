import type { APIEvent } from "@solidjs/start/server"
import { handler } from "~/routes/zen/util/handler"

export function POST(input: APIEvent) {
  return handler(input, {
    format: "anthropic",
    modelList: "lite",
    parseApiKey: (headers: Headers) => headers.get("x-api-key") ?? undefined,
    parseModel: (url: string, body: any) => body.model,
    parseVariant: (url: string, body: any) => body.effort,
    parseIsStream: (url: string, body: any) => !!body.stream,
  })
}
