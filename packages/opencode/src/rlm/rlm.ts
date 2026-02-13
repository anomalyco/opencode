/**
 * RLM Core Engine - TypeScript port of rlm/core/rlm.py
 *
 * This is the main Recursive Language Model implementation.
 * It orchestrates the iterative loop:
 *   1. Send message history to the LLM
 *   2. Parse response for ```repl``` code blocks
 *   3. Execute code blocks in the Python REPL
 *   4. Check for FINAL()/FINAL_VAR() termination
 *   5. Format iteration results and append to history
 *   6. Repeat until final answer or max iterations
 *
 * Integration with OpenCode:
 * - Uses OpenCode's Provider system to get LanguageModelV2 instances
 * - Uses Vercel AI SDK's generateText() for LLM completions
 * - The REPL's llm_query() calls are routed through the same provider system
 */

import { generateText } from "ai"
import { Provider } from "@/provider/provider"
import { Log } from "@/util/log"
import { LocalREPL } from "./environment"
import { findCodeBlocks, findFinalAnswerAsync, formatIteration } from "./parsing"
import { RLM_SYSTEM_PROMPT, buildRLMSystemPrompt, buildUserPrompt } from "./prompts"
import type {
  CodeBlock,
  RLMChatCompletion,
  RLMConfig,
  RLMIteration,
  REPLResult,
  UsageSummary,
} from "./types"
import { buildQueryMetadata, DEFAULT_RLM_CONFIG, emptyUsageSummary, mergeUsageSummaries } from "./types"

const log = Log.create({ service: "rlm" })

// ============================================================
// RLM Engine
// ============================================================

/**
 * Lifecycle hooks for observing the RLM loop.
 * Used by provider.ts to emit stream parts during iteration.
 */
export interface RLMLoopHooks {
  /** Called at the start of each iteration (before the LLM call). */
  onIterationStart?: (iterationIndex: number) => void | Promise<void>
  /** Called after the LLM responds, with the raw response text. */
  onLLMResponse?: (iterationIndex: number, response: string) => void | Promise<void>
  /** Called after each code block is executed. */
  onCodeExecuted?: (iterationIndex: number, code: string, result: REPLResult) => void | Promise<void>
  /** Called when an iteration completes (after final answer check). */
  onIterationEnd?: (iteration: RLMIteration, iterationIndex: number) => void | Promise<void>
  /** Called when max iterations is reached (before the default-answer LLM call). */
  onMaxIterationsReached?: (maxIterations: number) => void | Promise<void>
}

export interface RLMCompletionInput {
  /** The prompt/context to process */
  prompt: string | Record<string, unknown> | unknown[]
  /** Optional root prompt visible to the LLM (e.g., the user's question) */
  rootPrompt?: string
  /** The model to use for the main RLM loop */
  model: Provider.Model
  /** Optional different model for sub-LLM queries from inside the REPL */
  subModel?: Provider.Model
  /** RLM configuration overrides */
  config?: Partial<RLMConfig>
  /** Abort signal */
  abort?: AbortSignal
  /** Callback for streaming iteration updates (legacy, prefer hooks) */
  onIteration?: (iteration: RLMIteration, index: number) => void
  /** Lifecycle hooks for fine-grained observation of the RLM loop */
  hooks?: RLMLoopHooks
  /** Optional pre-existing REPL instance (for shared REPL across sub-agents).
   *  When provided, the REPL is NOT cleaned up on completion — the caller owns its lifecycle. */
  repl?: LocalREPL
}

export interface RLMCompletionOutput {
  response: string
  usageSummary: UsageSummary
  executionTime: number
  iterations: number
}

/**
 * Main RLM completion function.
 *
 * This replaces the Python RLM.completion() method with a native TypeScript
 * implementation that integrates with OpenCode's provider system.
 */
