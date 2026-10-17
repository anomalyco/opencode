import { WorkspaceID } from "@opencode/schema/workspace-id"
import { createSimpleContext } from "@opencode/ui/context"
import { isLocationNotFoundError, type LocationGetOutput, type LocationRef } from "@opencode/client/promise"
import { retry } from "@opencode/util/retry"
import { type Accessor, createEffect, createMemo, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { type LocationContext, useServerSDK } from "@/runtime/server/client"
import { useData, useServer } from "@/runtime/server/current"

export type { LocationContext } from "@/runtime/server/client"

export type WorkspaceLocation = LocationContext & {
  readonly ref: LocationRef
  readonly current: LocationGetOutput | undefined
  /** Set only when the server reports that this exact Location's folder does not exist. */
  readonly missing: LocationRef | undefined
}

const context = createSimpleContext({
  name: "Location",
  init: (props: { directory: string; workspaceID?: string }) => {
    const serverSDK = useServerSDK()
    const server = useServer()
    const data = useData()

    const ref = createMemo(
      () => ({
        directory: props.directory,
        workspaceID:
          props.workspaceID === undefined ? undefined : WorkspaceID.make(props.workspaceID, { disableChecks: true }),
      }),
      undefined,
      {
        equals: (previous, next) => previous.directory === next.directory && previous.workspaceID === next.workspaceID,
      },
    )

    const current = createMemo(() => data.location.info(ref()))
    const [state, setState] = createStore<{ missing?: LocationRef }>({})

    createEffect(() => {
      const location = ref()
      let stale = false
      onCleanup(() => {
        stale = true
      })
      setState("missing", undefined)

      if (serverSDK.connection.status() !== "connected") return
      // Generic sync failures do not prove the directory is missing; only the server's typed
      // LocationNotFoundError does, and retrying it cannot succeed until the folder changes.
      void retry(() => (stale ? Promise.resolve() : data.location.sync(location)), {
        retryIf: (error) => !stale && !isLocationNotFoundError(error),
      }).catch((error) => {
        if (stale || !isLocationNotFoundError(error)) return
        setState("missing", location)
      })
    })
    createEffect(() => {
      const id = current()?.project.id

      if (!id || serverSDK.connection.status() !== "connected") return
      // Showing a Location is the demand for its project's worktree inventory (workspace styling, picker).
      void server.ctx.sync.worktrees.list(id).then(() => server.ctx.sync.worktrees.refresh(id))
    })

    const location = createMemo(() => serverSDK.ensureDirSdkContext(current()?.directory ?? ref().directory))

    return createMemo<WorkspaceLocation>(() => ({
      ...location(),
      ref: ref(),
      current: current(),
      missing: state.missing,
    }))
  },
})

export const useWorkspaceLocation: () => Accessor<WorkspaceLocation> = context.use

export const LocationProvider = context.provider
