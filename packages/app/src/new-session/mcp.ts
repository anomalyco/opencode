import { createMemo } from "solid-js"
import { type McpControls, useMcpController, useMcpPool } from "@/providers/connect/mcp"
import { isMcpToggling, type McpServerStatus } from "@/providers/connect/mcp-machine"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { useServer } from "@/runtime/server/current"
import { useTabs } from "@/shell/tabs/tabs"
import { showToast } from "@/shell/notifications/toast"
import { useWorkspaceLocation } from "@/workspaces/location"

export function createDraftMcpControls(input: { draftID: string; worktree: () => string; preparing: () => boolean }) {
  const tabs = useTabs()
  const location = useWorkspaceLocation()
  const server = useServer()
  const sdk = useServerSDK()
  const language = useLanguage()

  const key = (worktree: string) => JSON.stringify([server.key, location().directory, worktree])
  const target = createMemo(() => key(input.worktree()))
  const preview = () => input.worktree() === "create"

  const directory = createMemo(() => {
    const selected = input.worktree()

    return selected === "main" || selected === "create" ? location().directory : selected
  })

  const states = createMemo(() => {
    const draft = tabs.store.find((tab) => tab.type === "draft" && tab.draftID === input.draftID)

    return draft?.type === "draft" && draft.mcp?.target === target() ? draft.mcp.states : {}
  })

  // The selected directory's controller, shared with the MCPs dialog and Settings, so their toggles show here too.
  const mcp = useMcpController(directory)
  const pool = useMcpPool()

  // Toggles a directory's server and resolves whether it succeeded, holding that directory's controller meanwhile.
  const toggle = (current: string, name: string, enabled: boolean, status: McpServerStatus["status"] | undefined) => {
    const controller = pool.acquire(current)

    return controller.toggle(name, enabled, status).finally(() => controller.dispatch({ type: "unmounted" }))
  }

  const controls: McpControls = {
    get preview() {
      return preview()
    },
    get states() {
      return states()
    },
    get pending() {
      return input.preparing() || (!preview() && isMcpToggling(mcp.state()))
    },
    change(name, enabled) {
      if (controls.pending) return
      tabs.updateDraft(input.draftID, { mcp: { target: target(), states: { ...states(), [name]: enabled } } })

      if (preview()) return
      void toggle(directory(), name, enabled, undefined)
    },
  }

  const apply = async (directory: string, states: Readonly<Record<string, boolean>>) => {
    const settled = pool.peek(directory)?.settle()

    if (settled && !(await settled)) return false
    const entries = Object.entries(states)

    if (entries.length === 0) return true
    const catalog = await sdk.api.mcp.list({ location: { directory } })
    const missing = entries.find(([name, enabled]) => enabled && !catalog.data.some((server) => server.name === name))

    if (missing) throw new Error(language.t("session.summary.mcp.unavailable", { name: missing[0] }))

    const results = await Promise.all(
      entries.flatMap(([name, enabled]) => {
        const status = catalog.data.find((server) => server.name === name)?.status.status

        if (!status || (enabled ? status === "connected" : status === "disabled")) return []

        return [toggle(directory, name, enabled, status)]
      }),
    )

    if (results.some((success) => !success)) return false
    const current = await sdk.api.mcp.list({ location: { directory } })

    const unresolved = entries.find(([name, enabled]) => {
      const status = current.data.find((server) => server.name === name)?.status.status

      return enabled ? status !== "connected" : status !== undefined && status !== "disabled"
    })

    if (!unresolved) return true
    const status = current.data.find((server) => server.name === unresolved[0])?.status.status
    throw new Error(
      language.t(status === "needs_auth" ? "session.summary.mcp.signInBeforeSend" : "session.summary.mcp.notReady", {
        name: unresolved[0],
      }),
    )
  }

  return {
    controls,
    directory,
    capture: () => ({ ...states() }),
    toggling: (directory: string) => {
      const controller = pool.peek(directory)

      return !!controller && isMcpToggling(controller.state())
    },
    remember(directory: string, states: Readonly<Record<string, boolean>>) {
      tabs.updateDraft(input.draftID, { mcp: { target: key(directory), states: { ...states } } })
    },
    prepare(directory: string, states: Readonly<Record<string, boolean>>) {
      return apply(directory, states).catch((error) => {
        showToast({
          variant: "error",
          title: language.t("session.summary.mcp.prepareFailed"),
          description: error instanceof Error ? error.message : String(error),
        })

        return false
      })
    },
  }
}

export type DraftMcpControls = ReturnType<typeof createDraftMcpControls>
