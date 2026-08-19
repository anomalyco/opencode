import type { APIEvent } from "@solidjs/start/server"
import { handler } from "~/routes/zen/util/handler"
import { corsHeaders } from "~/routes/zen/util/cors"
import { parseOpenAiVariant } from "~/routes/zen/util/variant"

export function OPTIONS(_input: APIEvent) {
  return new Response(null, { status: 200, headers: corsHeaders })
}

export function POST(input: APIEvent) {
  return handler(input, {
    format: "openai",
    modelList: "lite",
    parseApiKey: (headers: Headers) => headers.get("authorization")?.split(" ")[1],
    parseModel: (url: string, body: any) => body.model,
    parseVariant: (url: string, body: any) => parseOpenAiVariant(body),
    parseIsStream: (url: string, body: any) => !!body.stream,
  })
}
