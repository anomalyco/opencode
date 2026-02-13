import { describe, expect, test, mock } from "bun:test"
import type { LanguageModelV2, LanguageModelV2CallOptions } from "@ai-sdk/provider"
import { generateText } from "ai"
import { LocalREPL } from "../../src/rlm/environment"
import { findCodeBlocks, findFinalAnswerAsync, formatIteration } from "../../src/rlm/parsing"
import { RLM_SYSTEM_PROMPT, buildRLMSystemPrompt, buildUserPrompt } from "../../src/rlm/prompts"
import { buildQueryMetadata, DEFAULT_RLM_CONFIG } from "../../src/rlm/types"
import type { CodeBlock, RLMIteration } from "../../src/rlm/types"

/**
 * Full RLM flow integration tests.
 *
 * These tests exercise the complete RLM loop:
 *   LLM call -> parse code blocks -> execute in JS REPL -> check for FINAL -> repeat
 *
 * We use a mock LanguageModelV2 that returns scripted responses to simulate
 * a real LLM without needing API keys or network access.
 */

// ============================================================
// Mock LanguageModelV2 factory
// ============================================================

function createMockLanguageModel(responses: string[]): LanguageModelV2 {
  let callIndex = 0

  return {
    specificationVersion: "v2",
    provider: "mock",
    modelId: "mock-model",
    supportedUrls: {},

    async doGenerate(options: LanguageModelV2CallOptions) {
      const response = responses[callIndex] ?? "FINAL(No more responses)"
      callIndex++
      return {
        content: [{ type: "text" as const, text: response }],
        finishReason: "stop" as const,
        usage: {
          inputTokens: 10,
          outputTokens: response.length,
          totalTokens: 10 + response.length,
        },
        warnings: [],
      }
    },

    async doStream(options: LanguageModelV2CallOptions) {
      const response = responses[callIndex] ?? "FINAL(No more responses)"
      callIndex++

      const parts = [
        { type: "text-start" as const, id: "t-1" },
        { type: "text-delta" as const, id: "t-1", delta: response },
        { type: "text-end" as const, id: "t-1" },
        {
          type: "finish" as const,
          finishReason: "stop" as const,
          usage: { inputTokens: 10, outputTokens: response.length, totalTokens: 10 + response.length },
        },
      ]

      const stream = new ReadableStream({
        start(controller) {
          for (const part of parts) {
            controller.enqueue(part)
          }
          controller.close()
        },
      })

      return { stream, request: undefined, response: undefined }
    },
  }
}

// ============================================================
// Simulated RLM loop (mirrors runRLMLoop without Provider deps)
// ============================================================

async function simulateRLMLoop(opts: {
  prompt: string
  model: LanguageModelV2
  subModel?: LanguageModelV2
  maxIterations?: number
}): Promise<{ finalAnswer: string; iterations: number; allIterations: RLMIteration[] }> {
  const maxIterations = opts.maxIterations ?? 10
  const subModel = opts.subModel ?? opts.model

  const llmQueryHandler = async (p: string): Promise<string> => {
    const result = await generateText({
      model: subModel,
      messages: [{ role: "user", content: p }],
    })
    return result.text
  }

  const repl = new LocalREPL({
    llmQueryHandler,
    contextPayload: opts.prompt,
  })

  try {
    await repl.start()

    const queryMetadata = buildQueryMetadata(opts.prompt)
    let messageHistory = buildRLMSystemPrompt(RLM_SYSTEM_PROMPT, queryMetadata)
    const allIterations: RLMIteration[] = []

    for (let i = 0; i < maxIterations; i++) {
      const currentPrompt = [...messageHistory, buildUserPrompt(undefined, i, repl.getContextCount())]

      const result = await generateText({
        model: opts.model,
        messages: currentPrompt.map((m) => ({
          role: m.role as "system" | "user" | "assistant",
          content: m.content,
        })),
      })

      const response = result.text
      const codeBlockStrs = findCodeBlocks(response)
      const codeBlocks: CodeBlock[] = []

      for (const codeStr of codeBlockStrs) {
        const codeResult = await repl.executeCode(codeStr)
        codeBlocks.push({ code: codeStr, result: codeResult })
      }

      const iteration: RLMIteration = { prompt: currentPrompt, response, codeBlocks }
      const finalAnswer = await findFinalAnswerAsync(response, (code) => repl.executeCode(code))
      iteration.finalAnswer = finalAnswer
      allIterations.push(iteration)

      if (finalAnswer !== undefined) {
        return { finalAnswer, iterations: i + 1, allIterations }
      }

      messageHistory = [...messageHistory, ...formatIteration(iteration)]
    }

    return { finalAnswer: "(max iterations reached)", iterations: maxIterations, allIterations }
  } finally {
    await repl.cleanup()
  }
}

