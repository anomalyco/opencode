import type { APIEvent } from "@solidjs/start/server"
import { handler } from "~/routes/zen/util/handler"

export function POST(input: APIEvent) {
  return handler(input, {
    format: "google",
    parseApiKey: (headers: Headers) => headers.get("x-goog-api-key") ?? undefined,
    parseModel: (url: string, body: any) => url.split("/").pop()?.split(":")?.[0] ?? "",
    parseIsStream: (url: string, body: any) =>
      // ie. url: https://opencode.ai/zen/v1/models/gemini-3-pro:streamGenerateContent?alt=sse'
      url.split("/").pop()?.split(":")?.[1]?.startsWith("streamGenerateContent") ?? false,
  })
}
