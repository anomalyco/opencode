import { createSimpleContext } from "@simpliciocode/ui/context"
import { useServerSDK } from "./server-sdk"

export const { use: useSDK, provider: SDKProvider } = createSimpleContext({
  name: "SDK",
  init: (props: { directory: string }) => {
    const serverSDK = useServerSDK()

    return serverSDK.createDirSdkContext(props.directory)
  },
})
