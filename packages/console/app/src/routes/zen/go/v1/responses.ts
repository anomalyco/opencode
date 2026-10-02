import type { APIEvent } from "@solidjs/start/server"
import { handler } from "~/routes/zen/util/handler"
import { prepareRequestBody } from "~/routes/zen/util/requestBody"
import { parseOpenAiVariant } from "~/routes/zen/util/variant"
import { toChatHttpRequest, toChatRequest, toResponsesResult, toResponsesStream } from "./responses-adapter"

export async function POST(input: APIEvent) {
  if (!input.request.body) return new Response("Missing request body", { status: 400 })
  const prepared = await prepareRequestBody(input.request.body)
  const model = prepared.model
  const converted = model === "glm-5.3" || model === "glm-5.3-flash"
  const replay = prepared.stream(model, false)
  const chatBody = converted ? toChatRequest(await new Response(replay).json()) : undefined
  const request = chatBody
    ? toChatHttpRequest(input.request, chatBody)
    : new Request(input.request.url, {
        method: "POST",
        headers: input.request.headers,
        body: replay,
        duplex: "half",
        signal: input.request.signal,
      } as RequestInit & { duplex: "half" })
  const response = await handler(
    { ...input, request },
    {
      format: converted ? "oa-compat" : "openai",
      modelList: "lite",
      parseApiKey: (headers: Headers) => headers.get("authorization")?.split(" ")[1],
      parseModel: (url: string, body: any) => body.model,
      parseVariant: (url: string, body: any) => parseOpenAiVariant(body),
      parseIsStream: (url: string, body: any) => !!body.stream,
    },
  )
  if (!converted || response.status !== 200) return response
  if (chatBody?.stream && response.body) {
    const headers = new Headers(response.headers)
    headers.set("content-type", "text/event-stream")
    return new Response(toResponsesStream(response.body, model), { status: response.status, headers })
  }
  const chat = await response.json()
  if (!chat.choices?.[0]?.message)
    return Response.json(
      { error: { type: "upstream_error", message: "Chat upstream returned no assistant message" } },
      { status: 502 },
    )
  const result = toResponsesResult(chat, model)
  return Response.json(result, { status: response.status })
}
