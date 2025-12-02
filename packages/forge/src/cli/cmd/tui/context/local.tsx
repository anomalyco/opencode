import { createStore } from "solid-js/store"
import { batch, createEffect, createMemo } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { uniqueBy } from "remeda"
import path from "path"
import { Global } from "@/global"
import { iife } from "@/util/iife"
import { createSimpleContext } from "./helper"
import { useToast } from "../ui/toast"
import { RGBA } from "@opentui/core"
import { ACPClient } from "@/acp/client"
import { getAllAgents, getAgent, DEFAULT_AGENT, type ACPAgentDefinition } from "@/acp/agents"
import type { SessionModeId, SessionModeState, SessionModelState, ModelId } from "@agentclientprotocol/sdk"
import { useKV } from "./kv"

export const { use: useLocal, provider: LocalProvider } = createSimpleContext({
  name: "Local",
  init: () => {
    const sync = useSync()
    const toast = useToast()
    const kv = useKV()

    // Session state for ACP client
    const [sessionStore, setSessionStore] = createStore<{
      sessionId: string | null
      agentName: string | null
      modes: SessionModeState | null
      models: SessionModelState | null
      client: ACPClient.Instance | null
    }>({
      sessionId: null,
      agentName: null,
      modes: null,
      models: null,
      client: null,
    })

    const agent = iife(() => {
      const agents = createMemo(() => getAllAgents().filter((x) => x.installMethod !== "skip"))
      const [agentStore, setAgentStore] = createStore<{
        current: string
      }>({
        current: kv.get("agent", DEFAULT_AGENT.name),
      })
      const { theme } = useTheme()
      const colors = createMemo(() => [
        theme.secondary,
        theme.accent,
        theme.success,
        theme.warning,
        theme.primary,
        theme.error,
      ])

      return {
        list() {
          return agents()
        },
        current() {
          return agents().find((x) => x.name === agentStore.current)!
        },
        async set(agentName: string) {
          const agentDef = getAgent(agentName)
          if (!agentDef) {
            return toast.show({
              variant: "warning",
              message: `Agent not found: ${agentName}`,
              duration: 3000,
            })
          }

          // Check if system agent is installed
          if (agentDef.installMethod === "system" && agentDef.installCheck) {
            const checkResult = Bun.spawnSync(["sh", "-c", agentDef.installCheck])
            if (checkResult.exitCode !== 0) {
              return toast.show({
                variant: "warning",
                message: `Agent ${agentDef.name} is not installed. See: ${agentDef.installGuide}`,
                duration: 5000,
              })
            }
          }

          try {
            // Dispose existing client if any
            if (sessionStore.client) {
              await sessionStore.client.dispose()
            }

            // Create ACP client
            const client = await ACPClient.create({
              command: agentDef.command,
              args: agentDef.args,
              cwd: process.cwd(),
              env: agentDef.envRequired?.reduce((acc, key) => {
                const value = process.env[key]
                if (value) acc[key] = value
                return acc
              }, {} as Record<string, string>),
            })

            // Initialize
            const initResp = await client.initialize()

            // Handle auth if needed
            if (initResp.authMethods && initResp.authMethods.length > 0) {
              // For now, just use first auth method
              // TODO: Prompt user to select auth method
              await client.authenticate(initResp.authMethods[0].id)
            }

            // Create session
            const sessionResp = await client.createSession()

            // Store session state
            batch(() => {
              setSessionStore("sessionId", sessionResp.sessionId)
              setSessionStore("agentName", agentName)
              setSessionStore("modes", sessionResp.modes ?? null)
              setSessionStore("models", sessionResp.models ?? null)
              setSessionStore("client", client)
              setAgentStore("current", agentName)
              kv.set("agent", agentName)
            })

            // Setup mode change listener
            if (client.getCurrentMode()) {
              client.onModeChange((newModeId) => {
                setSessionStore("modes", "currentModeId", newModeId)
              })
            }

            // Setup model change listener
            if (client.getCurrentModel()) {
              client.onModelChange((newModelId) => {
                setSessionStore("models", "currentModelId", newModelId)
              })
            }

            toast.show({
              variant: "success",
              message: `Connected to ${agentDef.name}`,
              duration: 2000,
            })
          } catch (error) {
            toast.show({
              variant: "error",
              message: `Failed to connect to ${agentDef.name}: ${error instanceof Error ? error.message : String(error)}`,
              duration: 5000,
            })
          }
        },
        move(direction: 1 | -1) {
          batch(() => {
            let next = agents().findIndex((x) => x.name === agentStore.current) + direction
            if (next < 0) next = agents().length - 1
            if (next >= agents().length) next = 0
            const value = agents()[next]
            setAgentStore("current", value.name)
          })
        },
        color(agentName: string) {
          const index = agents().findIndex((x) => x.name === agentName)
          return colors()[index % colors().length]
        },
        isInstalled(agentName: string) {
          const agentDef = getAgent(agentName)
          if (!agentDef) return false

          // npx/uvx agents are always "available"
          if (agentDef.installMethod !== "system") return true

          // Check system agents
          if (agentDef.installCheck) {
            const checkResult = Bun.spawnSync(["sh", "-c", agentDef.installCheck])
            return checkResult.exitCode === 0
          }

          return false
        },
      }
    })

    const mode = iife(() => {
      return {
        list() {
          return sessionStore.modes?.availableModes ?? []
        },
        current() {
          return sessionStore.modes?.currentModeId ?? null
        },
        async set(modeId: SessionModeId) {
          if (!sessionStore.client) {
            return toast.show({
              variant: "warning",
              message: "No active session. Connect to an agent first.",
              duration: 3000,
            })
          }

          try {
            await sessionStore.client.setMode(modeId)
            setSessionStore("modes", "currentModeId", modeId)
          } catch (error) {
            toast.show({
              variant: "error",
              message: `Failed to set mode: ${error instanceof Error ? error.message : String(error)}`,
              duration: 3000,
            })
          }
        },
        cycle(direction: 1 | -1 = 1) {
          const modes = sessionStore.modes?.availableModes ?? []
          if (modes.length === 0) return

          const currentMode = sessionStore.modes?.currentModeId
          const currentIndex = modes.findIndex((m) => m.id === currentMode)
          let nextIndex = (currentIndex + direction) % modes.length
          // Handle negative modulo for reverse cycling
          if (nextIndex < 0) nextIndex = modes.length + nextIndex
          const nextMode = modes[nextIndex]

          this.set(nextMode.id)
        },
        getName(modeId: SessionModeId) {
          const modes = sessionStore.modes?.availableModes ?? []
          return modes.find((m) => m.id === modeId)?.name ?? modeId
        },
      }
    })

    const model = iife(() => {
      const label = (modelId: ModelId | null) => {
        if (!modelId) return "Default model"
        const models = sessionStore.models?.availableModels ?? []
        const modelInfo = models.find((m) => m.modelId === modelId)
        return modelInfo?.name ?? modelId
      }
      return {
        list() {
          return sessionStore.models?.availableModels ?? []
        },
        current() {
          return sessionStore.models?.currentModelId ?? null
        },
        label() {
          return label(sessionStore.models?.currentModelId ?? null)
        },
        async set(modelId: ModelId) {
          if (!sessionStore.client) {
            return toast.show({
              variant: "warning",
              message: "No active session. Connect to an agent first.",
              duration: 3000,
            })
          }

          try {
            await sessionStore.client.setModel(modelId)
            setSessionStore("models", "currentModelId", modelId)

            const modelInfo = sessionStore.models?.availableModels?.find((m) => m.modelId === modelId)
            toast.show({
              variant: "success",
              message: `Switched to ${modelInfo?.name ?? modelId}`,
              duration: 2000,
            })
          } catch (error) {
            toast.show({
              variant: "error",
              message: `Failed to set model: ${error instanceof Error ? error.message : String(error)}`,
              duration: 3000,
            })
          }
        },
        cycle() {
          const models = sessionStore.models?.availableModels ?? []
          if (models.length === 0) return

          const currentModel = sessionStore.models?.currentModelId
          const currentIndex = models.findIndex((m) => m.modelId === currentModel)
          const nextIndex = (currentIndex + 1) % models.length
          const nextModel = models[nextIndex]

          this.set(nextModel.modelId)
        },
        getName(modelId: ModelId) {
          const models = sessionStore.models?.availableModels ?? []
          return models.find((m) => m.modelId === modelId)?.name ?? modelId
        },
      }
    })

    const result = {
      agent,
      mode,
      model,
      session: {
        get id() {
          return sessionStore.sessionId
        },
        get client() {
          return sessionStore.client
        },
        get modes() {
          return sessionStore.modes
        },
        get models() {
          return sessionStore.models
        },
      },
    }
    return result
  },
})
