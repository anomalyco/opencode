import { createProviderPlugin } from "./factory"

export const AlibabaPlugin = createProviderPlugin({
  id: "opencode.provider.alibaba",
  package: "@ai-sdk/alibaba",
  load: async () => {
    const { createAlibaba } = await import("@ai-sdk/alibaba")
    return (options) => createAlibaba(options)
  },
})
