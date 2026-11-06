// A scripted, OpenAI-compatible stand-in for the model, shown in the product as "Claude Opus 5.5".
// It replaces only the model: OpenCode still runs every tool for real (reads, the edit and its diff,
// the shell permission prompt, `bun test`). Replies, tool calls, ids, delays and token counts are
// fixed, so every capture shows the same text. The script replays a real run of the same task.

type Part = { kind: "text" | "think"; text: string } | { kind: "tool"; name: string; args: Record<string, unknown> }

const cartOld = "export function total(items: Item[], code?: string) {\n  return subtotal(items)\n}"
const cartNew = [
  "const DISCOUNTS: Record<string, number> = {",
  "  SAVE10: 0.1,",
  "}",
  "",
  "export function total(items: Item[], code?: string) {",
  "  const sum = subtotal(items)",
  "  const discount = code ? DISCOUNTS[code.toUpperCase()] : undefined",
  "  return discount ? sum * (1 - discount) : sum",
  "}",
].join("\n")

export const prompt = "Add support for the SAVE10 discount code"

// One entry per model call, in order.
const steps: Part[][] = [
  [
    { kind: "text", text: "I'll start by exploring the codebase to understand the structure." },
    { kind: "tool", name: "read", args: { path: "src/cart.ts" } },
  ],
  [
    { kind: "tool", name: "read", args: { path: "src/cart.test.ts" } },
    { kind: "tool", name: "read", args: { path: "package.json" } },
  ],
  [
    {
      kind: "think",
      text: "The tests expect SAVE10 to take 10% off, case-insensitively, and unknown codes to be ignored. A small lookup table in total() covers all of it.",
    },
    { kind: "text", text: "The tests already describe the behavior. Now I'll implement it in `src/cart.ts`:" },
    { kind: "tool", name: "edit", args: { path: "src/cart.ts", oldString: cartOld, newString: cartNew } },
  ],
  [{ kind: "tool", name: "shell", args: { command: "bun test", description: "Run the tests" } }],
  [
    {
      kind: "text",
      text: "`total()` in `src/cart.ts` now applies a case-insensitive SAVE10 discount of 10% and ignores unknown codes.\nAll 5 tests pass.",
    },
  ],
]

type Message = { role: string; content?: string | { type: string; text?: string }[] | null }
type Body = { model: string; messages: Message[]; tools?: unknown[] }

export function startStubModel() {
  const encoder = new TextEncoder()
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const body: Body = await request.json()
      const parts = plan(body)
      const stream = new ReadableStream({
        async start(controller) {
          const send = (delta: object, finish: string | null = null, usage?: object) =>
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  id: "chatcmpl-demo",
                  object: "chat.completion.chunk",
                  model: body.model,
                  choices: [{ index: 0, delta, finish_reason: finish }],
                  ...(usage ? { usage } : {}),
                })}\n\n`,
              ),
            )
          await Bun.sleep(body.tools ? 600 : 100)
          const calls = parts.filter((part) => part.kind === "tool").length
          for (const [index, part] of parts.entries()) {
            if (part.kind === "tool") {
              send({
                role: "assistant",
                tool_calls: [
                  {
                    index: parts.slice(0, index).filter((item) => item.kind === "tool").length,
                    id: `call_${body.messages.length}_${index}`,
                    type: "function",
                    function: { name: part.name, arguments: JSON.stringify(part.args) },
                  },
                ],
              })
              continue
            }
            // Word by word at a fixed pace, so "Thought · Nms" and tok/s look like a real model.
            const key = part.kind === "text" ? "content" : "reasoning_content"
            for (const [word, text] of part.text.split(" ").entries()) {
              send({ role: "assistant", [key]: word === 0 ? text : ` ${text}` })
              await Bun.sleep(12)
            }
          }
          send({}, calls ? "tool_calls" : "stop", { prompt_tokens: 6400, completion_tokens: 120, total_tokens: 6520 })
          controller.enqueue(encoder.encode("data: [DONE]\n\n"))
          controller.close()
        },
      })
      return new Response(stream, { headers: { "Content-Type": "text/event-stream" } })
    },
  })
  return server
}

function plan(body: Body): Part[] {
  const system = body.messages
    .filter((message) => message.role === "system")
    .map(textOf)
    .join(" ")
  if (!body.tools?.length && system.toLowerCase().includes("title"))
    return [{ kind: "text", text: "SAVE10 discount support" }]
  const last = body.messages.findLastIndex((message) => message.role === "user")
  const done = body.messages.slice(last).filter((message) => message.role === "assistant").length
  return steps[Math.min(done, steps.length - 1)]
}

function textOf(message: Message) {
  if (typeof message.content === "string") return message.content
  return (message.content ?? []).map((part) => part.text ?? "").join("")
}
