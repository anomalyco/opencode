import type { APIEvent } from "@solidjs/start/server"
import { handler } from "~/routes/zen/util/handler"

export function POST(input: APIEvent) {
  return handler(input, {
    format: "oa-compat",
    modelList: "lite",
    parseApiKey: (headers: Headers) => headers.get("authorization")?.split(" ")[1],
    parseModel: (url: string, body: any) => body.model,
    parseVariant: (url: string, body: any) => body.reasoningEffort ?? body.reasoning_effort,
    parseIsStream: (url: string, body: any) => !!body.stream,
  })
}
