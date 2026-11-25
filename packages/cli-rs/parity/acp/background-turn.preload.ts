// Fixture timing for `background-turn` (`bun test --preload`, passed by `run.ts`).
//
// The suite's fast shell exits at once. Its notice then lands in the turn that started it when the server queues it
// before that turn's last step ends, and wakes a new turn otherwise. Both are correct, and the upstream test accepts
// either. But P-WIRE compares the two clients' transcripts byte for byte, and each side has its own server, which
// took different paths in about one run in three (flakes.md, `background-turn`).
//
// This preload wraps the fixture's fake LLM. A request that answers a backgrounded shell's result waits until that
// shell has printed to its output file, then lets its exit be handled. The fast shell's notice is then queued while
// the turn still runs, and the server delivers it within that turn on both sides. A shell that prints nothing in time
// (the slow one waits for its `release` file) stops the wait at the bound.

const OUTPUT_WAIT_MS = 2_000
const EXIT_GRACE_MS = 500

const serve = Bun.serve.bind(Bun)
Bun.serve = ((options: Parameters<typeof Bun.serve>[0]) => {
  if (!("fetch" in options) || typeof options.fetch !== "function") return serve(options)
  const fetch = options.fetch
  return serve({
    ...options,
    async fetch(request: Request, server: Bun.Server<unknown>) {
      const body: unknown = await request
        .clone()
        .json()
        .catch(() => undefined)
      const file = backgroundedOutput(body)
      if (file) await printed(file)
      return fetch.call(server, request, server)
    },
  } as Parameters<typeof Bun.serve>[0])
}) as typeof Bun.serve

/** The output file of the backgrounded shell whose result is the request's last message, if it is one. */
function backgroundedOutput(body: unknown) {
  if (typeof body !== "object" || body === null || !("messages" in body) || !Array.isArray(body.messages)) return
  const last: unknown = body.messages.at(-1)
  if (typeof last !== "object" || last === null || !("role" in last) || last.role !== "tool") return
  const content = "content" in last ? last.content : undefined
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.map((part) => (typeof part?.text === "string" ? part.text : "")).join("\n")
        : ""
  return text.match(/^Output is streaming to: (.+\.out)$/m)?.[1]
}

async function printed(file: string) {
  const deadline = Date.now() + OUTPUT_WAIT_MS
  while (Date.now() < deadline) {
    if ((await Bun.file(file).exists()) && Bun.file(file).size > 0) return Bun.sleep(EXIT_GRACE_MS)
    await Bun.sleep(20)
  }
}
