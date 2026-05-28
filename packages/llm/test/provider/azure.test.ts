import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LLM } from "../../src"
import * as Azure from "../../src/providers/azure"
import { LLMClient } from "../../src/route"
import { it } from "../lib/effect"

const azureBase = "https://opencode-test.openai.azure.com/openai/v1/"

const expectRoute = (model: ReturnType<ReturnType<typeof Azure.configure>["model"]>, expected: string) =>
  Effect.gen(function* () {
    const prepared = yield* LLMClient.prepare(LLM.request({ model, prompt: "Say hello." }))
    expect(prepared.route).toBe(expected)
  })

describe("Azure model() routing", () => {
  it.effect("routes OpenAI-native model ids to the Responses endpoint by default", () =>
    expectRoute(Azure.configure({ baseURL: azureBase, apiKey: "k" }).model("gpt-4o-mini"), "azure-openai-responses"),
  )

  it.effect("routes non-OpenAI Azure AI Foundry model ids to Chat Completions by default", () =>
    expectRoute(Azure.configure({ baseURL: azureBase, apiKey: "k" }).model("DeepSeek-V4-Pro"), "azure-openai-chat"),
  )

  it.effect("treats o-series model ids as OpenAI-native (Responses)", () =>
    expectRoute(Azure.configure({ baseURL: azureBase, apiKey: "k" }).model("o3-mini"), "azure-openai-responses"),
  )

  it.effect("useCompletionUrls=true forces Chat for OpenAI-native ids", () =>
    expectRoute(
      Azure.configure({ baseURL: azureBase, apiKey: "k", useCompletionUrls: true }).model("gpt-4o-mini"),
      "azure-openai-chat",
    ),
  )

  it.effect("useCompletionUrls=false forces Responses for non-OpenAI ids", () =>
    expectRoute(
      Azure.configure({ baseURL: azureBase, apiKey: "k", useCompletionUrls: false }).model("DeepSeek-V4-Pro"),
      "azure-openai-responses",
    ),
  )
})
