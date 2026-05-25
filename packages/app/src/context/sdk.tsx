import { createSimpleContext } from "@opencode-ai/ui/context"
import { useServerSDK } from "./server-sdk"

export const { use: useSDK, provider: SDKProvider } = createSimpleContext({
  name: "SDK",
  init: (props: { directory: string }) => {
    const serverSDK = useServerSDK()

    return serverSDK.createDirSyncContext(props.directory)
  },
})
