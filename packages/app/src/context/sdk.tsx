import { createSimpleContext } from "@opencode-ai/ui/context"
import { type Accessor, createMemo } from "solid-js"
import { type ServerSDK, useServerSDK } from "./server-sdk"

export type DirectorySDK = ReturnType<ServerSDK["ensureDirSdkContext"]>

export const { use: useSDK, provider: SDKProvider } = createSimpleContext({
  name: "SDK",
  // Resolves the directory-scoped SDK reactively from the (possibly changing) server.
  init: (props: { directory: string | Accessor<string> }) => {
    const serverSDK = useServerSDK()
    return createMemo(() => {
      const directory = typeof props.directory === "function" ? props.directory() : props.directory
      return serverSDK().ensureDirSdkContext(directory)
    })
  },
})
