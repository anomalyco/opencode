import { ServerConnection, useCurrentRoute, useGlobal, useServers, useTabs } from "@opencode/app/desktop"
import { onMount } from "solid-js"
import type { ElectronAPI } from "../api-types"
import type { StartupEvent } from "../startup/machine"

export function DesktopFirstLaunchOnboarding(props: {
  api: ElectronAPI
  initialUrl: string
  pending: boolean
  dispatch: (event: StartupEvent) => void
}) {
  const server = useServers()
  const global = useGlobal()
  const tabs = useTabs()
  const route = useCurrentRoute()

  // Startup reports the result: a failure reaches the app's recovery screen.
  onMount(() => {
    if (!props.pending) return
    void runFirstLaunchOnboarding().then(
      () => props.dispatch({ type: "onboarding.settled" }),
      (error) => props.dispatch({ type: "startup.failed", error }),
    )
  })

  async function runFirstLaunchOnboarding() {
    await Promise.all([tabs.ready.promise, tabs.recentReady.promise].map((p) => p ?? Promise.resolve()))

    const shouldTrigger =
      props.initialUrl === "/" &&
      route().type === "home" &&
      tabs.store.length === 0 &&
      server.list.every(ServerConnection.builtin)

    console.info("[desktop-onboarding] first launch onboarding evaluated", {
      pending: props.pending,
      shouldTrigger,
      initialUrl: props.initialUrl,
      tabs: tabs.store.length,
      servers: server.list.map(ServerConnection.key),
    })

    const directory = await props.api.finishFirstLaunchOnboarding(shouldTrigger)

    if (!shouldTrigger || !directory) return

    console.info("[desktop-onboarding] starting first launch draft", { directory })
    const sidecar = ServerConnection.Key.make("sidecar")
    const ctx = global.serverCtx(sidecar)

    if (ctx) {
      // Load the initial provider/model state before the draft transition exposes the composer.
      await Promise.all([
        ctx.projects.add(directory),
        ctx.data.location.provider.sync({ directory }),
        ctx.data.location.model.sync({ directory }),
      ])
    }

    tabs.select(await tabs.newDraft({ server: sidecar, directory }))
  }

  return null
}
