import { describe, expect, test } from "bun:test"
import { ACP } from "../../src/acp/agent"
import { provideTestInstance, tmpdir } from "../fixture/fixture"
import type { AgentSideConnection } from "@agentclientprotocol/sdk"

type EventController = {
  close: () => void
}

function createEventStream() {
  const waiters: Array<(value: undefined) => void> = []
  const state = { closed: false }

  const close = () => {
    state.closed = true
    for (const waiter of waiters.splice(0)) waiter(undefined)
  }

  const stream = async function* (signal?: AbortSignal) {
    while (!state.closed) {
      await new Promise<undefined>((resolve) => {
        waiters.push(resolve)
        if (!signal) return
        signal.addEventListener("abort", () => resolve(undefined), { once: true })
      })
      if (signal?.aborted) return
    }
  }

  return { controller: { close } satisfies EventController, stream }
}

function createACPAgent(input: { messages?: Array<any>; onPrompt?: (params: Record<string, unknown>) => void }) {
  const sessionUpdates: Array<{ sessionId: string; update: { sessionUpdate: string } & Record<string, unknown> }> = []
  const { controller, stream } = createEventStream()
  let id = 0

  const connection = {
    async sessionUpdate(params: { sessionId: string; update: { sessionUpdate: string } & Record<string, unknown> }) {
      sessionUpdates.push(params)
    },
    async requestPermission() {
      return { outcome: { outcome: "selected", optionId: "once" } }
    },
  } as unknown as AgentSideConnection

  const sdk = {
    global: {
      event: async (opts?: { signal?: AbortSignal }) => ({ stream: stream(opts?.signal) }),
    },
    session: {
      create: async () => ({ data: { id: `ses_${++id}`, time: { created: new Date().toISOString() } } }),
      get: async (params?: { sessionID?: string }) => ({
        data: { id: params?.sessionID ?? "ses_1", time: { created: new Date().toISOString() } },
      }),
      fork: async () => ({ data: { id: `ses_${++id}`, time: { created: new Date().toISOString() } } }),
      messages: async () => ({ data: input.messages ?? [] }),
      message: async () => ({ data: { info: { role: "assistant" }, parts: [] } }),
      prompt: async (params: Record<string, unknown>) => {
        input.onPrompt?.(params)
        return { data: {} }
      },
      abort: async () => ({ data: true }),
    },
    permission: {
      reply: async () => ({ data: true }),
      respond: async () => ({ data: true }),
    },
    config: {
      get: async () => ({
        data: { model: "openai/gpt-5.4", agent: { build: { model: "openai/gpt-5.4", variant: "high" } } },
      }),
      providers: async () => ({
        data: {
          providers: [
            {
              id: "openai",
              name: "OpenAI",
              models: {
                "gpt-5.4": {
                  id: "gpt-5.4",
                  name: "gpt-5.4",
                  variants: {
                    default: {},
                    high: {},
                    low: {},
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
            hidden: false,
            model: { providerID: "openai", modelID: "gpt-5.4" },
            variant: "high",
          },
          {
            name: "plan",
            description: "plan",
            mode: "primary",
            hidden: false,
            model: { providerID: "openai", modelID: "gpt-5.4" },
            variant: "low",
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
    defaultModel: { providerID: "openai", modelID: "gpt-5.4" },
  } as any)

  const stop = () => {
    controller.close()
    ;(agent as any).eventAbort.abort()
  }

  return { agent, sessionUpdates, stop }
}

describe("acp session config options", () => {
  test("newSession exposes separate mode, model, and variant selectors", async () => {
    await using tmp = await tmpdir()
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const { agent, stop } = createACPAgent({})
        const result = await agent.newSession({ cwd: tmp.path, mcpServers: [] } as any)

        expect(result.models?.currentModelId).toBe("openai/gpt-5.4/high")
        expect(result.configOptions?.map((item) => item.id)).toEqual(["mode", "model", "variant"])
        expect(result.configOptions?.find((item) => item.id === "mode")?.currentValue).toBe("build")
        expect(result.configOptions?.find((item) => item.id === "model")?.currentValue).toBe("openai/gpt-5.4")
        expect(result.configOptions?.find((item) => item.id === "variant")?.currentValue).toBe("high")

        stop()
      },
    })
  })

  test("prompt forwards configured variant on the first turn", async () => {
    await using tmp = await tmpdir()
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        let call: Record<string, unknown> | undefined
        const { agent, stop } = createACPAgent({
          onPrompt: (params) => {
            call = params
          },
        })

        const sessionId = await agent.newSession({ cwd: tmp.path, mcpServers: [] } as any).then((x) => x.sessionId)
        await agent.prompt({ sessionId, prompt: [{ type: "text", text: "hello" }] } as any)

        expect(call?.agent).toBe("build")
        expect(call?.variant).toBe("high")
        stop()
      },
    })
  })

  test("loadSession restores the last used variant", async () => {
    await using tmp = await tmpdir()
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const { agent, stop } = createACPAgent({
          messages: [
            {
              info: {
                role: "user",
                sessionID: "ses_1",
                agent: "plan",
                variant: "low",
                model: { providerID: "openai", modelID: "gpt-5.4" },
              },
              parts: [],
            },
          ],
        })

        const result = await agent.loadSession({ sessionId: "ses_1", cwd: tmp.path, mcpServers: [] } as any)

        expect(result.models?.currentModelId).toBe("openai/gpt-5.4/low")
        expect(result.configOptions?.find((item) => item.id === "mode")?.currentValue).toBe("plan")
        expect(result.configOptions?.find((item) => item.id === "variant")?.currentValue).toBe("low")
        stop()
      },
    })
  })

  test("setSessionConfigOption updates variant independently from model", async () => {
    await using tmp = await tmpdir()
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        let call: Record<string, unknown> | undefined
        const { agent, stop } = createACPAgent({
          onPrompt: (params) => {
            call = params
          },
        })

        const sessionId = await agent.newSession({ cwd: tmp.path, mcpServers: [] } as any).then((x) => x.sessionId)
        const result = await agent.setSessionConfigOption({
          sessionId,
          configId: "variant",
          value: "default",
        })

        expect(result.configOptions.find((item) => item.id === "variant")?.currentValue).toBe("default")

        await agent.prompt({ sessionId, prompt: [{ type: "text", text: "hello" }] } as any)
        expect(call?.variant).toBeUndefined()
        stop()
      },
    })
  })
})