export async function rlmCompletion(input: RLMCompletionInput): Promise<RLMCompletionOutput> {
  const config = { ...DEFAULT_RLM_CONFIG, ...input.config }
  const startTime = performance.now()

  log.info("rlm.completion.start", {
    modelID: input.model.id,
    providerID: input.model.providerID,
    maxIterations: config.maxIterations,
    maxDepth: config.maxDepth,
  })

  // If at max depth, fall back to a simple LLM call
  if (config.depth >= config.maxDepth) {
    return fallbackAnswer(input)
  }

  // Get the language model for the main loop
  const language = await Provider.getLanguage(input.model)

  // Get the sub-model language (for llm_query() inside REPL)
  const subLanguage = input.subModel ? await Provider.getLanguage(input.subModel) : language
  const subModel = input.subModel ?? input.model

  // Track total usage
  let totalUsage = emptyUsageSummary()

  // Create the LLM query handler for the REPL
  const llmQueryHandler = async (prompt: string, _model?: string): Promise<string> => {
    try {
      const result = await generateText({
        model: subLanguage,
        messages: [{ role: "user", content: prompt }],
        abortSignal: input.abort,
      })

      // Track usage
      if (result.usage) {
        const modelName = subModel.id
        totalUsage = mergeUsageSummaries(totalUsage, {
          modelUsageSummaries: {
            [modelName]: {
              totalCalls: 1,
              totalInputTokens: result.usage.inputTokens ?? 0,
              totalOutputTokens: result.usage.outputTokens ?? 0,
            },
          },
        })
      }

      return result.text
    } catch (error) {
      log.error("rlm.llm_query.error", { error })
      return `Error: LLM query failed - ${error}`
    }
  }

  // Create batched handler
  const llmQueryBatchedHandler = async (prompts: string[], _model?: string): Promise<string[]> => {
    try {
      const results = await Promise.all(
        prompts.map((prompt) =>
          generateText({
            model: subLanguage,
            messages: [{ role: "user", content: prompt }],
            abortSignal: input.abort,
          }),
        ),
      )

      // Track usage for all calls
      for (const result of results) {
        if (result.usage) {
          totalUsage = mergeUsageSummaries(totalUsage, {
            modelUsageSummaries: {
              [subModel.id]: {
                totalCalls: 1,
                totalInputTokens: result.usage.inputTokens ?? 0,
                totalOutputTokens: result.usage.outputTokens ?? 0,
              },
            },
          })
        }
      }

      return results.map((r) => r.text)
    } catch (error) {
      log.error("rlm.llm_query_batched.error", { error })
      return prompts.map(() => `Error: LLM query failed - ${error}`)
    }
  }

  // Create and start the REPL environment, or use the provided one
  const externalRepl = !!input.repl
  const repl = input.repl ?? new LocalREPL({
    llmQueryHandler,
    llmQueryBatchedHandler,
    contextPayload: input.prompt as string | Record<string, unknown> | unknown[],
  })

  try {
    if (!externalRepl) {
      await repl.start()
    } else {
      // For shared REPLs, load the prompt as additional context
      await repl.loadContext(input.prompt as string | Record<string, unknown> | unknown[])
    }

    // Build initial message history
    const queryMetadata = buildQueryMetadata(input.prompt)
    let messageHistory = buildRLMSystemPrompt(
      config.customSystemPrompt ?? RLM_SYSTEM_PROMPT,
      queryMetadata,
    )

    const hooks = input.hooks

    // Main iteration loop
    for (let i = 0; i < config.maxIterations; i++) {
      if (input.abort?.aborted) {
        throw new Error("RLM completion aborted")
      }

      await hooks?.onIterationStart?.(i)

      // Build current prompt
      const currentPrompt = [
        ...messageHistory,
        buildUserPrompt(input.rootPrompt, i, repl.getContextCount()),
      ]

      // Single completion turn (with hooks for fine-grained observation)
      const iteration = await completionTurn({
        prompt: currentPrompt,
        language,
        model: input.model,
        repl,
        abort: input.abort,
        totalUsage,
        onUsageUpdate: (u) => {
          totalUsage = u
        },
        hooks: {
          onLLMResponse: hooks?.onLLMResponse
            ? (response) => hooks.onLLMResponse!(i, response)
            : undefined,
          onCodeExecuted: hooks?.onCodeExecuted
            ? (code, result) => hooks.onCodeExecuted!(i, code, result)
            : undefined,
        },
      })

      // Check for final answer — first from in-code FINAL()/FINAL_VAR() calls,
      // then from text-level FINAL()/FINAL_VAR() patterns
      let finalAnswer: string | undefined
      if (repl.hasFinalAnswer()) {
        finalAnswer = repl.getFinalAnswer()
        repl.resetFinalAnswer()
      } else {
        finalAnswer = await findFinalAnswerAsync(
          iteration.response,
          (code) => repl.executeCode(code),
        )
      }
      iteration.finalAnswer = finalAnswer

      // Notify callbacks
      await hooks?.onIterationEnd?.(iteration, i)
      input.onIteration?.(iteration, i + 1)

      log.info("rlm.iteration", {
        iteration: i + 1,
        hasFinalAnswer: finalAnswer !== undefined,
        codeBlocks: iteration.codeBlocks.length,
      })

      if (finalAnswer !== undefined) {
        const executionTime = (performance.now() - startTime) / 1000
        log.info("rlm.completion.done", {
          iterations: i + 1,
          executionTime,
        })

        return {
          response: finalAnswer,
          usageSummary: totalUsage,
          executionTime,
          iterations: i + 1,
        }
      }

      // Format iteration for next prompt
      const newMessages = formatIteration(iteration)
      messageHistory = [...messageHistory, ...newMessages]
    }

    // Ran out of iterations — ask for a final answer
    await hooks?.onMaxIterationsReached?.(config.maxIterations)
    log.warn("rlm.max_iterations_reached", { maxIterations: config.maxIterations })
    const defaultAnswer = await getDefaultAnswer({
      messageHistory,
      language,
      model: input.model,
      abort: input.abort,
      totalUsage,
      onUsageUpdate: (u) => {
        totalUsage = u
      },
    })

    const executionTime = (performance.now() - startTime) / 1000
    return {
      response: defaultAnswer,
      usageSummary: totalUsage,
      executionTime,
      iterations: config.maxIterations,
    }
  } finally {
    if (!externalRepl) {
      await repl.cleanup()
    }
  }
}

