import { createSimpleContext } from "@opencode-ai/ui/context"
import { type Accessor, createMemo } from "solid-js"
import { type LocationContext, useServerSDK } from "./server-sdk"
export type { LocationContext } from "./server-sdk"

const context = createSimpleContext({
  name: "Location",
  init: (props: { directory: string | Accessor<string> }) => {
    const serverSDK = useServerSDK()
    return createMemo(() =>
      serverSDK.ensureDirSdkContext(typeof props.directory === "function" ? props.directory() : props.directory),
    )
  },
})

export const useWorkspaceLocation: () => Accessor<LocationContext> = context.use
export const LocationProvider = context.provider
