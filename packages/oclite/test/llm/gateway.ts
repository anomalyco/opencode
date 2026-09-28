// Shared setup for gateway tests: a ResolvedConfig pointing at the local fake, and a runner for LlmGateway effects.
import { Effect, Layer, Stream } from "effect"
import type { LLMEvent } from "@opencode-ai/llm"
import { AppConfig, type Capabilities, LlmGateway, type LlmGatewayShape, type ModelHandle, type ResolvedConfig, type ServerPins, type TurnRequest } from "../../src/contract"
import { layer } from "../../src/llm/client"
import type { CapabilityPatch } from "../../src/llm/probe"
import type { LocalServer } from "../lib/local-server"

/** Every capability pinned, so no probe request consumes the fake's reply queue. Override per test. */
export const PINNED: Partial<Capabilities> = {
  context_window: 32768, usage_in_stream: true, reasoning_field: "reasoning_content", think_tags: false, tools_native: true,
  prefix_cache: true, tokenize: false, no_think_suffix: false,
  accepts: { chat_template_kwargs: true, prompt_cache_key: true, reasoning_effort: true, parallel_tool_calls: true },
}

export function config(server: LocalServer, input: { pins?: ServerPins; models?: Record<string, { limit?: { context?: number; output?: number }; reasoning?: boolean; options?: { reasoning_effort?: string } }> } = {}): ResolvedConfig {
  return {
    cwd: process.cwd(), projectRoot: process.cwd(), model: "local/test-model", default_agent: "build",
    provider: { local: { npm: "@ai-sdk/openai-compatible", options: { baseURL: server.url }, models: input.models } },
    mcp: {}, permission: [], cliRules: [], permissionMode: "default", instructions: [],
    hooks: { PreToolUse: [], PostToolUse: [], Stop: [] },
    servers: input.pins ? { [server.url]: input.pins } : {},
    agents: {}, permission_timeout_ms: 300_000, subagent: { max_depth: 2, max_concurrent: 4 }, showThinking: true,
  }
}

export function pinned(capabilities: CapabilityPatch = {}, extra: Omit<ServerPins, "capabilities"> = {}): ServerPins {
  return { ...extra, capabilities: { ...PINNED, ...capabilities, accepts: { ...PINNED.accepts!, ...capabilities.accepts } } }
}

export function withGateway<A, E>(cfg: ResolvedConfig, body: (gateway: LlmGatewayShape) => Effect.Effect<A, E>) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const gateway = yield* LlmGateway
      return yield* body(gateway)
    }).pipe(Effect.provide(layer.pipe(Layer.provide(Layer.succeed(AppConfig, cfg))))),
  )
}

export function turn(input: Partial<TurnRequest> = {}): TurnRequest {
  return {
    session_id: "ses_test", label: "main agent", system: "You are a test.", messages: [], tools: [], thinking: undefined,
    onQueued: () => Effect.void, ...input,
  }
}

export function collect(gateway: LlmGatewayShape, handle: ModelHandle, req: TurnRequest) {
  return Stream.runCollect(gateway.stream(handle, req))
}

export function joined(events: readonly LLMEvent[], type: "text-delta" | "reasoning-delta") {
  return events.flatMap((event) => (event.type === type ? [event.text] : [])).join("")
}
