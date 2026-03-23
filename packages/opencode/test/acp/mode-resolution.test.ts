import { describe, expect, test } from "bun:test"
import type { AgentSideConnection } from "@agentclientprotocol/sdk"
import { ACP } from "../../src/acp/agent"
import { tmpdir } from "../fixture/fixture"

function eventStream() {
  const wait: Array<(value: any) => void> = []
  const ctrl = {
    close() {
      for (const item of wait.splice(0)) item(undefined)
    },
  }

  const stream = async function* (signal?: AbortSignal) {
    while (true) {
      if (signal?.aborted) return
      const next = await new Promise<any>((resolve) => {
        wait.push(resolve)
        signal?.addEventListener("abort", () => resolve(undefined), { once: true })
      })
      if (!next) return
      yield next
    }
  }

  return { ctrl, stream }
}

function createFakeAgent(input: {
  messages?: any[]
}) {
  const prompts: any[] = []
  const { ctrl, stream } = eventStream()

  const connection = {
    async sessionUpdate(params: any) {
      void params
    },
    async requestPermission() {
      return { outcome: { outcome: "selected", optionId: "once" } }
    },
  } as unknown as AgentSideConnection

  let count = 0
  const sdk = {
    global: {
      event: async (opts?: { signal?: AbortSignal }) => ({ stream: stream(opts?.signal) }),
    },
    session: {
      create: async () => {
        count++
        return { data: { id: `ses_${count}`, time: { created: new Date().toISOString() } } }
      },
      get: async (params: { sessionID: string }) => ({
        data: { id: params.sessionID, time: { created: new Date().toISOString() } },
      }),
      messages: async () => ({ data: input.messages ?? [] }),
      prompt: async (params: any) => {
        prompts.push(params)
        return { data: { info: undefined } }
      },
      command: async () => ({ data: { info: undefined } }),
      summarize: async () => ({ data: true }),
      abort: async () => ({ data: true }),
      message: async () => ({ data: { info: { role: "assistant" }, parts: [] } }),
    },
    config: {
      get: async () => ({ data: {} }),
      providers: async () => ({
        data: {
          providers: [
            {
              id: "opencode",
              name: "OpenCode",
              models: { "big-pickle": { id: "big-pickle", providerID: "opencode", name: "Big Pickle" } },
            },
          ],
        },
      }),
    },
    app: {
      agents: async () => ({
        data: [
          { id: "build", name: "Forge", description: "build", mode: "primary", hidden: false },
          { id: "pulse", name: "Pulse", description: "assistant", mode: "primary", hidden: false },
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

  const agent = new ACP.Agent(connection, { sdk } as any)
  const stop = () => {
    ctrl.close()
    ;(agent as any).eventAbort.abort()
  }
  return { agent, stop, prompts }
}

describe("acp mode resolution", () => {
  test("newSession resolves default agent and uses canonical mode id", async () => {
    await using tmp = await tmpdir({
      config: {
        default_agent: "pulse",
        agent: {
          pulse: {
            name: "Pulse",
            description: "assistant",
          },
          build: {
            name: "Forge",
          },
        },
      },
    })
    const { agent, stop } = createFakeAgent({})

    const result = await agent.newSession({ cwd: tmp.path, mcpServers: [] } as any)

    expect(result.modes?.currentModeId).toBe("pulse")
    expect(result.modes?.availableModes.find((x) => x.id === "pulse")?.name).toBe("Pulse")
    stop()
  })

  test("prompt uses canonical mode id from session", async () => {
    await using tmp = await tmpdir({
      config: {
        default_agent: "pulse",
        agent: {
          pulse: {
            name: "Pulse",
            description: "assistant",
          },
        },
      },
    })
    const { agent, stop, prompts } = createFakeAgent({})

    const session = await agent.newSession({ cwd: tmp.path, mcpServers: [] } as any)
    await agent.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "hello" }] } as any)

    expect(prompts[0]?.agent).toBe("pulse")
    stop()
  })
})
