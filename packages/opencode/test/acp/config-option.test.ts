import { describe, expect, test } from "bun:test"
import type { AgentSideConnection } from "@agentclientprotocol/sdk"
import { ACP } from "../../src/acp/agent"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

function createAgent() {
  const stream = async function* (signal?: AbortSignal) {
    await new Promise<void>((resolve) => {
      signal?.addEventListener("abort", () => resolve(), { once: true })
    })
  }

  const connection = {
    async sessionUpdate() {},
    async requestPermission() {
      return { outcome: { outcome: "selected", optionId: "once" } }
    },
  } as unknown as AgentSideConnection

  const sdk = {
    global: {
      event: async (opts?: { signal?: AbortSignal }) => ({ stream: stream(opts?.signal) }),
    },
    session: {
      create: async () => ({
        data: {
          id: "ses_1",
          time: { created: new Date().toISOString() },
        },
      }),
    },
    config: {
      providers: async () => ({
        data: {
          providers: [
            {
              id: "openai",
              name: "OpenAI",
              models: {
                "gpt-5.4-mini": {
                  id: "gpt-5.4-mini",
                  name: "gpt-5.4-mini",
                  variants: {
                    default: {},
                    low: {},
                    medium: {},
                    high: {},
                    xhigh: {},
                  },
                },
              },
            },
          ],
        },
      }),
    },
    app: {
      agents: async () => ({
        data: [
          {
            name: "build",
            description: "build",
            mode: "agent",
          },
          {
            name: "plan",
            description: "plan",
            mode: "agent",
          },
        ],
      }),
    },
    command: {
      list: async () => ({ data: [] }),
    },
    mcp: {
      add: async () => ({ data: true }),
    },
  } as any

  const agent = new ACP.Agent(connection, {
    sdk,
    defaultModel: { providerID: "openai", modelID: "gpt-5.4-mini" },
  } as any)

  return { agent, stop: () => (agent as any).eventAbort.abort() }
}

describe("acp.agent config options", () => {
  test("exposes reasoning effort separately from model names", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, stop } = createAgent()

        const result = await agent.newSession({ cwd: tmp.path, mcpServers: [] } as any)

        expect(result.models?.availableModels).toEqual([
          { modelId: "openai/gpt-5.4-mini", name: "OpenAI/gpt-5.4-mini" },
        ])
        expect(result.configOptions).toEqual([
          {
            type: "select",
            id: "mode",
            name: "Mode",
            category: "mode",
            currentValue: "build",
            options: [
              { value: "build", name: "build", description: "build" },
              { value: "plan", name: "plan", description: "plan" },
            ],
          },
          {
            type: "select",
            id: "model",
            name: "Model",
            category: "model",
            currentValue: "openai/gpt-5.4-mini",
            options: [{ value: "openai/gpt-5.4-mini", name: "OpenAI/gpt-5.4-mini" }],
          },
          {
            type: "select",
            id: "reasoning_effort",
            name: "Reasoning effort",
            category: "thought_level",
            currentValue: "default",
            options: [
              { value: "default", name: "Default" },
              { value: "low", name: "low" },
              { value: "medium", name: "medium" },
              { value: "high", name: "high" },
              { value: "xhigh", name: "xhigh" },
            ],
          },
        ])

        stop()
      },
    })
  })

  test("allows switching reasoning effort back to default", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, stop } = createAgent()

        const result = await agent.newSession({ cwd: tmp.path, mcpServers: [] } as any)
        const changed = await agent.setSessionConfigOption({
          sessionId: result.sessionId,
          configId: "reasoning_effort",
          value: "high",
        } as any)
        const reset = await agent.setSessionConfigOption({
          sessionId: result.sessionId,
          configId: "reasoning_effort",
          value: "default",
        } as any)

        expect(changed.configOptions.find((x) => x.id === "reasoning_effort")?.currentValue).toBe("high")
        expect(reset.configOptions.find((x) => x.id === "reasoning_effort")?.currentValue).toBe("default")

        stop()
      },
    })
  })
})