// ============================================================
// Internal helpers
// ============================================================

interface CompletionTurnInput {
  prompt: Array<{ role: string; content: string }>
  language: Awaited<ReturnType<typeof Provider.getLanguage>>
  model: Provider.Model
  repl: LocalREPL
  abort?: AbortSignal
  totalUsage: UsageSummary
  onUsageUpdate: (usage: UsageSummary) => void
  hooks?: {
    onLLMResponse?: (response: string) => void | Promise<void>
    onCodeExecuted?: (code: string, result: REPLResult) => void | Promise<void>
  }
}

/**
 * Perform a single iteration: LLM call + code execution.
 */
async function completionTurn(input: CompletionTurnInput): Promise<RLMIteration> {
  const iterStart = performance.now()

  // Call the LLM
  const result = await generateText({
    model: input.language,
    messages: input.prompt.map((m) => ({
      role: m.role as "system" | "user" | "assistant",
      content: m.content,
    })),
    abortSignal: input.abort,
  })

  // Track usage
  if (result.usage) {
    input.onUsageUpdate(
      mergeUsageSummaries(input.totalUsage, {
        modelUsageSummaries: {
          [input.model.id]: {
            totalCalls: 1,
            totalInputTokens: result.usage.inputTokens ?? 0,
            totalOutputTokens: result.usage.outputTokens ?? 0,
          },
        },
      }),
    )
  }

  const response = result.text

  // Notify hook of LLM response
  await input.hooks?.onLLMResponse?.(response)

  // Find and execute code blocks
  const codeBlockStrs = findCodeBlocks(response)
  const codeBlocks: CodeBlock[] = []

  for (const codeStr of codeBlockStrs) {
    const codeResult = await input.repl.executeCode(codeStr)
    codeBlocks.push({ code: codeStr, result: codeResult })
    await input.hooks?.onCodeExecuted?.(codeStr, codeResult)
  }

  return {
    prompt: input.prompt,
    response,
    codeBlocks,
    iterationTime: (performance.now() - iterStart) / 1000,
  }
}

/**
 * Fallback when at max depth — just do a simple LLM call.
 */
async function fallbackAnswer(input: RLMCompletionInput): Promise<RLMCompletionOutput> {
  const startTime = performance.now()
  const language = await Provider.getLanguage(input.model)

  const promptStr = typeof input.prompt === "string" ? input.prompt : JSON.stringify(input.prompt)
  const result = await generateText({
    model: language,
    messages: [{ role: "user", content: promptStr }],
    abortSignal: input.abort,
  })

  return {
    response: result.text,
    usageSummary: {
      modelUsageSummaries: {
        [input.model.id]: {
          totalCalls: 1,
          totalInputTokens: result.usage?.inputTokens ?? 0,
          totalOutputTokens: result.usage?.outputTokens ?? 0,
        },
      },
    },
    executionTime: (performance.now() - startTime) / 1000,
    iterations: 0,
  }
}

interface DefaultAnswerInput {
  messageHistory: Array<{ role: string; content: string }>
  language: Awaited<ReturnType<typeof Provider.getLanguage>>
  model: Provider.Model
  abort?: AbortSignal
  totalUsage: UsageSummary
  onUsageUpdate: (usage: UsageSummary) => void
}

/**
 * Get a default answer when max iterations are reached.
 */
async function getDefaultAnswer(input: DefaultAnswerInput): Promise<string> {
  const messages = [
    ...input.messageHistory,
    {
      role: "assistant" as const,
      content: "Please provide a final answer to the user's question based on the information provided.",
    },
  ]

  const result = await generateText({
    model: input.language,
    messages: messages.map((m) => ({
      role: m.role as "system" | "user" | "assistant",
      content: m.content,
    })),
    abortSignal: input.abort,
  })

  if (result.usage) {
    input.onUsageUpdate(
      mergeUsageSummaries(input.totalUsage, {
        modelUsageSummaries: {
          [input.model.id]: {
            totalCalls: 1,
            totalInputTokens: result.usage.inputTokens ?? 0,
            totalOutputTokens: result.usage.outputTokens ?? 0,
          },
        },
      }),
    )
  }

  return result.text
}
