import { createMemo } from "solid-js"
import type { Draft } from "@opencode/gui-extensions/sdk"
import { displayName } from "@opencode/ui/project-avatar"
import type { DraftMcpControls } from "@/new-session/mcp"
import type { NewSessionWorkspaceController } from "@/new-session/workspace/controller"
import { useServer } from "@/runtime/server/current"
import { useWorkspaceLocation } from "@/workspaces/location"
import { pathKey } from "@/workspaces/path-key"
import { createRouteServerRef } from "./server-ref"

/** The new-session screen's draft as extensions see it. Its fields follow the draft's selection. */
export function createExtensionDraft(input: { workspace: NewSessionWorkspaceController; mcp: DraftMcpControls }) {
  const server = useServer()
  const location = useWorkspaceLocation()
  const controls = input.mcp.controls

  // Global sync adds the worktrees found on disk, and the user's local name and icon override the server's.
  const project = createMemo(() => {
    const id = location().current?.project.id

    if (!id) return
    const raw = server.ctx.data.project.get(id)

    const metadata =
      server.ctx.sync.data.project.find((item) => item.id === id) ??
      (raw && { ...raw, worktree: raw.canonical, worktrees: [] })

    if (!metadata) return
    const key = pathKey(location().directory)
    const listed = server.ctx.projects.list().find((item) => pathKey(item.worktree) === key)

    return listed ? { ...metadata, name: displayName(listed), icon: listed.icon } : metadata
  })

  const draft: Draft = Object.freeze({
    server: createRouteServerRef(),
    get project() {
      return project()
    },
    get directory() {
      return input.mcp.directory()
    },
    get workspace() {
      const value = input.workspace.selection.value()

      if (value === "main") return "local"

      if (value === "create") return "create"

      return "worktree"
    },
    get branch() {
      return input.workspace.bar.branch()
    },
    mcp: Object.freeze({
      get deferred() {
        return controls.preview
      },
      get pending() {
        return controls.pending
      },
      choice: (name: string) => (Object.hasOwn(controls.states, name) ? controls.states[name] : undefined),
      set: (name: string, enabled: boolean) => controls.change(name, enabled),
    }),
  })

  return draft
}
