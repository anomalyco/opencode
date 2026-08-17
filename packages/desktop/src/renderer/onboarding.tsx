import { ServerConnection, useServers, useTabs } from "@opencode-ai/app"
import { onMount } from "solid-js"

export function DesktopFirstLaunchOnboarding(props: { serverKey: ServerConnection.Key; initialUrl: string }) {
  const server = useServers()
  const tabs = useTabs()

  onMount(() => {
    void runFirstLaunchOnboarding()
  })

  async function runFirstLaunchOnboarding() {
    try {
      await Promise.all([tabs.ready.promise, tabs.recentReady.promise].map((p) => p ?? Promise.resolve()))
      const pending = await window.api.isFirstLaunchOnboardingPending()
      if (!pending) return

      const shouldTrigger =
        props.initialUrl === "/" && tabs.store.length === 0 && server.list.every(ServerConnection.builtin)

      console.info("[desktop-onboarding] first launch onboarding evaluated", {
        pending,
        shouldTrigger,
        initialUrl: props.initialUrl,
        tabs: tabs.store.length,
        servers: server.list.map(ServerConnection.key),
      })

      const directory = await window.api.finishFirstLaunchOnboarding(shouldTrigger)
      if (!shouldTrigger || !directory) return

      console.info("[desktop-onboarding] starting first launch draft", { directory })
      const projects = server.projects.forServer(props.serverKey)
      projects.open(directory)
      projects.touch(directory)
      tabs.select(await tabs.newDraft({ server: props.serverKey, directory }))
    } catch (error) {
      console.error("[desktop-onboarding] first launch onboarding failed", error)
    }
  }

  return null
}
