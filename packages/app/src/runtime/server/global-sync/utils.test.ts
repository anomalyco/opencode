import { describe, expect, test } from "bun:test"
import type { AgentListOutput, ModelListOutput, Project, ProviderListOutput } from "@opencode/client/promise"
import { directoryKey, normalizeAgentList, normalizeProjectInfo, normalizeProviderList } from "./utils"

describe("normalizeAgentList", () => {
  test("adapts current agents to the app agent shape", () => {
    const result = normalizeAgentList([
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
    ] as AgentListOutput["data"])

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
  test("groups current models into the app provider catalog", () => {
    const result = normalizeProviderList(
      [{ id: "openai", name: "OpenAI", package: "@ai-sdk/openai" }] as ProviderListOutput["data"],
      [
        {
          id: "gpt-5",
          modelID: "gpt-5",
          providerID: "openai",
          name: "GPT-5",
          capabilities: { tools: true, reasoning: true, input: ["text", "image"], output: ["text"] },
          variants: [{ id: "high" }],
          time: { released: 1 },
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
        {
          id: "gpt-classic",
          modelID: "gpt-classic",
          providerID: "openai",
          name: "GPT Classic",
          capabilities: { tools: true, input: ["text"], output: ["text"] },
          variants: [],
          time: { released: 0 },
          cost: [],
          status: "active",
          enabled: true,
          limit: { context: 1, output: 1 },
        },
        {
          id: "gpt-variants-only",
          modelID: "gpt-variants-only",
          providerID: "openai",
          name: "GPT Variants Only",
          capabilities: { tools: true, input: ["text"], output: ["text"] },
          variants: [{ id: "high" }],
          time: { released: 0 },
          cost: [],
          status: "active",
          enabled: true,
          limit: { context: 1, output: 1 },
        },
        {
          id: "gpt-none-only",
          modelID: "gpt-none-only",
          providerID: "openai",
          name: "GPT None Only",
          capabilities: { tools: true, input: ["text"], output: ["text"] },
          variants: [{ id: "none", settings: { reasoningEffort: "none" } }],
          time: { released: 0 },
          cost: [],
          status: "active",
          enabled: true,
          limit: { context: 1, output: 1 },
        },
        {
          id: "gpt-none-and-high",
          modelID: "gpt-none-and-high",
          providerID: "openai",
          name: "GPT None And High",
          capabilities: { tools: true, input: ["text"], output: ["text"] },
          variants: [{ id: "none" }, { id: "high" }],
          time: { released: 0 },
          cost: [],
          status: "active",
          enabled: true,
          limit: { context: 1, output: 1 },
        },
        {
          id: "gpt-field-only",
          modelID: "gpt-field-only",
          providerID: "openai",
          name: "GPT Field Only",
          compatibility: { reasoningField: "reasoning_content" },
          capabilities: { tools: true, input: ["text"], output: ["text"] },
          variants: [],
          time: { released: 0 },
          cost: [],
          status: "active",
          enabled: true,
          limit: { context: 1, output: 1 },
        },
        {
          id: "gpt-off-with-variants",
          modelID: "gpt-off-with-variants",
          providerID: "openai",
          name: "GPT Off With Variants",
          capabilities: { tools: true, reasoning: false, input: ["text"], output: ["text"] },
          variants: [{ id: "high" }],
          time: { released: 0 },
          cost: [],
          status: "active",
          enabled: true,
          limit: { context: 1, output: 1 },
        },
      ] as ModelListOutput["data"],
    )

    expect(result.connected).toEqual(["openai"])
    expect(result.default).toEqual({ openai: "gpt-5" })
    expect(result.all.get("openai")?.models["gpt-old"]).toBeUndefined()
    expect(result.all.get("openai")?.models["gpt-5"]).toMatchObject({
      id: "gpt-5",
      providerID: "openai",
      capabilities: { toolcall: true, attachment: true, reasoning: true },
      cost: { input: 1, output: 2 },
      variants: { high: {} },
    })
    // 目录未标注 reasoning 的模型映射为 false，而不是被硬编码覆盖
    expect(result.all.get("openai")?.models["gpt-classic"]?.capabilities.reasoning).toBe(false)
    // 目录没标 reasoning 时，用服务端已有的两个信号兜底：
    // 已解析出的 variants、或 compatibility.reasoningField
    expect(result.all.get("openai")?.models["gpt-variants-only"]?.capabilities.reasoning).toBe(true)
    // A disabled-only variant is not evidence of reasoning support.
    expect(result.all.get("openai")?.models["gpt-none-only"]?.capabilities.reasoning).toBe(false)
    expect(result.all.get("openai")?.models["gpt-none-and-high"]?.capabilities.reasoning).toBe(true)
    expect(result.all.get("openai")?.models["gpt-field-only"]?.capabilities.reasoning).toBe(true)
    // 目录显式标 false 时以目录为准，不被兜底信号覆盖
    expect(result.all.get("openai")?.models["gpt-off-with-variants"]?.capabilities.reasoning).toBe(false)
  })
})

describe("normalizeProjectInfo", () => {
  test("keeps the project VCS backend", () => {
    const project = { id: "prj", canonical: "/repo", time: { created: 1, updated: 1, active: 1 }, sandboxes: [] }
    expect(normalizeProjectInfo({ ...project, vcs: "git" } as Project).vcs).toBe("git")
    expect(normalizeProjectInfo({ ...project, vcs: "hg" } as Project).vcs).toBe("hg")
    expect(normalizeProjectInfo(project as Project).vcs).toBeUndefined()
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
