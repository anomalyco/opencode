/**
 * Kimi K2.6 Usage Example
 *
 * This example demonstrates how to use the Moonshot provider
 * with Kimi K2.6 models for various coding tasks.
 */

import { Effect, Layer, Schema, Stream } from "effect"
import { LLM, LLMClient, Tool } from "@cedric/llm"
import { RequestExecutor, WebSocketExecutor } from "@cedric/llm/route"
import { Moonshot } from "@cedric/llm/providers"

// Configure the Moonshot provider with your API key
const moonshot = Moonshot.configure({
  apiKey: process.env.MOONSHOT_API_KEY,
})

// Example 1: Simple code generation
const simpleExample = Effect.gen(function* () {
  const model = moonshot.model("kimi-k2-6")

  const request = LLM.request({
    model,
    system: "You are an expert TypeScript developer.",
    prompt: "Write a function to reverse a string with proper TypeScript types.",
    generation: { maxTokens: 500 },
  })

  const response = yield* LLMClient.generate(request)
  console.log("Generated code:")
  console.log(response.text)
})

// Example 2: Complex reasoning with thinking mode
const reasoningExample = Effect.gen(function* () {
  const model = moonshot.model("kimi-k2-6-thinking")

  const request = LLM.request({
    model,
    system: `You are an expert software architect.
Think through complex problems step by step.
Explain your reasoning before providing solutions.`,
    prompt: `I have a Node.js application with performance issues.
The app handles 10K requests per second but response times are increasing.
What are potential bottlenecks and how should I diagnose them?`,
    generation: { maxTokens: 2000 },
    providerOptions: {
      openai: {
        reasoningEffort: "high",
      },
    },
  })

  const response = yield* LLMClient.generate(request)
  console.log("\nReasoning and solution:")
  console.log(response.text)
})

// Example 3: Multimodal with vision model
const visionExample = Effect.gen(function* () {
  const model = moonshot.model("kimi-k2-6-vision")

  const request = LLM.request({
    model,
    system: "You are a UI/UX expert.",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Analyze this UI screenshot and suggest improvements:" },
          { type: "media", mediaType: "image/png", data: "AAECAw==" },
        ],
      },
    ],
    generation: { maxTokens: 1000 },
  })

  const response = yield* LLMClient.generate(request)
  console.log("\nUI Analysis:")
  console.log(response.text)
})

// Example 4: Streaming response
const streamingExample = Effect.gen(function* () {
  const model = moonshot.model("kimi-k2-6")

  const request = LLM.request({
    model,
    system: "You are a helpful coding assistant.",
    prompt: "Explain how async/await works in JavaScript.",
    generation: { maxTokens: 1000 },
  })

  yield* LLM.stream(request).pipe(
    Stream.tap((event) =>
      Effect.sync(() => {
        if (event.type === "text-delta") process.stdout.write(event.text)
      }),
    ),
    Stream.runDrain,
  )
})

// Example 5: Tool usage
const toolExample = Effect.gen(function* () {
  const model = moonshot.model("kimi-k2-6")

  const request = LLM.request({
    model,
    system: "You have access to file system tools.",
    prompt: "Read the package.json file and tell me what dependencies are used.",
    tools: Tool.toDefinitions({
      read_file: Tool.make({
        description: "Read a file from the filesystem",
        parameters: Schema.Struct({ path: Schema.String }),
        success: Schema.Struct({ contents: Schema.String }),
      }),
    }),
    generation: { maxTokens: 1000 },
  })

  const response = yield* LLMClient.generate(request)
  console.log("\nTool result:")
  console.log(response.text)
})

// Run examples
const program = Effect.gen(function* () {
  console.log("=== Example 1: Simple Code Generation ===")
  yield* simpleExample

  console.log("\n=== Example 2: Complex Reasoning ===")
  yield* reasoningExample

  console.log("\n=== Example 3: Streaming ===")
  yield* streamingExample

  console.log("\n=== Example 4: Tool Usage ===")
  yield* toolExample
})

const requestExecutorLayer = RequestExecutor.defaultLayer
const llmDeps = Layer.mergeAll(requestExecutorLayer, WebSocketExecutor.layer)
const llmClientLayer = LLMClient.layer.pipe(Layer.provide(llmDeps))

// Execute with proper layer
Effect.runPromise(program.pipe(Effect.provide(Layer.mergeAll(llmDeps, llmClientLayer))))
  .then(() => console.log("\nAll examples completed!"))
  .catch((error) => console.error("Error:", error))
