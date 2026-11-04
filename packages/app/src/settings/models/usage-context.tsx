import { createSimpleContext } from "@opencode/ui/context"
import { createSignal } from "solid-js"
import { useServerSDK } from "@/runtime/server/client"
import { usageByModel } from "./usage"

type Usage = ReturnType<typeof usageByModel>

/**
 * Lifetime token usage per model. The stats query scans the whole history, so it runs once per server scope when
 * Settings opens instead of on every visit to the Models tab.
 */
export const { use: useModelUsage, provider: ModelUsageProvider } = createSimpleContext({
  name: "ModelUsage",
  init: () => {
    const sdk = useServerSDK()
    const [usage, setUsage] = createSignal<Usage>()

    void sdk.api.experimental.session
      .stats({
        tools: "none",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      })
      .then((stats) => setUsage(usageByModel(stats)))
      .catch(() => undefined)

    return usage
  },
})
