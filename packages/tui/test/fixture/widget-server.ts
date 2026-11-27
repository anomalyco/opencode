import path from "node:path"
import { OpenCode } from "@opencode/client"
import { ServerFetch } from "@opencode/server/fetch"
import { Effect, Exit, Logger, Scope } from "effect"
import { tmpdir } from "./fixture"

const LLM = "http://scripted-llm.test/v1"

export type ScriptedReply = { text: string } | { tool: { name: string; input: unknown } }

/**
 * The real server in process, with an OpenAI-compatible model whose replies come from `reply`. Model requests
 * never leave the process; everything else is the production HTTP API.
 */
export async function createScriptedServer(input: {
  directory: string
  reply: (request: { messages: { role: string; content?: unknown }[] }) => ScriptedReply
}) {
  const root = await tmpdir()
  const scope = Effect.runSync(Scope.make())
  const handler = await Effect.runPromise(
    ServerFetch.make({
      app: { version: "test" },
      database: { path: path.join(root.path, "opencode.db") },
      models: { fetch: false },
      fs: { filewatcher: false },
      instructions: { claude: false },
      config: {
        directory: input.directory,
        project: false,
        claude: false,
        content: JSON.stringify({
          model: "scripted/model",
          experimental: { widgets: true },
          providers: {
            scripted: {
              name: "Scripted",
              package: "@opencode/ai/providers/openai-compatible",
              settings: { baseURL: LLM, apiKey: "test" },
              models: { model: { name: "Scripted model", capabilities: { tools: true } } },
            },
          },
        }),
      },
      fetch: async (request: Request | string | URL, init?: RequestInit) => {
        const target = new Request(request, init)
        if (!target.url.startsWith(LLM)) return fetch(target)
        return stream(input.reply(await target.json()))
      },
    }).pipe(Scope.provide(scope), Effect.provide(Logger.layer([], { mergeWithExisting: false }))),
  )
  const server = Bun.serve({ port: 0, fetch: (request) => handler(request) })
  const api = OpenCode.make({ baseUrl: server.url.toString() })
  return {
    url: server.url.toString(),
    api,
    async [Symbol.asyncDispose]() {
      await server.stop(true)
      await Effect.runPromise(Scope.close(scope, Exit.void))
      await root[Symbol.asyncDispose]()
    },
  }
}

function stream(reply: ScriptedReply) {
  const chunk = (delta: unknown, finish: string | null = null) =>
    `data: ${JSON.stringify({ id: "chatcmpl-test", object: "chat.completion.chunk", created: 0, model: "model", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
  const body =
    "tool" in reply
      ? chunk({
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: "call_widget",
              type: "function",
              function: { name: reply.tool.name, arguments: JSON.stringify(reply.tool.input) },
            },
          ],
        }) + chunk({}, "tool_calls")
      : chunk({ role: "assistant", content: reply.text }) + chunk({}, "stop")
  return new Response(body + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } })
}
