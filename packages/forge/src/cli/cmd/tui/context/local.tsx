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
import { useDialog } from "../ui/dialog"
import { RGBA } from "@opentui/core"
import { ACPClient } from "@/acp/client"
import { getAllAgents, getAgent, DEFAULT_AGENT, type ACPAgentDefinition } from "@/acp/agents"
import type { SessionModeId, SessionModeState, SessionModelState, AuthMethod } from "@agentclientprotocol/sdk"
import { useKV } from "./kv"
import { ACPAuthManager } from "@/acp/auth"
import { AgentConnector, AgentNotInstalledError, ConnectionAbortedError } from "@/acp/connection"
import { AuthenticationRequiredError } from "@/acp/types"
import { Log } from "@/util/log"
import { useSDK } from "@tui/context/sdk"
import { useRoute } from "@tui/context/route"
import { DialogAuth } from "@tui/component/dialog-auth"

export const { use: useLocal, provider: LocalProvider } = createSimpleContext({
  name: "Local",
  init: () => {
    const log = Log.create({ service: "tui-local" })
    const sync = useSync()
    const toast = useToast()
    const kv = useKV()
    const route = useRoute()
    const sdk = useSDK()

    const currentSessionID = () => {
      return route.data.type === "session" ? route.data.sessionID : null
    }

    const postSessionState = async (
      sessionID: string | null,
      path: "agent" | "mode" | "model",
      body: Record<string, any>,
    ) => {
      if (!sessionID) return null
      if (!sdk?.client?.session) throw new Error("SDK client unavailable")

      switch (path) {
        case "agent":
          return sdk.client.session.agent({
            path: { id: sessionID },
            body: { agent: body.agent },
          })
        case "mode":
          return sdk.client.session.mode({
            path: { id: sessionID },
            body: { mode: body.mode },
          })
        case "model":
          return sdk.client.session.model({
            path: { id: sessionID },
            body: { model: body.model },
          })
        default:
          throw new Error(`Unsupported session path: ${path}`)
      }
    }

    // Session state for ACP client
    const [sessionStore, setSessionStore] = createStore<{
      sessionId: string | null
      agentName: string | null
      modes: SessionModeState | null
      models: SessionModelState | null
      client: ACPClient.Instance | null
      authMethods: AuthMethod[] | null
      switching: boolean
      switchingTo: string | null
    }>({
      sessionId: null,
      agentName: null,
      modes: null,
      models: null,
      client: null,
      authMethods: null,
      switching: false,
      switchingTo: null,
    })

    const agent = iife(() => {
      const agents = createMemo(() => getAllAgents())
      const [agentStore, setAgentStore] = createStore<{
        current: string | null
      }>({
        current: kv.get("agent", null),
      })
      let lastSyncedAgent: { sessionID: string; agent: string } | null = null
      let connectVersion = 0
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
          if (!agentStore.current) return null
          return agents().find((x) => x.name === agentStore.current) ?? null
        },
        async set(agentName: string, dialog?: ReturnType<typeof useDialog>) {
          setSessionStore({
            switching: true,
            switchingTo: agentName,
          })
          const version = ++connectVersion
          const agentDef = getAgent(agentName)
          if (!agentDef) {
            setSessionStore({
              switching: false,
              switchingTo: null,
            })
            return toast.show({
              variant: "warning",
              message: `Agent not found: ${agentName}`,
              duration: 3000,
            })
          }

          try {
            // Get MCP config from sync data (loaded from server)
            const mcpConfig = sync.data.config.mcp

            // Connect to agent
            const result = await AgentConnector.connect({
              agentDef,
              cwd: process.cwd(),
              mcp: mcpConfig,
              existingClient: sessionStore.client,
              version,
              onStaleCheck: (currentVersion) => currentVersion !== connectVersion,
              onSelectAuthMethod: dialog
                ? async (methods) => {
                    const selected = await DialogAuth.show(dialog, agentDef.name, methods)
                    // Clear dialog after selection (whether successful or cancelled)
                    dialog.clear()
                    return selected
                  }
                : undefined,
            })

            // Store session state
            // Replace the whole tree in one go so Solid doesn't merge into stale readonly proxies
            batch(() => {
              setSessionStore({
                sessionId: result.sessionId,
                agentName,
                modes: result.modes,
                models: result.models,
                client: result.client,
                authMethods: result.authMethods,
              })
              setAgentStore("current", agentName)
              kv.set("agent", agentName)
            })

            // Setup mode change listener
            if (result.client.getCurrentMode()) {
              result.client.onModeChange((newModeId) => {
                setSessionStore("modes", "currentModeId", newModeId)
              })
            }

            // Setup model change listener
            if (result.client.getCurrentModel()) {
              result.client.onModelChange((newModelId) => {
                setSessionStore("models", "currentModelId", newModelId)
              })
            }

            // Sync with server session
            const sessionID = currentSessionID()
            if (sessionID) {
              try {
                await postSessionState(sessionID, "agent", { agent: agentDef.name })
              } catch (error) {
                toast.show({
                  variant: "warning",
                  message: `Failed to sync agent to session: ${error instanceof Error ? error.message : String(error)}`,
                  duration: 4000,
                })
              }
            }
          } catch (error) {
            // Handle installation errors
            if (error instanceof AgentNotInstalledError) {
              return toast.show({
                variant: "warning",
                message: `Agent ${error.agentName} is not installed.${error.installGuide ? ` See: ${error.installGuide}` : ""}`,
                duration: 5000,
              })
            }

            // Handle connection abortion (race condition)
            if (error instanceof ConnectionAbortedError) {
              log.debug("agent.connect.aborted", { agent: agentName })
              return
            }

            // Log the error
            log.error("agent.connect.failed", {
              agent: agentName,
              error: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined,
            })

            // Check if this is an authentication error
            const authError = ACPAuthManager.isAuthError(error)
            if (authError.isAuthError) {
              const authMethodsFromError =
                error instanceof AuthenticationRequiredError ? error.authMethods : sessionStore.authMethods ?? []

              const lines =
                authMethodsFromError?.map((method) => {
                  const name = method.name ?? method.id ?? "Authentication method"
                  return method.description ? `- ${name}: ${method.description}` : `- ${name}`
                }) ?? []

              const message =
                lines.length > 0
                  ? `${agentDef.name} requires authentication. Available methods:\n${lines.join("\n")}`
                  : ACPAuthManager.formatAuthMessage(agentDef.name, authError.instruction, authMethodsFromError?.[0])

              toast.show({
                variant: "warning",
                message,
                duration: 10000,
              })
              return
            }

            // Generic error handling
            const errorMessage = error instanceof Error
              ? error.message
              : typeof error === "object" && error !== null
                ? JSON.stringify(error)
                : String(error)

            // Surface stack traces to stderr and logs while we track down agent init issues
            console.error(`Failed to connect to ${agentDef.name}:`, error, error instanceof Error ? error.stack : undefined)

            toast.show({
              variant: "error",
              message: `Failed to connect to ${agentDef.name}: ${errorMessage}`,
              duration: 5000,
            })
          }
          setSessionStore({
            switching: false,
            switchingTo: null,
          })
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
        color(agentName: string | null) {
          if (!agentName) {
            return theme.textMuted
          }
          const agentDef = getAgent(agentName)
          if (agentDef?.color) {
            return RGBA.fromHex(agentDef.color)
          }
          const index = agents().findIndex((x) => x.name === agentName)
          if (index === -1) {
            return colors()[0]
          }
          return colors()[index % colors().length]
        },
        isInstalled(agentName: string) {
          const agentDef = getAgent(agentName)
          if (!agentDef) return false

          return Bun.which(agentDef.command) !== null
        },
      }

      createEffect(async () => {
        const sessionID = currentSessionID()
        if (!sessionID) return
        const agentName = agentStore.current
        if (!agentName) return // Don't sync null agent to server
        if (lastSyncedAgent && lastSyncedAgent.sessionID === sessionID && lastSyncedAgent.agent === agentName) return

        try {
          await postSessionState(sessionID, "agent", { agent: agentName })
          lastSyncedAgent = { sessionID, agent: agentName }
        } catch (error) {
          toast.show({
            variant: "warning",
            message: `Failed to sync agent: ${error instanceof Error ? error.message : String(error)}`,
            duration: 3000,
          })
        }
      })
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

            const sessionID = currentSessionID()
            if (sessionID) {
              await postSessionState(sessionID, "mode", { mode: modeId }).catch((error) => {
                toast.show({
                  variant: "warning",
                  message: `Failed to sync mode: ${error instanceof Error ? error.message : String(error)}`,
                  duration: 3000,
                })
              })
            }
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
      const label = (modelId: string | null) => {
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
        async set(modelId: string) {
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

            const sessionID = currentSessionID()
            if (sessionID) {
              await postSessionState(sessionID, "model", { model: modelId }).catch((error) => {
                toast.show({
                  variant: "warning",
                  message: `Failed to sync model: ${error instanceof Error ? error.message : String(error)}`,
                  duration: 3000,
                })
              })
            }
          } catch (error) {
            toast.show({
              variant: "error",
              message: `Failed to set model: ${error instanceof Error ? error.message : String(error)}`,
              duration: 3000,
            })
          }
        },
        cycle(direction: 1 | -1 = 1) {
          const models = sessionStore.models?.availableModels ?? []
          if (models.length === 0) return

          const currentModel = sessionStore.models?.currentModelId
          const currentIndex = models.findIndex((m) => m.modelId === currentModel)
          let nextIndex = (currentIndex + direction) % models.length
          // Handle negative modulo for reverse cycling
          if (nextIndex < 0) nextIndex = models.length + nextIndex
          const nextModel = models[nextIndex]

          this.set(nextModel.modelId)
        },
        getName(modelId: string) {
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
        get switching() {
          return sessionStore.switching
        },
        get switchingTo() {
          return sessionStore.switchingTo
        },
        setSwitching(flag: boolean, target?: string | null) {
          setSessionStore({
            switching: flag,
            switchingTo: flag ? target ?? sessionStore.switchingTo : null,
          })
        },
      },
    }
    return result
  },
})
