import { describe, expect, test } from "bun:test"
import { ACP } from "../../src/acp/agent"
import type { AgentSideConnection } from "@agentclientprotocol/sdk"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

function createFakeAgent(agents: any[] = []) {
  const calls = {
    eventSubscribe: 0,
    sessionCreate: 0,
  }

  const connection = {
    async sessionUpdate() {},
    async requestPermission() {
      return { outcome: { outcome: "selected", optionId: "once" } }
    },
  } as unknown as AgentSideConnection

  const sdk = {
    global: {
      event: async (opts?: { signal?: AbortSignal }) => {
        calls.eventSubscribe++
        const stream = async function* () {
          await new Promise(() => {})
        }
        return { stream: stream() }
      },
    },
    session: {
      create: async () => {
        calls.sessionCreate++
        return {
          data: {
            id: `ses_${calls.sessionCreate}`,
            time: { created: new Date().toISOString() },
          },
        }
      },
      get: async () => ({
        data: { id: "ses_1", time: { created: new Date().toISOString() } },
      }),
      messages: async () => ({ data: [] }),
    },
    config: {
      providers: async () => ({
        data: {
          providers: [
            {
              id: "test-provider",
              name: "Test Provider",
              models: {
                "model-a": { id: "model-a", name: "Model A" },
                "model-b": { id: "model-b", name: "Model B" },
              },
            },
          ],
        },
      }),
    },
    app: {
      agents: async () => ({ data: agents }),
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
    defaultModel: { providerID: "test-provider", modelID: "model-a" },
  } as any)

  const stop = () => {
    ;(agent as any).eventAbort.abort()
  }

  const sessionManager = () => (agent as any).sessionManager

  return { agent, stop, sdk, sessionManager }
}

describe("acp.agent setSessionMode", () => {
  test("updates session model when selected mode has a configured model", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, stop, sessionManager } = createFakeAgent([
          { name: "build", description: "default", mode: "primary" },
          {
            name: "custom",
            description: "custom agent",
            mode: "primary",
            model: { providerID: "test-provider", modelID: "model-b" },
            variant: "high",
          },
        ])
        const cwd = "/tmp/opencode-acp-test"

        const sessionId = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)

        const before = sessionManager().getModel(sessionId)
        expect(before.providerID).toBe("test-provider")
        expect(before.modelID).toBe("model-a")

        await agent.setSessionMode({ sessionId, modeId: "custom" })

        const after = sessionManager().getModel(sessionId)
        expect(after.providerID).toBe("test-provider")
        expect(after.modelID).toBe("model-b")
        expect(sessionManager().getVariant(sessionId)).toBe("high")

        stop()
      },
    })
  })

  test("does not change session model when selected mode has no configured model", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, stop, sessionManager } = createFakeAgent([
          { name: "build", description: "default", mode: "primary" },
          { name: "plan", description: "plan mode", mode: "primary" },
        ])
        const cwd = "/tmp/opencode-acp-test"

        const sessionId = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)

        await agent.setSessionMode({ sessionId, modeId: "plan" })

        const after = sessionManager().getModel(sessionId)
        expect(after.providerID).toBe("test-provider")
        expect(after.modelID).toBe("model-a")

        stop()
      },
    })
  })

  test("throws when mode does not exist", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, stop } = createFakeAgent([
          { name: "build", description: "default", mode: "primary" },
        ])
        const cwd = "/tmp/opencode-acp-test"

        const sessionId = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)

        expect(agent.setSessionMode({ sessionId, modeId: "nonexistent" })).rejects.toThrow("Agent not found")

        stop()
      },
    })
  })

  test("switching modes updates model each time", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, stop, sessionManager } = createFakeAgent([
          {
            name: "agent-a",
            description: "agent a",
            mode: "primary",
            model: { providerID: "test-provider", modelID: "model-a" },
          },
          {
            name: "agent-b",
            description: "agent b",
            mode: "primary",
            model: { providerID: "test-provider", modelID: "model-b" },
          },
        ])
        const cwd = "/tmp/opencode-acp-test"

        const sessionId = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)

        await agent.setSessionMode({ sessionId, modeId: "agent-b" })
        expect(sessionManager().getModel(sessionId).modelID).toBe("model-b")

        await agent.setSessionMode({ sessionId, modeId: "agent-a" })
        expect(sessionManager().getModel(sessionId).modelID).toBe("model-a")

        stop()
      },
    })
  })
})
