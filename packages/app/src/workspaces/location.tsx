import { createSimpleContext } from "@opencode-ai/ui/context"
import type { LocationGetOutput, LocationRef } from "@opencode-ai/client/promise"
import { retry } from "@opencode-ai/util/retry"
import { type Accessor, createEffect, createMemo, onCleanup } from "solid-js"
import { type LocationContext, useServerSDK } from "@/runtime/server/client"
import { useData } from "@/runtime/server/current"
export type { LocationContext } from "@/runtime/server/client"

export type WorkspaceLocation = LocationContext & {
  readonly ref: LocationRef
  readonly current: LocationGetOutput | undefined
}

const context = createSimpleContext({
  name: "Location",
  init: (props: { directory: string | Accessor<string>; workspaceID?: string | Accessor<string | undefined> }) => {
    const serverSDK = useServerSDK()
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

    createEffect(() => {
      const location = ref()
      let stale = false
      onCleanup(() => {
        stale = true
      })
      if (serverSDK.connection.status() !== "connected") return
      // A failed sync does not prove the directory is missing. Keep recovery local to reads.
      void retry(() => (stale ? Promise.resolve() : data.location.sync(location)), {
        retryIf: () => !stale,
      }).catch(() => undefined)
    })

    const location = createMemo(() => serverSDK.ensureDirSdkContext(current()?.directory ?? ref().directory))
    return createMemo<WorkspaceLocation>(() => ({
      ...location(),
      ref: ref(),
      current: current(),
    }))
  },
})

export const useWorkspaceLocation: () => Accessor<WorkspaceLocation> = context.use
export const LocationProvider = context.provider
