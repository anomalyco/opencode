import type { GridContext } from "../../context/grid"
import { useSDK } from "../../context/sdk"
import { useProject } from "../../context/project"
import { useSync } from "../../context/sync"
import { useWorkspaceClients, asWorkspaceID } from "../../context/workspace-clients"
import type { ToastContext } from "../../ui/toast"
import type { RouteContext } from "../../context/route"

/**
 * Create a fresh session via the workspace-aware SDK and add it to the grid
 * as the new active cell. Used by both the `grid_create` keybind and the
 * toolbar "+" button. Replaces the old "navigate to home" behaviour so the
 * action actually opens a new grid cell instead of teleporting the user
 * out of the grid.
 *
 * When `route` is provided the route data is synced after adding the cell
 * so that `dialog-session-list` sees all current grid cells and can
 * preserve them when navigating within grid mode.
 *
 * Returns the new session id on success, or `undefined` when the server
 * call fails — callers can surface a toast on the latter.
 */
export async function createGridSession(input: {
  grid: GridContext
  sdk: ReturnType<typeof useSDK>
  project: ReturnType<typeof useProject>
  sync: ReturnType<typeof useSync>
  workspaceClients: ReturnType<typeof useWorkspaceClients>
  toast: ToastContext
  route?: RouteContext
  sessionID?: string
}): Promise<string | undefined> {
  const workspaceID = input.project.workspace.current()
  let sessionID = input.sessionID
  if (!sessionID) {
    const client = workspaceID ? input.workspaceClients.clientFor(asWorkspaceID(workspaceID)) : input.sdk.client
    const result = await client.session.create({ workspace: workspaceID }).catch(() => undefined)
    if (!result?.data) {
      input.toast.show({
        message: "Failed to create session",
        variant: "error",
      })
      return undefined
    }
    sessionID = result.data.id
  }
  input.grid.addCell({
    sessionID,
    workspaceID: workspaceID ?? "",
    mode: "full",
    label: input.sessionID ? "" : "New Session",
  })
  void input.sync.session.sync(sessionID).catch(() => undefined)
  return sessionID
}
