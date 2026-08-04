export * as ResultCompressor from "./result-compressor"

/**
 * result-compressor.ts
 *
 * Compresses large subagent task results via a real LLM call before injecting
 * them into the parent session context.
 *
 * Uses the same LLM.Service.stream() pattern as session/prompt.ts and
 * session/llm.ts. Token budgets are fully dynamic — no hardcoded constants.
 */
import { Context, Effect, Layer } from "effect"
import * as Stream from "effect/Stream"
import { LLMEvent } from "@opencode-ai/llm"
import { LLM } from "@/session/llm"
import type { Provider } from "@/provider/provider"
import type { Agent } from "@/agent/agent"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { Token } from "@opencode-ai/core/util/token"
import { serviceUse } from "@opencode-ai/core/effect/service-use"

// Target at most 8% of the model's context window per injected task result
const COMPRESSION_RATIO = 0.08

const COMPRESS_SYSTEM = `You are a task-result compressor for an AI coding assistant.
Produce a dense, structured Markdown summary of the subagent task result provided.
Preserve every actionable fact: file paths, symbol names, error messages, exact values,
decisions and their rationale, commands, URLs, and test outcomes.
Omit: verbose narration, repetitive tool-call logs, raw file dumps irrelevant to the
objective, and intermediate "I will now…" phrases.
Use terse bullet points, not paragraphs. Never mention the compression process itself.`

const compressPrompt = (text: string) =>
  `Compress the following subagent task result into a dense structured Markdown summary:\n\n<task_result>\n${text}\n</task_result>`

export interface CompressInput {
  /** Raw text returned by the subagent task */
  readonly text: string
  /** Already-resolved provider model used by the parent session */
  readonly model: Provider.Model
  /** The agent whose session produced this result (used for LLM.stream identity) */
  readonly agentInfo: Agent.Info
  /** Parent session user record for LLM auth resolution */
  readonly user: SessionV1.User
  /** Context window size of the model (tokens) */
  readonly contextLimit: number
  /** Max output tokens for the model */
  readonly outputLimit: number
  /** Parent session ID for telemetry */
  readonly sessionID: string
}

export interface Interface {
  readonly compress: (input: CompressInput) => Effect.Effect<string>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ResultCompressor") {}

export const use = serviceUse(Service)

const live: Layer.Layer<Service, never, LLM.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const llm = yield* LLM.Service

    const compress = (input: CompressInput): Effect.Effect<string> =>
      Effect.gen(function* () {
        const tokenBudget = Math.max(Math.floor(input.contextLimit * COMPRESSION_RATIO), 500)

        // Fast path: result already fits within budget — no LLM call needed
        if (Token.estimate(input.text) <= tokenBudget) return input.text

        const summaryMaxTokens = Math.min(tokenBudget, input.outputLimit || tokenBudget)
        const prompt = compressPrompt(input.text)

        // Safety guard: if the prompt itself is too large for the model, truncate instead
        if (Token.estimate(prompt) > input.contextLimit - summaryMaxTokens) {
          const maxChars = tokenBudget * 4
          const headChars = Math.floor(maxChars * 0.25)
          const tailChars = Math.floor(maxChars * 0.65)
          const omitted = input.text.length - headChars - tailChars
          return [
            input.text.slice(0, headChars),
            `\n\n[… ${omitted} chars omitted — result exceeded compression model capacity …]\n\n`,
            input.text.slice(-tailChars),
          ].join("")
        }

        const chunks: string[] = []
        let failed = false

        yield* llm
          .stream({
            model: input.model,
            agent: input.agentInfo,
            user: input.user,
            sessionID: input.sessionID,
            system: [COMPRESS_SYSTEM],
            messages: [{ role: "user", content: prompt }],
            tools: {},
            small: true,
            retries: 1,
          })
          .pipe(
            Stream.runForEach((event) =>
              Effect.sync(() => {
                if (LLMEvent.is.providerError(event)) failed = true
                if (LLMEvent.is.textDelta(event)) chunks.push(event.text)
              }),
            ),
            // Never let a compression failure bubble up — degrade gracefully
            Effect.catchCause(() => Effect.void),
          )

        const summary = chunks.join("").trim()

        // If the LLM call failed or returned nothing, keep the original text
        if (failed || !summary) return input.text

        return summary
      })

    return Service.of({ compress })
  }),
)

import { LayerNode } from "@opencode-ai/core/effect/layer-node"

export const node = LayerNode.make({ service: Service, layer: live, deps: [LLM.node] })
