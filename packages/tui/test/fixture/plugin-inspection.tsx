import { Plugin } from "@opencode-ai/plugin/tui"
import { onCleanup } from "solid-js"
import { useConfig } from "../../src/config"
import { useLocation } from "../../src/context/location"
import { useRoute } from "../../src/context/route"
import { usePlugin } from "../../src/plugin/context"

export const probe = {
  setups: 0,
  cleanups: 0,
  updateSetups: [] as string[],
  updateCleanups: [] as string[],
  updateEvents: [] as string[],
  updateSetup: Promise.resolve(),
  failUpdate: false,
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

export function updatePlugin(version: string) {
  return Plugin.define({
    id: "fixture.update",
    async setup(context) {
      probe.updateSetups.push(version)
      context.ui.slot({
        append: "home.footer",
        render: () => {
          onCleanup(
            context.data.listen((event) => {
              if (event.details.id === "evt_apply_probe") probe.updateEvents.push(version)
            }),
          )
          return <text>Update code {version}</text>
        },
      })
      if (version === "B" && probe.failUpdate) throw new Error("Candidate setup failed")
      if (version === "B") await probe.updateSetup
      return () => {
        probe.updateCleanups.push(version)
      }
    },
  })
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
