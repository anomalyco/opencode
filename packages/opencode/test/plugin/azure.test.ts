import { expect, test } from "bun:test"
import { AzureAuthPlugin } from "@/plugin/azure"

const pluginInput = {
  client: {} as never,
  project: {} as never,
  directory: "",
  worktree: "",
  experimental_workspace: {
    register() {},
  },
  serverUrl: new URL("https://example.com"),
  $: {} as never,
}

function makeHookInput(overrides: {
  providerID?: string
  apiId?: string
  npm?: string
  baseURL?: string
  reasoning?: boolean
}) {
  return {
    sessionID: "s",
    agent: "a",
    provider: {
      source: "config" as const,
      info: {} as never,
      options: {
        baseURL: overrides.baseURL ?? "https://psff-1.services.ai.azure.com/api/projects/psff/openai/v1",
      },
    },
    message: {} as never,
    model: {
      providerID: overrides.providerID ?? "azure-foundry",
      api: {
        id: overrides.apiId ?? "gpt-5.4",
        url: "",
        npm: overrides.npm ?? "@ai-sdk/openai-compatible",
      },
      capabilities: {
        reasoning: overrides.reasoning ?? true,
        temperature: false,
        attachment: true,
        toolcall: true,
        input: { text: true, audio: false, image: false, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
    } as never,
  }
}

function makeHookOutput() {
  return {
    temperature: 0,
    topP: 1,
    topK: 0,
    maxOutputTokens: 32_000 as number | undefined,
    options: { reasoningSummary: "auto" },
  }
}

test("omits Azure-incompatible GPT-5 chat params for Azure Foundry custom providers", async () => {
  const hooks = await AzureAuthPlugin(pluginInput)
  const out = makeHookOutput()
  await hooks["chat.params"]!(makeHookInput({}), out)
  expect(out.maxOutputTokens).toBeUndefined()
  expect(out.options.reasoningSummary).toBeUndefined()
})

test("keeps GPT-5 params for non-Azure OpenAI-compatible providers", async () => {
  const hooks = await AzureAuthPlugin(pluginInput)
  const out = makeHookOutput()
  await hooks["chat.params"]!(
    makeHookInput({
      baseURL: "https://api.openrouter.ai/v1",
    }),
    out,
  )
  expect(out.maxOutputTokens).toBe(32_000)
  expect(out.options.reasoningSummary).toBe("auto")
})

test("keeps params for non-GPT-5 Azure OpenAI-compatible models", async () => {
  const hooks = await AzureAuthPlugin(pluginInput)
  const out = makeHookOutput()
  await hooks["chat.params"]!(
    makeHookInput({
      apiId: "gpt-4o",
      reasoning: false,
    }),
    out,
  )
  expect(out.maxOutputTokens).toBe(32_000)
  expect(out.options.reasoningSummary).toBe("auto")
})
