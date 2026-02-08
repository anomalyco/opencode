/**
 * Agent Lifecycle Listener
 *
 * Subscribes to agent.lifecycle events from the server and updates
 * tab status indicators (loading spinner, attention dot).
 *
 * STATUS TRACKING:
 * - Status is tracked PER TERMINAL (PTY ID), not per tab
 * - Tab status is AGGREGATED from all terminals within the tab
 * - This allows multiple agents to run in split terminals correctly
 *
 * SESSION STATUS TRACKING:
 * - Subscribes to session.status events to show loading/done dots on session tabs
 * - Sound is played when a session completes and the tab is not active
 * - This unifies the notification behavior between terminal CLI agents and sessions
 */

import { createEffect, onCleanup } from "solid-js"
import { useGlobalSDK } from "@/context/global-sdk"
import { useSettings } from "@/context/settings"
import { playSound, soundSrc } from "@/utils/sound"
import { useClaxedoLayout, type TabItem, type TerminalAgentStatus } from "../claxedo-ui/context/claxedo-layout"

/**
 * Hook that listens for agent lifecycle events and updates tab status
 *
 * STATUS MAPPING:
 * - Start → loading: true (amber spinning indicator)
 * - Stop → loading: false
 * - PermissionRequest → attention: true (red pulsing dot)
 *
 * The attention indicator is cleared when the user focuses the tab.
 *
 * Note: Uses globalSDK to listen to events from all directories.
 */
export function useAgentLifecycleListener() {
  const globalSDK = useGlobalSDK()
  const claxedo = useClaxedoLayout()
  const settings = useSettings()

  createEffect(() => {
    // Listen to "global" directory for agent lifecycle events
    // These events are sent without a specific directory context
    const unsub = globalSDK.event.on("global", (event) => {
      const payload = event as unknown as { type: string; properties: unknown }

      if (payload.type !== "agent.lifecycle") return

      const { tabId, terminalId, eventType } = payload.properties as {
        tabId: string
        terminalId?: string
        workspaceId?: string
        eventType: "Start" | "Stop" | "PermissionRequest"
      }

      const actualTerminalId = terminalId || tabId

      // Update per-terminal status first, even if we can't map it to a tab yet.
      // This prevents losing state when events arrive before the terminal tab is created/migrated.
      const terminalStatus: TerminalAgentStatus = (() => {
        if (eventType === "Start") return "working"
        if (eventType === "Stop") return "idle"
        return "permission"
      })()

      claxedo.terminal.setAgentStatus(actualTerminalId, terminalStatus)

      // Find the tab to update
      const tabs = claxedo.topTabs.items()

      let tab = tabs.find((t) => t.id === tabId)

      // If not found by tabId, look for a terminal tab that owns this PTY
      if (!tab && terminalId) {
        tab = tabs.find((t) => t.type === "terminal" && t.terminalId === terminalId)
      }

      // Also try using tabId as terminalId (shell hooks pass PTY ID as tabId for simplicity)
      if (!tab) {
        tab = tabs.find((t) => t.type === "terminal" && t.terminalId === tabId)
      }

      // For split pane terminals: look up the owner tab via terminalOwner mapping
      if (!tab) {
        const ptyId = terminalId || tabId
        const ownerTabId = claxedo.terminal.owner(ptyId)
        if (ownerTabId) {
          tab = tabs.find((t) => t.id === ownerTabId)
        }
      }

      if (!tab) return

      // Check if this tab is currently active
      const isActiveTab = claxedo.topTabs.activeId() === tab.id

      // For Stop events: show done dot if tab is not active (user is "away")
      // This handles Codex which doesn't send Start events
      if (eventType === "Stop" && !isActiveTab) {
        claxedo.topTabs.patch(tab.id, { loading: false, done: true })
        // Play sound notification
        playSound(soundSrc(settings.sounds.agent()))
        return
      }

      // Compute aggregated tab status from all terminals in this tab
      const aggregated = claxedo.terminal.getTabAgentStatus(tab.id)

      // Update the tab with aggregated status
      const patch: { loading: boolean; attention?: boolean; done?: boolean } = {
        loading: aggregated.loading,
        done: aggregated.done,
      }

      // Attention handling:
      // - Set attention=true when THIS terminal sends PermissionRequest
      // - Clear attention only when all terminals are idle (no more permission needed)
      // - User focus clears attention (handled by useClearAttentionOnFocus)
      if (eventType === "PermissionRequest") {
        patch.attention = true
      } else if (!aggregated.attention) {
        patch.attention = false
      }

      claxedo.topTabs.patch(tab.id, patch)
    })

    onCleanup(() => {
      unsub()
    })
  })
}

/**
 * Hook that listens for session status events and updates session tab indicators
 *
 * STATUS MAPPING:
 * - session.status busy/retry → loading: true (amber spinning indicator)
 * - session.status idle → loading: false, done: true if tab is inactive
 * - session.error → loading: false, done: true if tab is inactive
 *
 * Sound is played when a session completes/errors and the tab is not active,
 * matching the behavior of terminal CLI agents.
 */
