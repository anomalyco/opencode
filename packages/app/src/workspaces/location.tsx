import { createSimpleContext } from "@opencode-ai/ui/context"
import type { LocationGetOutput, LocationRef } from "@opencode-ai/client/promise"
import { type Accessor, createEffect, createMemo, createSignal } from "solid-js"
import { type LocationContext, useServerSDK } from "@/runtime/server/client"
import { useData } from "@/runtime/server/current"
export type { LocationContext } from "@/runtime/server/client"

export type WorkspaceLocation = LocationContext & {
  readonly ref: LocationRef
  readonly current: LocationGetOutput | undefined
  readonly error: { readonly location: LocationRef; readonly cause: unknown } | undefined
}

const context = createSimpleContext({
  name: "Location",
  init: (props: { directory: string | Accessor<string>; workspaceID?: string | Accessor<string | undefined> }) => {
    const serverSDK = useServerSDK()
    const data = useData()
    const ref = createMemo(() => ({
      directory: typeof props.directory === "function" ? props.directory() : props.directory,
      workspaceID: typeof props.workspaceID === "function" ? props.workspaceID() : props.workspaceID,
    }))
    const current = createMemo(() => data.location.info(ref()))
    const [error, setError] = createSignal<{ readonly location: LocationRef; readonly cause: unknown }>()
    let generation = 0

    createEffect(() => {
      const location = ref()
      if (serverSDK.connection.status() !== "connected") return
      const attempt = ++generation
      setError(undefined)
      void data.location.sync(location).catch((cause) => {
        const latest = ref()
        if (
          generation !== attempt ||
          latest.directory !== location.directory ||
          latest.workspaceID !== location.workspaceID
        )
          return
        setError({ location, cause })
      })
    })

    const location = createMemo(() => serverSDK.ensureDirSdkContext(current()?.directory ?? ref().directory))
    return createMemo<WorkspaceLocation>(() => ({
      ...location(),
      ref: ref(),
      current: current(),
      error: error(),
    }))
  },
})

export const useWorkspaceLocation: () => Accessor<WorkspaceLocation> = context.use
export const LocationProvider = context.provider
