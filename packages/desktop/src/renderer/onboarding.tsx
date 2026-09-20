import { DialogConnectProvider, ServerConnection, useProviders, useServer, useSettings, useTabs } from "@opencode-ai/app"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { createEffect, onMount } from "solid-js"

export function DesktopFirstLaunchOnboarding(props: { initialUrl: string; onLoaded: () => void }) {
  const server = useServer()
  const settings = useSettings()
  const tabs = useTabs()
  const dialog = useDialog()
  const providers = useProviders(() => undefined)

  onMount(() => {
    void runFirstLaunchOnboarding().finally(props.onLoaded)
  })

  // VeniceCode cannot do anything without a Venice API key, so ask for one as soon
  // as we know none is stored. A non-empty catalog means the provider list has
  // actually loaded — without that check an empty `connected` is just a cold start.
  let askedForKey = false
  createEffect(() => {
    if (askedForKey) return
    if (providers.all().size === 0) return
    if (providers.connected().length > 0) return
    askedForKey = true
    console.info("[desktop-onboarding] no provider connected, prompting for API key")
    void dialog.show(() => <DialogConnectProvider />)
  })

  async function runFirstLaunchOnboarding() {
    try {
      await Promise.all(
        [server.ready.promise, tabs.ready.promise, tabs.recentReady.promise].map((p) => p ?? Promise.resolve()),
      )
      const existingInstall = await window.api.isOldLayoutEligible()
      settings.general.setOldLayoutEligible(existingInstall)
      settings.general.initializeAgentVisibility(existingInstall)
      if (!server.isLocal()) return

      const pending = await window.api.isFirstLaunchOnboardingPending()
      if (!pending) return

      const shouldTrigger =
        !existingInstall &&
        props.initialUrl === "/" &&
        tabs.store.length === 0 &&
        server.list.every(ServerConnection.builtin)

      console.info("[desktop-onboarding] first launch onboarding evaluated", {
        pending,
        shouldTrigger,
        existingInstall,
        initialUrl: props.initialUrl,
        tabs: tabs.store.length,
        servers: server.list.map(ServerConnection.key),
      })

      const directory = await window.api.finishFirstLaunchOnboarding(shouldTrigger)
      if (!shouldTrigger || !directory) return

      console.info("[desktop-onboarding] starting first launch draft", { directory })
      server.projects.open(directory)
      server.projects.touch(directory)
      tabs.select(await tabs.newDraft({ server: server.key, directory }))
    } catch (error) {
      console.error("[desktop-onboarding] first launch onboarding failed", error)
    }
  }

  return null
}
