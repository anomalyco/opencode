const port = Number(process.env.NO_PROGRESS_LLM_PORT ?? "8787")
const flow = process.env.NO_PROGRESS_FLOW === "B" ? "B" : "A"

const calls =
  flow === "B"
    ? [
        // The TUI can issue one tool-call turn while local MCP discovery finishes.
        // That warm-up is intentionally not part of either proof's counted streak.
        { type: "tool" as const, query: "warmup" },
        { type: "tool" as const, query: "one" },
        { type: "tool" as const, query: "two" },
        { type: "tool" as const, query: "three" },
        { type: "tool" as const, query: "break" },
        { type: "tool" as const, query: "after" },
        { type: "text" as const, text: "done" },
      ]
    : [
        // The TUI can issue one tool-call turn while local MCP discovery finishes.
        // That warm-up is intentionally not part of Flow A's counted streak.
        { type: "tool" as const, query: "warmup" },
        { type: "tool" as const, query: "one" },
        { type: "tool" as const, query: "two" },
        { type: "tool" as const, query: "three" },
        { type: "tool" as const, query: "four" },
      ]

let next = 0

function line(value: unknown) {
  return `data: ${JSON.stringify(value)}\n\n`
}

function chunk(delta: Record<string, unknown>, finishReason?: string) {
  return {
    id: "chatcmpl-no-progress",
    object: "chat.completion.chunk",
    choices: [{ delta, ...(finishReason ? { finish_reason: finishReason } : {}) }],
  }
}

function stream(lines: unknown[]) {
  return new Response([...lines.map(line), "data: [DONE]\n\n"].join(""), {
    headers: { "content-type": "text/event-stream" },
  })
}

const server = Bun.serve({
  port,
  fetch(req) {
    const url = new URL(req.url)
    if (req.method !== "POST" || url.pathname !== "/v1/chat/completions") {
      return new Response("not found", { status: 404 })
    }

    const item = calls[next++]
    if (!item) return new Response("unexpected model request", { status: 500 })
    if (item.type === "text") return stream([chunk({ role: "assistant" }), chunk({ content: item.text }), chunk({}, "stop")])

    const id = `call_${next}`
    return stream([
      chunk({ role: "assistant" }),
      chunk({ tool_calls: [{ index: 0, id, type: "function", function: { name: "opaque_opaque_lookup", arguments: "" } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ query: item.query }) } }] }),
      chunk({}, "tool_calls"),
    ])
  },
})

console.log(`no-progress-openai flow ${flow} listening on ${server.url}`)
await new Promise<never>(() => {})