// ============================================================
// Tests
// ============================================================

describe("full RLM loop", () => {
  test("single iteration: FINAL() without code execution", async () => {
    const model = createMockLanguageModel([
      "After thinking about it, the answer is clear.\nFINAL(42)",
    ])

    const result = await simulateRLMLoop({ prompt: "What is 6*7?", model })
    expect(result.finalAnswer).toBe("42")
    expect(result.iterations).toBe(1)
    expect(result.allIterations[0].codeBlocks).toHaveLength(0)
  })

  test("two iterations: code execution then FINAL()", async () => {
    const model = createMockLanguageModel([
      // Iteration 1: execute some code
      'Let me compute this.\n```repl\nx = 6 * 7\nconsole.log(`Result: ${x}`)\n```',
      // Iteration 2: use the result and give final answer
      "Based on the computation, the answer is:\nFINAL(The result of 6*7 is 42)",
    ])

    const result = await simulateRLMLoop({ prompt: "What is 6*7?", model })
    expect(result.finalAnswer).toBe("The result of 6*7 is 42")
    expect(result.iterations).toBe(2)
    expect(result.allIterations[0].codeBlocks).toHaveLength(1)
    expect(result.allIterations[0].codeBlocks[0].result.stdout).toContain("Result: 42")
  })

  test("three iterations: multiple code blocks with variable persistence", async () => {
    const model = createMockLanguageModel([
      // Iteration 1: define a function
      "Let me define a helper function.\n```repl\nfibonacci = function(n) {\n    if (n <= 1) return n\n    return fibonacci(n - 1) + fibonacci(n - 2)\n}\n```",
      // Iteration 2: use the function
      "Now let me compute some Fibonacci numbers.\n```repl\nresults = []\nfor (let i = 0; i < 10; i++) results.push(fibonacci(i))\nconsole.log(JSON.stringify(results))\n```",
      // Iteration 3: give the final answer
      'FINAL_VAR("results")',
    ])

    const result = await simulateRLMLoop({ prompt: "Compute first 10 Fibonacci numbers", model })
    // FINAL_VAR("results") should retrieve the array from the REPL
    expect(result.finalAnswer).toContain("0,1,1,2,3,5,8,13,21,34")
    expect(result.iterations).toBe(3)
  })

  test("code execution error is handled gracefully", async () => {
    const model = createMockLanguageModel([
      // Iteration 1: code with a runtime error
      "Let me try this:\n```repl\nresult = null.property\n```",
      // Iteration 2: LLM "sees" the error and gives a corrected answer
      "I see there was an error. Let me fix that.\nFINAL(Accessing property on null throws TypeError)",
    ])

    const result = await simulateRLMLoop({ prompt: "What happens with null.property?", model })
    expect(result.finalAnswer).toBe("Accessing property on null throws TypeError")
    expect(result.iterations).toBe(2)
    // The first iteration should have captured the error
    expect(result.allIterations[0].codeBlocks[0].result.stderr).toContain("TypeError")
  })

  test("max iterations reached without FINAL", async () => {
    const model = createMockLanguageModel([
      "Step 1:\n```repl\nx = 1\n```",
      "Step 2:\n```repl\nx = x + 1\n```",
      "Step 3:\n```repl\nx = x + 1\n```",
    ])

    const result = await simulateRLMLoop({ prompt: "Count to infinity", model, maxIterations: 3 })
    expect(result.finalAnswer).toBe("(max iterations reached)")
    expect(result.iterations).toBe(3)
  })

  test("multiple code blocks in a single iteration", async () => {
    const model = createMockLanguageModel([
      'Let me do two things.\n```repl\na = 10\nconsole.log(`a = ${a}`)\n```\n\nAnd also:\n```repl\nb = 20\nconsole.log(`b = ${b}`)\n```',
      "Now I know both values.\nFINAL(a=10, b=20)",
    ])

    const result = await simulateRLMLoop({ prompt: "Set a=10 and b=20", model })
    expect(result.finalAnswer).toBe("a=10, b=20")
    expect(result.iterations).toBe(2)
    expect(result.allIterations[0].codeBlocks).toHaveLength(2)
    expect(result.allIterations[0].codeBlocks[0].result.stdout).toContain("a = 10")
    expect(result.allIterations[0].codeBlocks[1].result.stdout).toContain("b = 20")
  })

  test("llm_query() from inside REPL uses sub-model", async () => {
    // Main model orchestrates the loop
    const mainModel = createMockLanguageModel([
      // Iteration 1: ask the sub-model from inside REPL
      '```repl\nanswer = await llm_query("What is the capital of France?")\nconsole.log(answer)\n```',
      // Iteration 2: use the answer
      "FINAL(Paris is the capital)",
    ])

    // Sub-model responds to llm_query()
    const subModel = createMockLanguageModel([
      "Paris",
    ])

    const result = await simulateRLMLoop({
      prompt: "Use llm_query to find the capital of France",
      model: mainModel,
      subModel,
    })

    expect(result.finalAnswer).toBe("Paris is the capital")
    expect(result.iterations).toBe(2)
    // The first iteration should show the sub-model's response in stdout
    expect(result.allIterations[0].codeBlocks[0].result.stdout).toContain("Paris")
  })

  test("context is accessible in REPL via context_0", async () => {
    const model = createMockLanguageModel([
      '```repl\nconsole.log(`Context: ${context_0}`)\nconsole.log(`Also: ${context}`)\n```',
      "FINAL(Context was accessible)",
    ])

    const result = await simulateRLMLoop({
      prompt: "Important data here",
      model,
    })

    expect(result.finalAnswer).toBe("Context was accessible")
    expect(result.allIterations[0].codeBlocks[0].result.stdout).toContain("Important data here")
  })

  test("SHOW_VARS() works in RLM loop", async () => {
    const model = createMockLanguageModel([
      // First block: define variables
      '```repl\nx = 42\ny = "hello"\n```',
      // Second block: SHOW_VARS() can now see them
      '```repl\nconsole.log(SHOW_VARS())\n```',
      "FINAL(Variables shown)",
    ])

    const result = await simulateRLMLoop({ prompt: "Test SHOW_VARS", model })
    expect(result.finalAnswer).toBe("Variables shown")
    // SHOW_VARS is in iteration 2 (index 1), first code block
    expect(result.allIterations[1].codeBlocks[0].result.stdout).toContain("x")
    expect(result.allIterations[1].codeBlocks[0].result.stdout).toContain("y")
  })
})

