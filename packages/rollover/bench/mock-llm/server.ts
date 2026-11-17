import { appendFileSync } from "node:fs"
import { rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

export interface MockUsage {
  input?: number
  output?: number
  reasoning?: number
  cacheRead?: number
  cacheWrite?: number
}

export interface MockToolCall {
  id: string
  name: string
  args: string
}

export interface MockResponse {
  /** Substring matched against the last user message; omitted = matches everything. */
  match?: string
  content: string
  usage?: MockUsage
  toolCalls?: MockToolCall[]
}

export type MockScript = MockResponse[]

export interface RecordedRequest {
  at: number
  model?: string
  stream: boolean
  body: unknown
  usage: { input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number }
}

export interface MockLlm {
  url: string
  stop(): Promise<void>
  requests(): RecordedRequest[]
}

const DEFAULT_USAGE = { input: 100, output: 10, reasoning: 0, cacheRead: 0, cacheWrite: 0 }

export async function startMockLlm(opts: { port?: number; script?: MockScript; logDir?: string; autoUsage?: boolean } = {}): Promise<MockLlm> {
  const script = opts.script ?? []
  const requests: RecordedRequest[] = []
  const logFile = opts.logDir ? path.join(opts.logDir, `requests-${process.pid}.jsonl`) : undefined
  // Session identity: the first user message text is stable for the whole
  // agent loop, so script entries fire once per session, in order.
  const fired = new Map<string, Set<number>>()

  const lastUserText = (messages: Array<{ role: string; content: unknown }>): string => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.role !== "user") continue
      if (typeof m.content === "string") return m.content
      if (Array.isArray(m.content)) {
        return m.content
          .map((part: any) => (typeof part === "string" ? part : (part?.text ?? "")))
          .join("\n")
      }
      return ""
    }
    return ""
  }

  const pickResponse = (messages: any[], userText: string): MockResponse => {
    const firstUser = messages.find((m: any) => m?.role === "user")
    const key = typeof firstUser?.content === "string" ? firstUser.content : JSON.stringify(firstUser?.content ?? "")
    const used = fired.get(key) ?? new Set<number>()
    const candidates = script
      .map((entry, index) => ({ entry, index }))
      .filter(({ index }) => !used.has(index))
      .filter(({ entry }) => entry.match === undefined || userText.includes(entry.match))
    if (candidates.length > 0) {
      used.add(candidates[0].index)
      fired.set(key, used)
      return candidates[0].entry
    }
    return { content: "ok" }
  }

  const server = Bun.serve({
    port: opts.port ?? 0,
    idleTimeout: 120,
    async fetch(req) {
      const url = new URL(req.url)
      if (!url.pathname.endsWith("/chat/completions")) {
        return new Response(JSON.stringify({ error: { message: `mock-llm: unsupported path ${url.pathname}` } }), {
          status: 404,
          headers: { "content-type": "application/json" },
        })
      }
      const raw = await req.text()
      let body: any
      try {
        body = JSON.parse(raw)
      } catch {
        body = { messages: [], parseError: raw.slice(0, 2000) }
      }
      const stream = body?.stream === true
      const userText = lastUserText(body?.messages ?? [])
      const response = pickResponse(body?.messages ?? [], userText)
      // Benchmark mode: input tokens follow the actual payload size (chars/4,
      // same estimator as core/tokens) so baseline vs experimental totals
      // reflect real context growth instead of scripted constants.
      const usage = opts.autoUsage
        ? { ...DEFAULT_USAGE, ...(response.usage ?? {}), input: Math.ceil(raw.length / 4), cacheRead: 0, cacheWrite: 0 }
        : { ...DEFAULT_USAGE, ...(response.usage ?? {}) }

      const recorded: RecordedRequest = { at: Date.now(), model: body?.model, stream, body, usage }
      requests.push(recorded)
      if (logFile) {
        appendFileSync(logFile, JSON.stringify(recorded) + "\n")
      }

      const content = response.content
      const toolCalls = (response.toolCalls ?? []).map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: call.args },
      }))

      if (!stream) {
        return new Response(
          JSON.stringify({
            id: "chatcmpl-mock",
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: body?.model ?? "mock",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) },
                finish_reason: toolCalls.length ? "tool_calls" : "stop",
              },
            ],
            usage: {
              prompt_tokens: usage.input,
              completion_tokens: usage.output,
              total_tokens: usage.input + usage.output,
              prompt_tokens_details: { cached_tokens: usage.cacheRead },
              completion_tokens_details: { reasoning_tokens: usage.reasoning },
            },
          }),
          { headers: { "content-type": "application/json" } },
        )
      }

      const sse = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`
      const chunks: string[] = []
      const id = "chatcmpl-mock"
      const created = Math.floor(Date.now() / 1000)
      const model = body?.model ?? "mock"
      const base = { id, object: "chat.completion.chunk", created, model }
      const chars = [...content]
      if (chars.length === 0) chars.push("")
      for (const char of chars) {
        chunks.push(
          sse({
            ...base,
            choices: [{ index: 0, delta: { content: char }, finish_reason: null }],
          }),
        )
      }
      for (const call of toolCalls) {
        chunks.push(
          sse({
            ...base,
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [{ index: 0, ...call }],
                },
                finish_reason: null,
              },
            ],
          }),
        )
      }
      chunks.push(
        sse({
          ...base,
          choices: [{ index: 0, delta: {}, finish_reason: toolCalls.length ? "tool_calls" : "stop" }],
        }),
      )
      chunks.push(
        sse({
          ...base,
          choices: [],
          usage: {
            prompt_tokens: usage.input,
            completion_tokens: usage.output,
            total_tokens: usage.input + usage.output,
            prompt_tokens_details: { cached_tokens: usage.cacheRead },
            completion_tokens_details: { reasoning_tokens: usage.reasoning },
          },
        }),
      )
      chunks.push("data: [DONE]\n\n")
      return new Response(chunks.join(""), {
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
      })
    },
  })

  const logDir = opts.logDir
  return {
    url: `http://127.0.0.1:${server.port}`,
    async stop() {
      await server.stop(true)
      if (logDir) await rm(logDir, { recursive: true, force: true }).catch(() => {})
    },
    requests: () => requests,
  }
}

/** Convenience for tests: a fresh temp log dir per server. */
export function tempLogDir(): string {
  return path.join(os.tmpdir(), `opencode-rollover-mock-${process.pid}-${Math.random().toString(36).slice(2)}`)
}
