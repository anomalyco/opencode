import { describe, expect, test } from "bun:test"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import { Effect } from "effect"
import { ModelV2 } from "@opencode-ai/core/model"
import { Provider } from "../../src/provider/provider"
import { ProviderTest } from "../fake/provider"
import {
  formatRollCallJson,
  formatRollCallMarkdown,
  formatRollCallIntro,
  formatRollCallProgress,
  formatRollCallSummary,
  formatRollCallTable,
  isTextModel,
  matchingModels,
  runRollCall,
  validateRollCallOptions,
} from "../../src/cli/cmd/roll-call"

const result = {
  model: "test/model|one",
  success: true,
  snippet: "hello | world\nnext",
  latency: 12,
  errorType: null,
  errorMessage: null,
}

const failed = {
  model: "test/failed",
  success: false,
  snippet: "",
  latency: 345,
  errorType: "ProviderError",
  errorMessage: "provider failed badly",
}

function testProvider(models: Provider.Model[]): Provider.Interface {
  const first = models[0]
  return {
    list: () => Effect.succeed({}),
    getProvider: () => Effect.succeed(ProviderTest.info({}, first)),
    getModel: () => Effect.succeed(first),
    getLanguage: () => Effect.succeed({} as LanguageModelV3),
    closest: () => Effect.succeed(undefined),
    getSmallModel: () => Effect.succeed(first),
    defaultModel: () => Effect.succeed({ providerID: first.providerID, modelID: first.id }),
  }
}

describe("roll-call", () => {
  test("requires valid filter, timeout, and parallel options", () => {
    expect(validateRollCallOptions({ filter: "", timeout: 1, parallel: 1 })).toBeDefined()
    expect(validateRollCallOptions({ filter: "[", timeout: 1, parallel: 1 })).toContain("Invalid")
    expect(validateRollCallOptions({ filter: "model", timeout: 0, parallel: 1 })).toContain("timeout")
    expect(validateRollCallOptions({ filter: "model", timeout: 1, parallel: 0 })).toContain("parallel")
    expect(validateRollCallOptions({ filter: "MODEL", timeout: 1, parallel: 1 })).toBeUndefined()
  })

  test("filters case-insensitively and excludes non-text models", () => {
    const text = ProviderTest.model({ id: ModelV2.ID.make("Text-Model") })
    const image = ProviderTest.model({
      id: ModelV2.ID.make("Image-Model"),
      capabilities: { ...text.capabilities, input: { ...text.capabilities.input, text: false } },
    })
    const providers = ProviderTest.info({ models: { [text.id]: text, [image.id]: image } })

    expect(matchingModels({ [providers.id]: providers }, /text/i).map((model) => model.id)).toEqual([
      ModelV2.ID.make("Text-Model"),
    ])
    expect(isTextModel(image)).toBe(false)
  })

  test("runs calls with bounded concurrency and deterministic ordering", async () => {
    const models = ["slow", "fast", "middle"].map((id) => ProviderTest.model({ id: ModelV2.ID.make(id) }))
    let active = 0
    let maximum = 0

    const results = await Effect.runPromise(
      runRollCall({
        provider: testProvider(models),
        models,
        prompt: "Hello",
        timeout: 1_000,
        parallel: 2,
        probe: async (_language, model) => {
          active++
          maximum = Math.max(maximum, active)
          await new Promise((resolve) => setTimeout(resolve, model.id === "slow" ? 30 : 5))
          active--
          return model.id
        },
      }),
    )

    expect(maximum).toBe(2)
    expect(results.map((item) => item.model)).toEqual(["openai/fast", "openai/middle", "openai/slow"])
    expect(results.map((item) => item.snippet)).toEqual(["fast", "middle", "slow"])
  })

  test("records provider failures and timeouts", async () => {
    const models = [
      ProviderTest.model({ id: ModelV2.ID.make("error") }),
      ProviderTest.model({ id: ModelV2.ID.make("timeout") }),
    ]
    const results = await Effect.runPromise(
      runRollCall({
        provider: testProvider(models),
        models,
        prompt: "Hello",
        timeout: 10,
        parallel: 2,
        probe: (_language, model) => {
          if (model.id === "error") return Promise.reject(new Error("provider failed"))
          return new Promise(() => {})
        },
      }),
    )

    expect(results[0]).toMatchObject({ success: false, errorType: "Error", errorMessage: "provider failed" })
    expect(results[1]).toMatchObject({ success: false, errorType: "timeout" })
  })

  test("keeps JSON and Markdown output structured and safe", () => {
    expect(JSON.parse(formatRollCallJson([result]))[0].snippet).toBe(result.snippet)
    expect(JSON.parse(formatRollCallJson([failed]))[0]).toMatchObject({
      errorType: failed.errorType,
      errorMessage: failed.errorMessage,
    })
    expect(formatRollCallTable([result])).toContain("hello | world next")
    expect(formatRollCallMarkdown([result])).toContain("model\\|one")
    expect(formatRollCallMarkdown([result])).not.toContain("\nnext")
  })

  test("uses the four-column human table and renders failures in the snippet column", () => {
    const output = formatRollCallTable([result, failed], { width: 80, color: false })
    expect(
      output
        .split("\n")[0]
        .split(" | ")
        .map((cell) => cell.trim()),
    ).toEqual(["Model", "Access", "Snippet", "Latency"])
    expect(output).toContain("YES")
    expect(output).toContain("NO")
    expect(output).toContain("(provider failed badly)")
    expect(output).not.toContain("ProviderError")
    expect(output).not.toContain("Error Type")
  })

  test("fits narrow terminals and truncates snippets after sanitizing control characters", () => {
    const narrow = formatRollCallTable(
      [
        {
          ...result,
          model: "provider/a-model-with-a-very-long-name",
          snippet: "\u001b[31mThis is a very long snippet\u001b[0m\nwith controls",
        },
        {
          ...failed,
          errorMessage: "\u001b[33mThis is a very long failure message\u001b[0m\nwith controls",
        },
      ],
      { width: 40, color: false },
    )
    narrow
      .trimEnd()
      .split("\n")
      .forEach((line) => expect(line.length).toBeLessThanOrEqual(40))
    expect(narrow).not.toContain("\u001b")
    expect(narrow).toContain("…")
    expect(narrow).not.toContain("\nwith controls")
  })

  test("colors human rows, progress, and counts only when styling is enabled", () => {
    const colored = formatRollCallTable([result, failed], { width: 80, color: true })
    expect(colored).toContain("\u001b[92m")
    expect(colored).toContain("\u001b[91m")
    expect(formatRollCallTable([result, failed], { width: 80, color: false })).not.toContain("\u001b[")

    expect(formatRollCallIntro("Hello", 25000, 5, 2, false)).toBe(
      'Starting roll call for models with prompt: "Hello"\nTimeout per model: 25000ms, Parallel calls: 5\nPrompting 2 models...\n',
    )
    expect(formatRollCallIntro("Hello", 25000, 5, 2, true)).toContain(
      '\u001b[96mStarting roll call for models with prompt: "Hello"',
    )
    expect(formatRollCallProgress(result, true)).toContain("\u001b[92m✔")
    expect(formatRollCallProgress(failed, true)).toContain("\u001b[91m✘")
    expect(formatRollCallProgress(result, false)).not.toContain("\u001b[")
    expect(formatRollCallSummary([result, failed], true)).toContain("Accessible: 1")
    expect(formatRollCallSummary([result, failed], true)).toContain("Failed: 1")
    expect(formatRollCallSummary([result, failed], false)).not.toContain("\u001b[")
  })
})
