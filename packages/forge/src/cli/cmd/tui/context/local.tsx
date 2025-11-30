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
import { getAllAgents, getAgent, type ACPAgentDefinition } from "@/acp/agents"
import type { SessionModeId, SessionModeState } from "@agentclientprotocol/sdk"

export const { use: useLocal, provider: LocalProvider } = createSimpleContext({
  name: "Local",
  init: () => {
    const sync = useSync()
    const toast = useToast()

    // Session state for ACP client
    const [sessionStore, setSessionStore] = createStore<{
      sessionId: string | null
      agentName: string | null
      modes: SessionModeState | null
      client: ACPClient.Instance | null
    }>({
      sessionId: null,
      agentName: null,
      modes: null,
      client: null,
    })

    const agent = iife(() => {
      const agents = createMemo(() => getAllAgents().filter((x) => x.installMethod !== "skip"))
      const [agentStore, setAgentStore] = createStore<{
        current: string
      }>({
        current: agents()[0].name,
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
              setSessionStore("client", client)
              setAgentStore("current", agentName)
            })

            // Setup mode change listener
            if (client.getCurrentMode()) {
              client.onModeChange((newModeId) => {
                setSessionStore("modes", "currentModeId", newModeId)
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
        cycle() {
          const modes = sessionStore.modes?.availableModes ?? []
          if (modes.length === 0) return

          const currentMode = sessionStore.modes?.currentModeId
          const currentIndex = modes.findIndex((m) => m.id === currentMode)
          const nextIndex = (currentIndex + 1) % modes.length
          const nextMode = modes[nextIndex]

          this.set(nextMode.id)
        },
        getName(modeId: SessionModeId) {
          const modes = sessionStore.modes?.availableModes ?? []
          return modes.find((m) => m.id === modeId)?.name ?? modeId
        },
      }
    })

    const result = {
      agent,
      mode,
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
      },
    }
    return result
  },
})
