// @refresh reload
import { render } from "solid-js/web"
import { App } from "@/app"
import { Platform, PlatformProvider } from "@/context/platform"

const root = document.getElementById("root")
if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  throw new Error(
    "Root element not found. Did you forget to add it to your index.html? Or maybe the id attribute got misspelled?",
  )
}

const platform: Platform = {
  platform: "web",
  openLink(url: string) {
    window.open(url, "_blank")
  },
}

render(
  () => (
    <PlatformProvider value={platform}>
      <App />
    </PlatformProvider>
  ),
  root!,
)
