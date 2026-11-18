import { describe, expect, test } from "bun:test"
import type { AgentListOutput, ModelListOutput, Project, ProviderListOutput } from "@opencode/client/promise"
import { directoryKey, normalizeAgentList, normalizeProjectInfo, normalizeProviderList } from "./utils"

describe("normalizeAgentList", () => {
  test("adapts current agents to the app agent shape", () => {
    const agents: AgentListOutput["data"] = [
      {
        id: "build",
        name: "Build",
        mode: "primary",
        hidden: false,
        color: "primary",
        model: { id: "gpt-5", providerID: "openai", variant: "high" },
        request: { settings: { temperature: 0.2, topP: 0.9 }, headers: {}, body: {} },
        system: "Build software",
        permissions: [{ action: "read", resource: "*", effect: "allow" }],
      },
    ]

    const result = normalizeAgentList(agents)

    expect(result).toEqual([
      {
        name: "build",
        description: undefined,
        mode: "primary",
        hidden: false,
        temperature: 0.2,
        topP: 0.9,
        color: "primary",
        permission: [{ permission: "read", pattern: "*", action: "allow" }],
        model: { providerID: "openai", modelID: "gpt-5" },
        variant: "high",
        prompt: "Build software",
        options: { temperature: 0.2, topP: 0.9 },
        steps: undefined,
      },
    ])
  })
})

describe("normalizeProviderList", () => {
  test.each([
    [0, ""],
    [Date.UTC(2026, 8, 1), "2026-09-01"],
  ])("groups models with release time %p into the app catalog", (released, release_date) => {
    const providers: ProviderListOutput["data"] = [
      { id: "openai", name: "OpenAI", activation: "auto", package: "@ai-sdk/openai" },
    ]

    const models: ModelListOutput["data"] = [
      {
        id: "gpt-5",
        modelID: "gpt-5",
        providerID: "openai",
        name: "GPT-5",
        capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
        variants: [{ id: "high" }],
        time: { released },
        cost: [{ input: 1, output: 2, cache: { read: 0.1, write: 0.2 } }],
        status: "active",
        enabled: true,
        limit: { context: 128_000, output: 8_192 },
      },
      {
        id: "gpt-old",
        modelID: "gpt-old",
        providerID: "openai",
        name: "GPT Old",
        capabilities: { tools: false, input: ["text"], output: ["text"] },
        variants: [],
        time: { released: 0 },
        cost: [],
        status: "deprecated",
        enabled: true,
        limit: { context: 1, output: 1 },
      },
    ]

    const result = normalizeProviderList(providers, models)

    expect(result.connected).toEqual(["openai"])
    expect(result.default).toEqual({ openai: "gpt-5" })
    expect(result.all.get("openai")?.models["gpt-old"]).toBeUndefined()
    expect(result.all.get("openai")?.models["gpt-5"]).toMatchObject({
      id: "gpt-5",
      providerID: "openai",
      release_date,
      capabilities: { toolcall: true, attachment: true, reasoning: true },
      cost: { input: 1, output: 2 },
      variants: { high: {} },
    })
  })

  test.each([
    ["effort variant", [{ id: "low" }], undefined, true],
    ["toggle variant", [{ id: "none" }, { id: "thinking" }], undefined, true],
    ["reasoningField without variants", [], { reasoningField: "reasoning_content" }, true],
    ["no variants or reasoningField", [], undefined, false],
    ["disabled-only none variant", [{ id: "none" }], undefined, false],
  ] as const)("derives reasoning capability from %s", (_, variants, compatibility, expected) => {
    const providers: ProviderListOutput["data"] = [
      { id: "opencode", name: "OpenCode", activation: "auto", package: "@opencode/ai/providers/openai-compatible" },
    ]

    const models: ModelListOutput["data"] = [
      {
        id: "model",
        modelID: "model",
        providerID: "opencode",
        name: "Model",
        compatibility,
        capabilities: { tools: true, input: ["text"], output: ["text"] },
        variants: [...variants],
        time: { released: 1 },
        cost: [],
        status: "active",
        enabled: true,
        limit: { context: 128_000, output: 8_192 },
      },
    ]

    const result = normalizeProviderList(providers, models)

    expect(result.all.get("opencode")?.models.model?.capabilities.reasoning).toBe(expected)
  })
})

describe("normalizeProjectInfo", () => {
  test("keeps the project VCS backend", () => {
    const project: Project = {
      id: "prj",
      canonical: "/repo",
      time: { created: 1, updated: 1, active: 1 },
      sandboxes: [],
    }

    expect(normalizeProjectInfo({ ...project, vcs: "git" }).vcs).toBe("git")
    expect(normalizeProjectInfo({ ...project, vcs: "hg" }).vcs).toBe("hg")
    expect(normalizeProjectInfo(project).vcs).toBeUndefined()
  })
})

test.each([
  ["C:\\Repos\\sst\\opencode", "C:/Repos/sst/opencode"],
  ["C:/Repos/sst/opencode", "C:/Repos/sst/opencode"],
  ["/tmp/foo\\bar", "/tmp/foo\\bar"],
  ["C:/Repos/sst/opencode/", "C:/Repos/sst/opencode"],
  ["C:/", "C:/"],
  ["/", "/"],
])("directoryKey(%p) is %p", (input, expected) => {
  expect(String(directoryKey(input))).toBe(expected)
})
