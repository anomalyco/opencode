import { createSimpleContext } from "./helper"
import { useKV } from "./kv"
import { createTabState } from "./tab-state"

export type { Tab, TabContext } from "./tab-state"
export { createTabState } from "./tab-state"

export const { use: useTabs, provider: TabProvider } = createSimpleContext({
  name: "Tabs",
  init: () => {
    const kv = useKV()
    return createTabState(kv)
  },
})
