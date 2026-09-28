// Minimal real implementations of contract services for runtime unit tests (not mocks of third-party code):
// a scripted LlmGateway that replays LLMEvent lists, plus handle/agent builders.
import { Effect, Stream } from "effect"
import { InvalidRequestReason, LLMError, LLMEvent, type LLMEvent as Event } from "@opencode-ai/llm"
import { configure } from "@opencode-ai/llm/providers/openai-compatible"
import type { AgentDef, LlmGatewayShape, ModelHandle, RenderEvent, TurnRequest } from "../../src/contract"
import { STATIC } from "../../src/llm/probe"

export function handle(input: { contextWindow?: number; reasoning?: boolean } = {}): ModelHandle {
  return {
    ref: "local/test-model",
    model: configure({ baseURL: "http://127.0.0.1:1/v1" }).model("test-model"),
    local: true,
    baseURL: "http://127.0.0.1:1/v1",
    capabilities: { ...STATIC, context_window: input.contextWindow ?? 32768 },
    contextWindow: input.contextWindow ?? 32768,
    maxTokens: 4096,
    reasoning: input.reasoning ?? false,
  }
}

export const agent: AgentDef = {
  name: "build",
  mode: "primary",
  permission: [],
  options: {},
  source: "builtin",
  transport: "in-process",
  max_depth: 2,
  read_only: false,
  thinking: "auto",
}

export const text = (value: string): Event[] => [
  LLMEvent.textStart({ id: "t" }),
  LLMEvent.textDelta({ id: "t", text: value }),
  LLMEvent.textEnd({ id: "t" }),
  LLMEvent.finish({ reason: "stop", usage: { inputTokens: 10, outputTokens: 2 } }),
]

export const overflowError = (message: string) =>
  new LLMError({ module: "test", method: "stream", reason: new InvalidRequestReason({ message, classification: "context-overflow" }) })

/** Each stream() call takes the next script: an event list or an LLMError. */
export function scriptedGateway(scripts: Array<Event[] | LLMError>) {
  const requests: TurnRequest[] = []
  const gateway: LlmGatewayShape = {
    resolve: () => Effect.succeed(handle()),
    stream: (_handle, req) => {
      requests.push(req)
      const next = scripts.shift() ?? text("ok")
      return next instanceof LLMError ? Stream.fail(next) : Stream.fromIterable(next)
    },
    notice: () => Effect.succeed(true),
  }
  return { gateway, requests }
}

export function collector() {
  const events: RenderEvent[] = []
  return { events, sink: (event: RenderEvent) => Effect.sync(() => void events.push(event)) }
}
