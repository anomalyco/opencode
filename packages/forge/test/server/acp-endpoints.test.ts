import { describe, expect, test, afterEach, beforeAll } from "bun:test"
import { Server } from "../../src/server/server"
import { ACPOrchestrator } from "../../src/acp/orchestrator"
import { Instance } from "../../src/project/instance"
import { InstanceBootstrap } from "../../src/project/bootstrap"

type MockState = NonNullable<ReturnType<typeof ACPOrchestrator.getState>>

const original = {
  setAgent: ACPOrchestrator.setAgent,
  setMode: ACPOrchestrator.setMode,
  setModel: ACPOrchestrator.setModel,
  getState: ACPOrchestrator.getState,
}

afterEach(() => {
  // Restore orchestrator functions after each test
  ;(ACPOrchestrator as any).setAgent = original.setAgent
  ;(ACPOrchestrator as any).setMode = original.setMode
  ;(ACPOrchestrator as any).setModel = original.setModel
  ;(ACPOrchestrator as any).getState = original.getState
})

beforeAll(() => {
  process.env.FORGE_DISABLE_DEFAULT_PLUGINS = "true"
  process.env.FORGE_DISABLE_LSP_DOWNLOAD = "true"
})

function mockState(): MockState {
  return {
    sessionID: "session-mock",
    agent: {
      name: "Codex CLI",
      description: "",
      installMethod: "npx",
      command: "npx",
      args: [],
    },
    client: null,
    acpSessionID: "acp-mock",
    models: {
      availableModels: [{ modelId: "default" }],
      currentModelId: "default",
    },
    modes: {
      availableModes: [{ id: "build", name: "Build" }],
      currentModeId: "build",
    },
  }
}

describe("ACP session control endpoints", () => {
  test("POST /session/:id/agent wires through to orchestrator", async () => {
    const state = mockState()
    ;(ACPOrchestrator as any).setAgent = async () => state

    await Instance.provide({
      directory: process.cwd(),
      init: InstanceBootstrap,
      async fn() {
        const app = await Server.App()
        const res = await app.request("/session/test/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agent: "Codex CLI" }),
        })
        expect(res.status).toBe(200)
        const json = await res.json()
        expect(json.agent).toBe("Codex CLI")
      },
    })
  })

  test("POST /session/:id/mode wires through to orchestrator", async () => {
    const state = mockState()
    ;(ACPOrchestrator as any).setMode = async () => {}
    ;(ACPOrchestrator as any).getState = () => state

    await Instance.provide({
      directory: process.cwd(),
      init: InstanceBootstrap,
      async fn() {
        const app = await Server.App()
        const res = await app.request("/session/test/mode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "build" }),
        })
        expect(res.status).toBe(200)
        const json = await res.json()
        expect(json.modes.currentModeId).toBe("build")
      },
    })
  })

  test("POST /session/:id/model wires through to orchestrator", async () => {
    const state = mockState()
    ;(ACPOrchestrator as any).setModel = async () => {}
    ;(ACPOrchestrator as any).getState = () => state

    await Instance.provide({
      directory: process.cwd(),
      init: InstanceBootstrap,
      async fn() {
        const app = await Server.App()
        const res = await app.request("/session/test/model", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: "default" }),
        })
        expect(res.status).toBe(200)
        const json = await res.json()
        expect(json.models.currentModelId).toBe("default")
      },
    })
  })
})
