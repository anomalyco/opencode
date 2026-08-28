import { Plugin } from "@opencode-ai/plugin/tui"
import { useConfig } from "../../src/config"
import { useLocation } from "../../src/context/location"
import { useRoute } from "../../src/context/route"
import { usePlugin } from "../../src/plugin/context"

export const probe = {
  setups: 0,
  cleanups: 0,
  plugins: (): ReturnType<typeof usePlugin> => {
    throw new Error("Plugin probe not mounted")
  },
  config: (): ReturnType<typeof useConfig> => {
    throw new Error("Plugin probe not mounted")
  },
  location: (): ReturnType<typeof useLocation> => {
    throw new Error("Plugin probe not mounted")
  },
  navigate: (_directory: string): void => {
    throw new Error("Plugin probe not mounted")
  },
}

export default Plugin.define({
  id: "fixture.inspection",
  setup(context) {
    if (context.options.fail) throw new Error("Fixture setup failed")
    probe.setups++
    context.ui.slot({
      append: "app",
      render: () => {
        const plugins = usePlugin()
        const config = useConfig()
        const location = useLocation()
        const route = useRoute()
        probe.plugins = () => plugins
        probe.config = () => config
        probe.location = () => location
        probe.navigate = (directory) => route.navigate({ type: "home", location: { directory } })
        return null
      },
    })
    return () => {
      probe.cleanups++
    }
  },
})