// ============================================================
// System prompt construction
// ============================================================

describe("system prompt construction", () => {
  test("buildRLMSystemPrompt produces valid message array", () => {
    const metadata = buildQueryMetadata("test prompt")
    const messages = buildRLMSystemPrompt(RLM_SYSTEM_PROMPT, metadata)

    expect(messages.length).toBeGreaterThanOrEqual(1)
    expect(messages[0].role).toBe("system")
    expect(messages[0].content).toContain("REPL")
    expect(messages[0].content).toContain("JavaScript")
  })

  test("buildUserPrompt includes iteration info", () => {
    const msg = buildUserPrompt("What is 2+2?", 0, 1)
    expect(msg.role).toBe("user")
    expect(msg.content.length).toBeGreaterThan(0)
  })

  test("buildQueryMetadata handles string prompt", () => {
    const metadata = buildQueryMetadata("hello world")
    expect(metadata.contextType).toBe("str")
    expect(metadata.contextTotalLength).toBe(11)
    expect(metadata.contextLengths).toEqual([11])
  })

  test("buildQueryMetadata handles array prompt", () => {
    const metadata = buildQueryMetadata(["a", "bb", "ccc"])
    expect(metadata.contextType).toBe("list")
    expect(metadata.contextLengths).toEqual([1, 2, 3])
    expect(metadata.contextTotalLength).toBe(6)
  })

  test("buildQueryMetadata handles object prompt", () => {
    const metadata = buildQueryMetadata({ key: "value" })
    expect(metadata.contextType).toBe("dict")
    expect(metadata.contextTotalLength).toBe(5) // "value".length
  })
})
