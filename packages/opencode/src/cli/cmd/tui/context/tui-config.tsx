import { TuiConfig } from "@test/cli/tui/config/tui"
import { createSimpleContext } from "./helper"

export const { use: useTuiConfig, provider: TuiConfigProvider } = createSimpleContext({
  name: "TuiConfig",
  init: (props: { config: TuiConfig.Info }) => {
    return props.config
  },
})
