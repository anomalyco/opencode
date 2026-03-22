import { describe, expect, test } from "bun:test"
import type { AgentSideConnection } from "@agentclientprotocol/sdk"
import { ACP } from "../../src/acp/agent"
import type { ACPConfig } from "../../src/acp/types"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

function fake() {
  const conn = {
    async sessionUpdate() {},
    async requestPermission() {
      return {
        outcome: {
          outcome: "selected",
          optionId: "once",
        },
      }
    },
  } as unknown as AgentSideConnection

  const sdk = {
    global: {
      event: async (opts?: { signal?: AbortSignal }) => ({
        stream: (async function* () {
          if (opts?.signal?.aborted) return
          await new Promise((resolve) => opts?.signal?.addEventListener("abort", resolve, { once: true }))
        })(),
      }),
    },
    session: {
      create: async () => ({
        data: {
          id: "ses_1",
          time: { created: new Date().toISOString() },
        },
      }),
      messages: async () => ({ data: [] }),
    },
    config: {
      providers: async () => ({
        data: {
          providers: [
            {
              id: "opencode",
              name: "OpenCode",
              models: {
                "big-pickle": { id: "big-pickle", name: "Big Pickle" },
              },
            },
            {
              id: "openai",
              name: "OpenAI",
              models: {
                "gpt-5": {
                  id: "gpt-5",
                  name: "GPT-5",
                  variants: {
                    default: {},
                    high: {},
                  },
                },
                "gpt-4.1": {
                  id: "gpt-4.1",
                  name: "GPT-4.1",
                  variants: {
                    default: {},
                    fast: {},
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
            mode: "primary",
          },
          {
            name: "review",
            description: "review",
            mode: "primary",
            model: {
              providerID: "openai",
              modelID: "gpt-5",
            },
            variant: "high",
          },
          {
            name: "base",
            description: "base",
            mode: "primary",
            model: {
              providerID: "openai",
              modelID: "gpt-4.1",
            },
          },
          {
            name: "plain",
            description: "plain",
            mode: "primary",
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
  } as unknown as ACPConfig["sdk"]

  const agent = new ACP.Agent(conn, {
    sdk,
    defaultModel: {
      providerID: ProviderID.make("opencode"),
      modelID: ModelID.make("big-pickle"),
    },
  })

  const raw = agent as unknown as {
    eventAbort: AbortController
    sessionManager: {
      get: (id: string) => {
        modeId?: string
        model?: {
          providerID: string
          modelID: string
        }
        variant?: string
      }
    }
  }

  return {
    agent,
    stop() {
      raw.eventAbort.abort()
    },
    get(id: string) {
      return raw.sessionManager.get(id)
    },
  }
}

describe("acp.agent setSessionMode", () => {
  test("newSession activates the configured model for the default mode", async () => {
    await using tmp = await tmpdir({
      config: {
        default_agent: "review",
        agent: {
          review: {
            model: "openai/gpt-5",
            variant: "high",
          },
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, stop, get } = fake()

        try {
          const res = await agent.newSession({ cwd: tmp.path, mcpServers: [] } as Parameters<ACP.Agent["newSession"]>[0])
          const state = get(res.sessionId)

          expect(res.modes?.currentModeId).toBe("review")
          expect(res.models.currentModelId).toBe("openai/gpt-5/high")
          expect(state.modeId).toBe("review")
          expect(state.model).toEqual({
            providerID: "openai",
            modelID: "gpt-5",
          })
          expect(state.variant).toBe("high")
        } finally {
          stop()
        }
      },
    })
  })

  test("activates the selected mode's configured model and variant", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, stop, get } = fake()
        const cwd = "/tmp/opencode-acp-test"

        try {
          const sid = await agent
            .newSession({ cwd, mcpServers: [] } as Parameters<ACP.Agent["newSession"]>[0])
            .then((x) => x.sessionId)

          await agent.setSessionMode({ sessionId: sid, modeId: "review" } as Parameters<ACP.Agent["setSessionMode"]>[0])

          const state = get(sid)
          expect(state.modeId).toBe("review")
          expect(state.model).toEqual({
            providerID: "openai",
            modelID: "gpt-5",
          })
          expect(state.variant).toBe("high")
        } finally {
          stop()
        }
      },
    })
  })

  test("keeps the current session model when the selected mode has no configured model", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, stop, get } = fake()
        const cwd = "/tmp/opencode-acp-test"

        try {
          const sid = await agent
            .newSession({ cwd, mcpServers: [] } as Parameters<ACP.Agent["newSession"]>[0])
            .then((x) => x.sessionId)

          await agent.setSessionMode({ sessionId: sid, modeId: "review" } as Parameters<ACP.Agent["setSessionMode"]>[0])
          await agent.setSessionMode({ sessionId: sid, modeId: "plain" } as Parameters<ACP.Agent["setSessionMode"]>[0])

          const state = get(sid)
          expect(state.modeId).toBe("plain")
          expect(state.model).toEqual({
            providerID: "openai",
            modelID: "gpt-5",
          })
          expect(state.variant).toBe("high")
        } finally {
          stop()
        }
      },
    })
  })

  test("clears the current variant when the selected mode changes the model without a variant", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, stop, get } = fake()
        const cwd = "/tmp/opencode-acp-test"

        try {
          const sid = await agent
            .newSession({ cwd, mcpServers: [] } as Parameters<ACP.Agent["newSession"]>[0])
            .then((x) => x.sessionId)

          await agent.setSessionMode({ sessionId: sid, modeId: "review" } as Parameters<ACP.Agent["setSessionMode"]>[0])
          await agent.setSessionMode({ sessionId: sid, modeId: "base" } as Parameters<ACP.Agent["setSessionMode"]>[0])

          const state = get(sid)
          expect(state.modeId).toBe("base")
          expect(state.model).toEqual({
            providerID: "openai",
            modelID: "gpt-4.1",
          })
          expect(state.variant).toBeUndefined()
        } finally {
          stop()
        }
      },
    })
  })
})
