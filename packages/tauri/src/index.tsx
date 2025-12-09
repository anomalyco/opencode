// @refresh reload
import { render } from "solid-js/web"
import { DesktopInterface, PlatformProvider, Platform } from "@opencode-ai/desktop"
import { runUpdater } from "./updater"
import { onMount } from "solid-js"

const root = document.getElementById("root")
if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  throw new Error(
    "Root element not found. Did you forget to add it to your index.html? Or maybe the id attribute got misspelled?",
  )
}

const platform: Platform = {}

declare global {
  interface Window {
    __OPENCODE__?: { updaterEnabled?: boolean }
  }
}

render(
  () => {
    onMount(() => {
      if(window.__OPENCODE__?.updaterEnabled) runUpdater();
    });

  return (
    <PlatformProvider value={platform}>
      <DesktopInterface />
    </PlatformProvider>
  )
}, root!)
