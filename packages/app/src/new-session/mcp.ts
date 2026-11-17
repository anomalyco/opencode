import { createMemo } from "solid-js"
import { type McpControls, useMcpController, useMcpPool } from "@/providers/connect/mcp"
import { isMcpToggling } from "@/providers/connect/mcp-machine"
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

  // Sets a directory's server to an explicit state and resolves whether it succeeded, holding that directory's
  // controller meanwhile. Like an explicit toggle on dev, it runs on a server that is still connecting, so it passes no
  // status for the machine's pending guard.
  const toggle = (current: string, name: string, enabled: boolean) => {
    const controller = pool.acquire(current)

    return controller.toggle(name, enabled, undefined).finally(() => controller.dispatch({ type: "unmounted" }))
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
      void toggle(directory(), name, enabled).catch((error) =>
        showToast({
          variant: "error",
          title: language.t("common.requestFailed"),
          description: error instanceof Error ? error.message : String(error),
        }),
      )
    },
  }

  // Resolves whether the directory's servers match `states`, and rejects with the reason when one cannot. Once `signal`
  // aborts it starts no further toggles; toggles already running belong to the shared controller and finish there.
  const prepare = async (directory: string, states: Readonly<Record<string, boolean>>, signal: AbortSignal) => {
    const settled = pool.peek(directory)?.settle()

    if (settled && !(await settled)) return false
    const entries = Object.entries(states)

    if (entries.length === 0) return true
    const catalog = await sdk.api.mcp.list({ location: { directory } }, { signal })
    const missing = entries.find(([name, enabled]) => enabled && !catalog.data.some((server) => server.name === name))

    if (missing) throw new Error(language.t("session.summary.mcp.unavailable", { name: missing[0] }))

    if (signal.aborted) return false

    const results = await Promise.all(
      entries.flatMap(([name, enabled]) => {
        const status = catalog.data.find((server) => server.name === name)?.status.status

        if (!status || (enabled ? status === "connected" : status === "disabled")) return []

        return [toggle(directory, name, enabled)]
      }),
    )

    if (results.some((success) => !success)) return false
    const current = await sdk.api.mcp.list({ location: { directory } }, { signal })

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
    prepare,
  }
}

export type DraftMcpControls = ReturnType<typeof createDraftMcpControls>
