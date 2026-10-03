import { createSimpleContext } from "@opencode/ui/context"
import type { LocationGetOutput, LocationRef } from "@opencode/client/promise"
import { retry } from "@opencode/util/retry"
import { type Accessor, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { type LocationContext, useServerSDK } from "@/runtime/server/client"
import { useData, useServer } from "@/runtime/server/current"
import { projectLocationError } from "@/runtime/server/errors"
export type { LocationContext } from "@/runtime/server/client"

export type WorkspaceLocation = LocationContext & {
  readonly ref: LocationRef
  readonly current: LocationGetOutput | undefined
  readonly error: ReturnType<typeof projectLocationError>
  readonly retry: () => Promise<void>
}

const context = createSimpleContext({
  name: "Location",
  init: (props: { directory: string | Accessor<string>; workspaceID?: string | Accessor<string | undefined> }) => {
    const serverSDK = useServerSDK()
    const server = useServer()
    const data = useData()
    const ref = createMemo(
      () => ({
        directory: typeof props.directory === "function" ? props.directory() : props.directory,
        workspaceID: typeof props.workspaceID === "function" ? props.workspaceID() : props.workspaceID,
      }),
      undefined,
      {
        equals: (previous, next) => previous.directory === next.directory && previous.workspaceID === next.workspaceID,
      },
    )
    const current = createMemo(() => data.location.info(ref()))
    const [failure, setFailure] = createSignal<{
      ref: LocationRef
      error: NonNullable<ReturnType<typeof projectLocationError>>
    }>()
    const error = createMemo(() => {
      const failed = failure()
      const location = ref()
      if (failed?.ref.directory !== location.directory || failed.ref.workspaceID !== location.workspaceID) return
      return failed.error
    })
    const sync = (location: LocationRef) =>
      data.location.sync(location).then(
        () => setFailure(undefined),
        (cause: unknown) => {
          const unavailable = projectLocationError(cause)
          if (unavailable) setFailure({ ref: location, error: unavailable })
        },
      )

    createEffect(() => {
      const location = ref()
      let stale = false
      onCleanup(() => {
        stale = true
      })
      if (serverSDK.connection.status() !== "connected") return
      // Only a typed directory failure proves this Location is unavailable. Transient failures
      // keep their existing retries; a successful retry or a session move clears the state.
      void retry(() => (stale ? Promise.resolve() : data.location.sync(location)), {
        retryIf: (cause) => !stale && !projectLocationError(cause),
      }).then(
        () => {
          if (!stale) setFailure(undefined)
        },
        (cause: unknown) => {
          const unavailable = projectLocationError(cause)
          if (!stale && unavailable) setFailure({ ref: location, error: unavailable })
        },
      )
    })
    createEffect(() => {
      const id = current()?.project.id
      if (!id || error() || serverSDK.connection.status() !== "connected") return
      // Showing a Location is the demand for its project's worktree inventory (workspace styling, picker).
      void server.ctx.sync.worktrees.list(id).then(() => server.ctx.sync.worktrees.refresh(id))
    })

    const location = createMemo(() => serverSDK.ensureDirSdkContext(current()?.directory ?? ref().directory))
    return createMemo<WorkspaceLocation>(() => ({
      ...location(),
      ref: ref(),
      current: current(),
      error: error(),
      retry: () => sync(ref()),
    }))
  },
})

export const useWorkspaceLocation: () => Accessor<WorkspaceLocation> = context.use
export const LocationProvider = context.provider
