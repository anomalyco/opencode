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
      attachment: true,
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
      input: 272000,
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
  test("adds gpt-5.3-codex fallback when missing", async () => {
    const hooks = await CopilotAuthPlugin(input())
    const info = provider({
      "gpt-5.2-codex": model("gpt-5.2-codex"),
    })

    await hooks.auth?.loader?.(oauth, info)

    expect(info.models["gpt-5.3-codex"]).toBeDefined()
    expect(info.models["gpt-5.3-codex"].api.id).toBe("gpt-5.3-codex")
    expect(info.models["gpt-5.3-codex"].api.npm).toBe("@ai-sdk/github-copilot")
    expect(info.models["gpt-5.3-codex"].release_date).toBe("2026-02-09")
    expect(Object.keys(info.models["gpt-5.3-codex"].variants ?? {})).toContain("xhigh")
  })

  test("does not overwrite existing gpt-5.3-codex", async () => {
    const hooks = await CopilotAuthPlugin(input())
    const existing = model("gpt-5.3-codex")
    existing.release_date = "2026-03-01"

    const info = provider({
      "gpt-5.2-codex": model("gpt-5.2-codex"),
      "gpt-5.3-codex": existing,
    })

    await hooks.auth?.loader?.(oauth, info)

    expect(info.models["gpt-5.3-codex"].release_date).toBe("2026-03-01")
  })
})
