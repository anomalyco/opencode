/**
 * Backend Context Provider
 *
 * Manages the active backend ("opencode" native vs external agent via sandbox-agent).
 * When an external agent is selected:
 *   1. Calls the gateway API to spawn sandbox-agent subprocess
 *   2. The gateway's forwarding middleware transparently routes OpenCode API requests
 *      to sandbox-agent — no server URL change needed on the frontend
 */

import { createEffect, createSignal, on, type ParentComponent, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { Persist, persisted } from "@/utils/persist"
import { showToast } from "@opencode-ai/ui/toast"

export type AgentKind = "opencode" | "claude" | "codex" | "amp"

/**
 * Module-level signal that tracks whether an external agent is active.
 * Used by the extension system (hideModelSelector) for reactive UI updates
 * without needing the full context.
 */
const [_externalAgentActive, _setExternalAgentActive] = createSignal(false)
export const isExternalAgentActive = _externalAgentActive

/**
 * Module-level signal that tracks the currently selected CLI agent.
 * Used by the extension system (modelProviderFilter) for reactive UI updates.
 */
const [_currentAgent, _setCurrentAgent] = createSignal<AgentKind>("opencode")
export const currentAgent = _currentAgent

/**
 * Get the provider ID filter for the model selector based on the selected CLI agent.
 * - claude → anthropic
 * - codex → openai
 * - opencode/amp → undefined (show all)
 */
export function getModelProviderFilter(): string | undefined {
  const agent = _currentAgent()
  switch (agent) {
    case "claude":
      return "anthropic"
    case "codex":
      return "openai"
    default:
      return undefined
  }
}

const AGENT_LABELS: Record<AgentKind, string> = {
  opencode: "OpenCode",
  claude: "Claude Code",
  codex: "Codex",
  amp: "Amp",
}

export const AGENT_OPTIONS = Object.entries(AGENT_LABELS).map(([value, label]) => ({
  value: value as AgentKind,
  label,
}))

/**
 * Call the gateway API to spawn sandbox-agent.
 * Returns true on success, false on failure (with toast).
 */
async function requestSpawn(agent: string): Promise<boolean> {
  try {
    const res = await fetch("/api/sandbox-agent/spawn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent }),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      showToast({
        variant: "error",
        title: "Cannot start sandbox-agent",
        description: (data as any).message || (data as any).error || "Failed to start",
      })
      return false
    }

    return true
  } catch (err: any) {
    showToast({
      variant: "error",
      title: "Cannot reach gateway",
      description: err?.message || "Network error",
    })
    return false
  }
}

/**
 * Call the gateway API to stop sandbox-agent.
 */
function requestStop(): void {
  fetch("/api/sandbox-agent/stop", { method: "POST" }).catch(() => {})
}

/**
 * Check if sandbox-agent is running via the gateway status API.
 */
async function checkSandboxStatus(): Promise<{ running: boolean; agent: string | null }> {
  try {
    const res = await fetch("/api/sandbox-agent/status")
    if (!res.ok) return { running: false, agent: null }
    const data = (await res.json()) as any
    return { running: !!data.running, agent: data.agent }
  } catch {
    return { running: false, agent: null }
  }
}

export const { use: useBackend, provider: BackendProvider } = createSimpleContext({
  name: "Backend",
  init: () => {
    const [connecting, setConnecting] = createSignal(false)

    const [store, setStore, _, ready] = persisted(
      Persist.global("backend", ["backend.v3", "backend.v2", "backend.v1"]),
      createStore({
        agent: "opencode" as AgentKind,
      }),
    )

    // Auto-reconnect on page load if an external agent was previously selected.
    // Uses on(ready, ...) so it only fires once when persistence loads, not on every store change.
    createEffect(
      on(ready, async (isReady) => {
        if (!isReady) return

        // Sync the current agent signal with persisted value
        _setCurrentAgent(store.agent)

        if (store.agent === "opencode") return

        setConnecting(true)

        // Check if sandbox-agent is still running; if not, try to respawn
        const status = await checkSandboxStatus()
        if (!status.running) {
          const ok = await requestSpawn(store.agent)
          if (!ok) {
            setConnecting(false)
            setStore({ agent: "opencode" })
            _setExternalAgentActive(false)
            _setCurrentAgent("opencode")
            return
          }
        }

        _setExternalAgentActive(true)
        setConnecting(false)
      }),
    )

    return {
      ready,
      get agent() {
        return store.agent
      },
      get isNative() {
        return store.agent === "opencode"
      },
      get label() {
        return AGENT_LABELS[store.agent]
      },
      get connecting() {
        return connecting()
      },

      /**
       * Switch to an external agent via sandbox-agent.
       * Calls the gateway to spawn sandbox-agent — the gateway's forwarding middleware
       * then transparently routes all OpenCode API requests to it.
       */
      async selectAgent(agent: AgentKind) {
        if (agent === "opencode") {
          this.disconnect()
          return
        }

        // Show spinner immediately
        setConnecting(true)

        // Ask the gateway to spawn sandbox-agent
        const ok = await requestSpawn(agent)
        if (!ok) {
          setConnecting(false)
          return
        }

        // Gateway is now forwarding requests to sandbox-agent
        setStore({ agent })
        _setExternalAgentActive(true)
        _setCurrentAgent(agent)
        setConnecting(false)
      },

      /**
       * Disconnect and switch back to native OpenCode.
       */
      disconnect() {
        requestStop()
        setStore({ agent: "opencode" })
        _setExternalAgentActive(false)
        _setCurrentAgent("opencode")
      },
    }
  },
})

/**
 * Factory to create BackendProvider as a ParentComponent
 * for use in the extension system's authenticatedProviders.
 */
export function createBackendProvider(): ParentComponent {
  return (props: ParentProps) => <BackendProvider>{props.children}</BackendProvider>
}
