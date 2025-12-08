// @refresh reload
import { render } from "solid-js/web"
import { DesktopInterface, PlatformProvider, Platform } from "@opencode-ai/desktop"

const root = document.getElementById("root")
if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  throw new Error(
    "Root element not found. Did you forget to add it to your index.html? Or maybe the id attribute got misspelled?",
  )
}

const platform: Platform = {}

render(
  () => (
    <PlatformProvider value={platform}>
      <DesktopInterface />
    </PlatformProvider>
  ),
  root!,
)
