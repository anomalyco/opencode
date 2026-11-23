import { createSimpleContext } from "@opencode/ui/context"
import { isLocationNotFoundError, type LocationGetOutput, type LocationRef } from "@opencode/client/promise"
import { type Accessor, createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js"
import { type LocationContext, useServerSDK } from "@/runtime/server/client"
import { useData, useServer } from "@/runtime/server/current"
import {
  createLocationSyncState,
  missingLocation,
  sameLocationRef,
  transitionLocationSync,
  type LocationSyncEffect,
  type LocationSyncEvent,
} from "./location-machine"

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
        workspaceID: props.workspaceID,
      }),
      undefined,
      { equals: sameLocationRef },
    )

    const current = createMemo(() => data.location.info(ref()))
    const connected = createMemo(() => serverSDK.connection.status() === "connected")
    const [syncState, setSyncState] = createSignal(createLocationSyncState(untrack(ref)))
    // The retry delay or the running attempt's timeout; the machine decides when each ends.
    let timer: ReturnType<typeof setTimeout> | undefined

    function dispatch(event: LocationSyncEvent) {
      const next = transitionLocationSync(untrack(syncState), event)
      setSyncState(next.state)
      next.effects.forEach(perform)
    }

    function perform(effect: LocationSyncEffect) {
      clearTimeout(timer)

      if (effect.type === "timer.clear") return

      if (effect.type === "retry") {
        timer = setTimeout(() => dispatch({ type: "retry.due", attempt: effect.attempt }), effect.delay)

        return
      }

      timer = setTimeout(() => dispatch({ type: "sync.timed-out", attempt: effect.attempt }), effect.timeout)
      // syncInfo caches its answer, so sync reuses it instead of reading the Location again.
      void data.location
        .syncInfo(effect.location)
        .then(() => {
          dispatch({ type: "info.resolved", attempt: effect.attempt })

          return data.location.sync(effect.location)
        })
        .then(
          () => dispatch({ type: "sync.succeeded", attempt: effect.attempt }),
          (error) =>
            dispatch({
              type: isLocationNotFoundError(error) ? "sync.missing" : "sync.failed",
              attempt: effect.attempt,
            }),
        )
    }

    createEffect(() => {
      const event = { type: "target.updated", location: ref(), connected: connected() } as const
      untrack(() => dispatch(event))
    })
    onCleanup(() => dispatch({ type: "disposed" }))
    const missing = createMemo(() => missingLocation(syncState(), ref()))

    createEffect(() => {
      const id = current()?.project.id

      if (!id || !connected()) return
      // Showing a Location is the demand for its project's worktree inventory (workspace styling, picker).
      void server.ctx.sync.worktrees.list(id).then(() => server.ctx.sync.worktrees.refresh(id))
    })

    const location = createMemo(() => serverSDK.ensureDirSdkContext(current()?.directory ?? ref().directory))

    return createMemo<WorkspaceLocation>(() => ({
      ...location(),
      ref: ref(),
      current: current(),
      missing: missing(),
    }))
  },
})

export const useWorkspaceLocation: () => Accessor<WorkspaceLocation> = context.use

export const LocationProvider = context.provider

/** Provides a resolved Location without syncing it, e.g. the one a detached view keeps while another is selected. */
export const WorkspaceLocationContext = context.context
