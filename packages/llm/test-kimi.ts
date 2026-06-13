import { Effect, Layer } from "effect"
import { LLM, LLMClient } from "./src/index"
import { RequestExecutor, WebSocketExecutor } from "./src/route"
import { configure } from "./src/providers/moonshot"

const moonshot = configure()

const test = Effect.gen(function* () {
  const model = moonshot.model("kimi-k2-6")

  const request = LLM.request({
    model,
    system: "You are a helpful assistant.",
    prompt: "Say 'OpenKimi is working!' in one word.",
    generation: { maxTokens: 10 },
  })

  console.log("Testing Kimi API connection...")
  const response = yield* LLMClient.generate(request)
  console.log("✅ Success! Response:", response.text)
})

const requestExecutorLayer = RequestExecutor.defaultLayer
const llmDeps = Layer.mergeAll(requestExecutorLayer, WebSocketExecutor.layer)
const llmClientLayer = LLMClient.layer.pipe(Layer.provide(llmDeps))

Effect.runPromise(test.pipe(Effect.provide(Layer.mergeAll(llmDeps, llmClientLayer))))
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Failed:", error)
    process.exit(1)
  })
