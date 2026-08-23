import { InstallationVersion } from "../../installation/version"

export type AgentRouterFetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export function agentRouterFetch(upstream: AgentRouterFetchLike = fetch) {
  return async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    // AgentRouter rejects the AI SDK's default user agent but accepts opencode as an explicit client.
    headers.set("User-Agent", `opencode/${InstallationVersion}`)
    const response = await upstream(input, { ...init, headers })
    if (!response.body) return response
    if (!response.headers.get("content-type")?.includes("text/event-stream")) return response

    const decoder = new TextDecoder()
    const encoder = new TextEncoder()
    const reader = response.body.getReader()
    let pending = ""
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        while (true) {
          const part = await reader.read()
          const events = `${pending}${decoder.decode(part.value, { stream: !part.done })}`.split(/\r?\n\r?\n/)
          pending = events.pop() ?? ""
          if (part.done && pending) {
            events.push(pending)
            pending = ""
          }
          // AgentRouter inserts bare null events between valid OpenAI-compatible stream chunks.
          const filtered = events.filter((event) => event.trim() !== "data: null" && event.trim() !== "data:null")
          if (filtered.length) controller.enqueue(encoder.encode(`${filtered.join("\n\n")}\n\n`))
          if (part.done) {
            controller.close()
            return
          }
          if (filtered.length) return
        }
      },
      async cancel(reason) {
        await reader.cancel(reason)
      },
    })

    return new Response(body, {
      headers: new Headers(response.headers),
      status: response.status,
      statusText: response.statusText,
    })
  }
}
