import type { WebContents } from "electron"

type NavigationPolicyDependencies = {
  isRendererUrl: (url: string) => boolean
  openExternal: (url: string) => void
}

export function wireNavigationPolicy(
  webContents: Pick<WebContents, "setWindowOpenHandler" | "on">,
  dependencies: NavigationPolicyDependencies,
) {
  webContents.setWindowOpenHandler(({ url }) => {
    if (!dependencies.isRendererUrl(url)) dependencies.openExternal(url)
    return { action: "deny" }
  })
  // Renderer reloads (window.location.reload) navigate to the app's own URL
  // and must stay in-window; everything else leaves through the OS.
  webContents.on("will-navigate", (event, url) => {
    if (dependencies.isRendererUrl(url)) return
    event.preventDefault()
    dependencies.openExternal(url)
  })
  webContents.on("will-frame-navigate", (details) => {
    if (details.isMainFrame || details.url === "about:srcdoc") return
    details.preventDefault()
  })
}
