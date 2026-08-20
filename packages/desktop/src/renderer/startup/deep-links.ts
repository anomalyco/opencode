import type { ElectronAPI } from "../../preload/types"

const deepLinkEvent = "opencode:deep-link"

export function startDeepLinks(api: ElectronAPI) {
  void api.consumeInitialDeepLinks().then(emitDeepLinks)
  api.onDeepLink(emitDeepLinks)
}

function emitDeepLinks(urls: string[]) {
  if (urls.length === 0) return
  window.__OPENCODE__ ??= {}
  window.__OPENCODE__.deepLinks = [...(window.__OPENCODE__.deepLinks ?? []), ...urls]
  window.dispatchEvent(new CustomEvent(deepLinkEvent, { detail: { urls } }))
}
