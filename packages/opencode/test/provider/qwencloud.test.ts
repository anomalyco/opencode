import { expect, test } from "bun:test"
import { Provider } from "@/provider/provider"
import { ModelsDev } from "@opencode-ai/core/models-dev"

const QWENCLOUD_API = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"

const provider = {
  id: "qwencloud",
  name: "QwenCloud",
  env: ["QWENCLOUD_API_KEY", "DASHSCOPE_API_KEY"],
  npm: "@ai-sdk/openai-compatible",
  api: QWENCLOUD_API,
  models: {
    "qwen3.8-max": {
      id: "qwen3.8-max",
      name: "Qwen3.8 Max",
      family: "qwen",
      reasoning: true,
      tool_call: true,
      attachment: true,
      temperature: true,
      limit: { context: 1_000_000, output: 131_072 },
      modalities: { input: ["text", "image", "video", "pdf"], output: ["text"] },
    },
    "qwen3.7-plus": {
      id: "qwen3.7-plus",
      name: "Qwen3.7 Plus",
      family: "qwen",
      reasoning: true,
      tool_call: true,
      temperature: true,
      limit: { context: 1_000_000, output: 65_536 },
      modalities: { input: ["text", "image", "video"], output: ["text"] },
    },
    "qwen3.7-flash": {
      id: "qwen3.7-flash",
      name: "Qwen3.7 Flash",
      family: "qwen",
      reasoning: true,
      tool_call: true,
      attachment: true,
      temperature: true,
      limit: { context: 1_000_000, output: 65_536 },
      modalities: { input: ["text", "image", "video"], output: ["text"] },
    },
    "qwen3.6-omni-plus": {
      id: "qwen3.6-omni-plus",
      name: "Qwen3.6 Omni Plus",
      family: "qwen",
      reasoning: true,
      tool_call: true,
      temperature: true,
      limit: { context: 262_144, output: 8_192 },
      modalities: { input: ["text", "image", "audio", "video"], output: ["text", "audio"] },
    },
  },
} as unknown as ModelsDev.Provider

const models = Provider.fromModelsDevProvider(provider).models

test("qwencloud resolves to the QwenCloud International OpenAI-compatible endpoint", () => {
  for (const id of [
    "qwen3.8-max",
    "qwen3.7-plus",
    "qwen3.7-flash",
    "qwen3.6-omni-plus",
  ]) {
    expect(models[id].api.npm).toBe("@ai-sdk/openai-compatible")
    expect(models[id].api.url).toBe(QWENCLOUD_API)
  }
})

test("qwencloud provider carries QwenCloud/DashScope auth env vars", () => {
  const info = Provider.fromModelsDevProvider(provider)
  expect(info.env).toContain("QWENCLOUD_API_KEY")
  expect(info.env).toContain("DASHSCOPE_API_KEY")
})