export function useSessionStatusListener() {
  const globalSDK = useGlobalSDK()
  const claxedo = useClaxedoLayout()
  const settings = useSettings()

  createEffect(() => {
    // Listen to all directories for session events
    const unsub = globalSDK.event.listen((e) => {
      const event = e.details as unknown as { type: string; properties: Record<string, any> }
      const directory = e.name

      if (event.type === "session.status") {
        const { sessionID, status } = event.properties as {
          sessionID: string
          status: { type: string }
        }

        const result = findSessionTab(claxedo.split.groups(), directory, sessionID)
        if (!result) return

        const { tab, groupId } = result
        const isActive =
          claxedo.split.focusedId() === groupId &&
          claxedo.split.groups().find((g) => g.id === groupId)?.tabs.activeId === tab.id

        if (status.type === "busy" || status.type === "retry") {
          claxedo.patchTab(tab.id, { loading: true, done: false })
        } else if (status.type === "idle") {
          if (!isActive) {
            claxedo.patchTab(tab.id, { loading: false, done: true })
            playSound(soundSrc(settings.sounds.agent()))
          } else {
            claxedo.patchTab(tab.id, { loading: false })
          }
        }
      }

      if (event.type === "session.error") {
        const { sessionID } = event.properties as { sessionID?: string }
        if (!sessionID) return

        const result = findSessionTab(claxedo.split.groups(), directory, sessionID)
        if (!result) return

        const { tab, groupId } = result
        const isActive =
          claxedo.split.focusedId() === groupId &&
          claxedo.split.groups().find((g) => g.id === groupId)?.tabs.activeId === tab.id

        if (!isActive) {
          claxedo.patchTab(tab.id, { loading: false, done: true })
          playSound(soundSrc(settings.sounds.errors()))
        } else {
          claxedo.patchTab(tab.id, { loading: false })
        }
      }
    })

    onCleanup(unsub)
  })
}

/** Find a session tab by directory + sessionId across all groups */
function findSessionTab(
  groups: { id: string; tabs: { items: TabItem[]; activeId: string | null } }[],
  directory: string,
  sessionId: string,
): { tab: TabItem; groupId: string } | undefined {
  for (const group of groups) {
    const tab = group.tabs.items.find(
      (t) => t.type === "session" && t.directory === directory && t.sessionId === sessionId,
    )
    if (tab) return { tab, groupId: group.id }
  }
  return undefined
}

/**
 * Hook that clears attention and done indicators when user focuses a tab
 *
 * This provides a natural UX:
 * - The attention dot disappears when the user switches to the tab
 * - The done dot disappears when the user switches to the tab (they've seen the results)
 */
export function useClearAttentionOnFocus() {
  const claxedo = useClaxedoLayout()

  createEffect(() => {
    const activeId = claxedo.topTabs.activeId()
    if (!activeId) return

    const tab = claxedo.topTabs.items().find((t) => t.id === activeId)
    if (!tab) return

    // Get all terminal IDs in this tab
    const ids = claxedo.terminal.ids(activeId)
    const nextIds = tab.terminalId ? [...ids, tab.terminalId] : ids
    const unique = Array.from(new Set(nextIds))

    // Only clear the seen flag if the agent has completed (done is true).
    // If the agent is still running (loading=true), we need to keep the seen flag
    // so that when Stop arrives, we know the agent actually ran (preventing spurious done).
    if (tab.done) {
      for (const id of unique) {
        claxedo.terminal.clearSeen(id)
      }

      // Update the tab's done status immediately to hide the green dot.
      // For session tabs (no terminals), getTabAgentStatus returns done:false which clears it.
      const aggregated = claxedo.terminal.getTabAgentStatus(activeId)
      claxedo.topTabs.patch(activeId, { done: aggregated.done })
    }

    if (tab?.attention) {
      // Clear attention when tab is focused
      claxedo.topTabs.patch(activeId, { attention: false })

      // Heuristic: when a terminal tab is focused while it was in "permission" state,
      // assume the user is about to respond and restore the "working" indicator.
      // Claude Code permission hooks don't emit a "resume" event, so without this
      // the tab can remain stuck in attention/no-spinner until Stop.
      if (tab.type !== "terminal") return

      const hadPermission = unique.some((id) => claxedo.terminal.agentStatus(id) === "permission")
      if (!hadPermission) return

      for (const id of unique) {
        if (claxedo.terminal.agentStatus(id) !== "permission") continue
        claxedo.terminal.setAgentStatus(id, "working")
      }

      const aggregated = claxedo.terminal.getTabAgentStatus(activeId)
      claxedo.topTabs.patch(activeId, { loading: aggregated.loading, done: aggregated.done })
    }
  })
}

/**
 * Combined hook for agent lifecycle handling
 * Use this in a top-level component
 */
export function useAgentHooks() {
  useAgentLifecycleListener()
  useSessionStatusListener()
  useClearAttentionOnFocus()
}
