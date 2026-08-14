import { createSimpleContext } from "@opencode-ai/ui/context"
import { type Accessor, createMemo } from "solid-js"
import { type DirectorySDK, useServerSDK } from "./server-sdk"
export type { DirectorySDK } from "./server-sdk"

const context = createSimpleContext({
  name: "SDK",
  // Resolves the directory-scoped SDK reactively from the (possibly changing) server.
  init: (props: { directory: string | Accessor<string> }) => {
    const serverSDK = useServerSDK()
    return createMemo(() => {
      const directory = typeof props.directory === "function" ? props.directory() : props.directory
      return serverSDK.ensureDirSdkContext(directory)
    })
  },
})

export const useSDK: () => Accessor<DirectorySDK> = context.use
export const SDKProvider = context.provider
