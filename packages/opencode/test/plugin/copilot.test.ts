import { describe, expect, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { CopilotAuthPlugin } from "../../src/plugin/copilot"
import type { Provider } from "../../src/provider/provider"

function model(id: string): Provider.Model {
  return {
    id,
    providerID: "github-copilot",
    api: {
      id,
      url: "https://api.githubcopilot.com",
      npm: "@ai-sdk/openai-compatible",
    },
    name: id,
    family: "gpt-codex",
    capabilities: {
      temperature: false,
      reasoning: true,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: {
      input: 1,
      output: 2,
      cache: { read: 3, write: 4 },
    },
    limit: {
      context: 272000,
      output: 128000,
    },
    status: "active",
    options: {},
    headers: {},
    release_date: "2025-12-11",
    variants: {},
  }
}

function provider(models: Record<string, Provider.Model>): Provider.Info {
  return {
    id: "github-copilot",
    name: "GitHub Copilot",
    source: "api",
    env: [],
    options: {},
    models,
  }
}

async function oauth() {
  return {
    type: "oauth" as const,
    access: "token",
    refresh: "token",
    expires: 0,
  }
}

function input(): PluginInput {
  return {
    client: {
      session: {
        get: async () => ({ data: { parentID: undefined } }),
      },
    },
  } as unknown as PluginInput
}

describe("plugin.copilot", () => {
  // Remove this temporary guard when models.dev reliably serves github-copilot/gpt-5.3-codex.
  test("adds gpt-5.3-codex fallback with expected metadata", async () => {
    const hooks = await CopilotAuthPlugin(input())
    const info = provider({
      "gpt-5.2-codex": model("gpt-5.2-codex"),
    })

    await hooks.auth?.loader?.(oauth, info)

    expect(info.models["gpt-5.3-codex"]).toBeDefined()
    expect(info.models["gpt-5.3-codex"].providerID).toBe("github-copilot")
    expect(info.models["gpt-5.3-codex"].name).toBe("GPT-5.3 Codex")
    expect(info.models["gpt-5.3-codex"].release_date).toBe("2026-02-05")
    expect(Object.keys(info.models["gpt-5.3-codex"].variants ?? {})).toContain("xhigh")
  })
})
