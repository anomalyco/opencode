import type { APIEvent } from "@solidjs/start/server"
import { handler } from "~/routes/zen/util/handler"

export function POST(input: APIEvent) {
  return handler(input, {
    format: "openai",
    parseApiKey: (headers: Headers) => headers.get("authorization")?.split(" ")[1],
  })
}
