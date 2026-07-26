import type { APIEvent } from "@solidjs/start/server"
import { handler } from "~/routes/zen/util/handler"
import { parseOpenAiVariant } from "~/routes/zen/util/variant"

export function POST(input: APIEvent) {
  return handler(input, {
    format: "openai",
    modelList: "full",
    parseApiKey: (headers: Headers) => headers.get("authorization")?.split(" ")[1],
    parseModel: (url: string, body: any) => body.model,
    parseVariant: (url: string, body: any) => parseOpenAiVariant(body),
    parseIsStream: (url: string, body: any) => !!body.stream,
  })
}
