import type { BrowserAPI } from "./browser-types"

type BrowserActionEntry = {
  id: string
  title: string
  url: string
  visible: boolean
}

type BrowserActionsStore = {
  store: {
    activeId: string | null
    instances?: Record<string, BrowserActionEntry>
  }
  addBrowser?: (id: string) => void
  setActiveBrowser?: (id: string) => void
  updateBrowser?: (id: string, patch: Partial<BrowserActionEntry>) => void
}

export async function openBrowserPanel(options: {
  api?: Pick<BrowserAPI, "createBrowser" | "navigate">
  browserStore: BrowserActionsStore
  openPanel: () => void
  setPanelOpen: (open: boolean) => void
  url?: string
}) {
  options.openPanel()
  options.setPanelOpen(true)
  if (!options.api) return undefined

  const existingId = options.browserStore.store.activeId ?? Object.keys(options.browserStore.store.instances ?? {})[0]
  const created =
    existingId || !options.browserStore.addBrowser || !options.api.createBrowser
      ? undefined
      : await options.api.createBrowser(options.url ? { url: options.url } : undefined)
  const browserId = existingId ?? created?.state.activeBrowserId ?? created?.browser.id

  if (created) {
    options.browserStore.addBrowser?.(created.browser.id)
    options.browserStore.updateBrowser?.(created.browser.id, {
      title: created.browser.title,
      url: created.browser.url,
      visible: true,
    })
  }
  if (browserId) options.browserStore.setActiveBrowser?.(browserId)
  if (options.url && (!created || created.browser.url !== options.url)) await options.api.navigate(options.url)

  return browserId
}
