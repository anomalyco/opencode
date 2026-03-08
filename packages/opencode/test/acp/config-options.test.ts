import { describe, expect, test } from "bun:test"
import { ACP } from "../../src/acp/agent"
import type { AgentSideConnection } from "@agentclientprotocol/sdk"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

type Update = Parameters<AgentSideConnection["sessionUpdate"]>[0]

function create() {
  const prompts: Array<{ modelID: string; providerID: string; variant?: string }> = []

  const connection = {
    async sessionUpdate(_input: Update) {},
    async requestPermission() {
      return { outcome: { outcome: "selected", optionId: "once" } }
    },
  } as unknown as AgentSideConnection

  const sdk = {
    global: {
      event: async (opts?: { signal?: AbortSignal }) => {
        const stream = (async function* () {
          await new Promise<void>((resolve) => {
            opts?.signal?.addEventListener("abort", () => resolve(), { once: true })
          })
        })()
        return { stream }
      },
    },
    session: {
      create: async () => {
        return {
          data: {
            id: "ses_1",
            time: { created: new Date().toISOString() },
          },
        }
      },
      prompt: async (input: { model: { providerID: string; modelID: string }; variant?: string }) => {
        prompts.push({ providerID: input.model.providerID, modelID: input.model.modelID, variant: input.variant })
        return { data: {} }
      },
      messages: async () => {
        return { data: [] }
      },
    },
    config: {
      get: async () => ({ data: {} }),
      providers: async () => {
        return {
          data: {
            providers: [
              {
                id: "opencode",
                name: "OpenCode",
                models: {
                  "big-pickle": {
                    id: "big-pickle",
                    name: "big-pickle",
                    providerID: "opencode",
                    variants: {
                      default: {},
                      low: {},
                      high: {},
                    },
                  },
                  "small-pickle": {
                    id: "small-pickle",
                    name: "small-pickle",
                    providerID: "opencode",
                    variants: {
                      default: {},
                      low: {},
                    },
                  },
                },
              },
            ],
          },
        }
      },
    },
    app: {
      agents: async () => {
        return {
          data: [
            {
              name: "build",
              description: "build",
              mode: "agent",
            },
          ],
        }
      },
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
    defaultModel: { providerID: "opencode", modelID: "big-pickle" },
  } as any)

  const stop = () => {
    ;(agent as any).eventAbort.abort()
  }

  return { agent, prompts, stop }
}

function values(opts: unknown): string[] {
  if (!Array.isArray(opts)) return []
  return opts
    .filter(
      (item): item is { value: string } =>
        typeof item === "object" && item !== null && "value" in item && typeof item.value === "string",
    )
    .map((item) => item.value)
}

describe("acp.agent config options", () => {
  test("returns thinking levels as config options and keeps model list base-only", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, stop } = create()
        try {
          const out = await agent.newSession({ cwd: tmp.path, mcpServers: [] } as any)
          expect(out.models?.availableModels.map((item) => item.modelId)).toEqual([
            "opencode/big-pickle",
            "opencode/small-pickle",
          ])

          const model = out.configOptions?.find((item: { id: string }) => item.id === "opencode.model")
          const cfg = out.configOptions?.find((item: { id: string }) => item.id === "opencode.thought")
          expect(model?.category).toBe("model")
          expect(values(model?.options)).toEqual(["opencode/big-pickle", "opencode/small-pickle"])
          expect(cfg?.category).toBe("thought_level")
          expect(cfg?.type).toBe("select")
          expect(values(cfg?.options)).toEqual(["default", "low", "high"])
        } finally {
          stop()
        }
      },
    })
  })

  test("applies thinking level through setSessionConfigOption", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, prompts, stop } = create()
        try {
          const sessionId = await agent.newSession({ cwd: tmp.path, mcpServers: [] } as any).then((x) => x.sessionId)

          await agent.setSessionConfigOption({
            sessionId,
            configId: "opencode.thought",
            value: "high",
          })
          await agent.prompt({
            sessionId,
            prompt: [{ type: "text", text: "hi" }],
          } as any)

          await agent.setSessionConfigOption({
            sessionId,
            configId: "opencode.model",
            value: "opencode/small-pickle",
          })
          await agent.prompt({
            sessionId,
            prompt: [{ type: "text", text: "switch model" }],
          } as any)

          await agent.setSessionConfigOption({
            sessionId,
            configId: "opencode.thought",
            value: "default",
          })
          await agent.prompt({
            sessionId,
            prompt: [{ type: "text", text: "hi again" }],
          } as any)

          expect(prompts).toEqual([
            { providerID: "opencode", modelID: "big-pickle", variant: "high" },
            { providerID: "opencode", modelID: "small-pickle", variant: undefined },
            { providerID: "opencode", modelID: "small-pickle", variant: undefined },
          ])
        } finally {
          stop()
        }
      },
    })
  })
})
