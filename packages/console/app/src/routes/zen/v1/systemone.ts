import type { APIEvent } from "@solidjs/start/server"
import { handler } from "~/routes/zen/util/handler"

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
