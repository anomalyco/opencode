import { openBrowserPanel } from "@/context/browser-actions"
import type { BrowserAPI } from "@/context/browser-types"
import type { ContentPart } from "@/context/prompt"
import type { AtOption } from "./slash-popover"

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

export const BROWSER_AT_OPTION = {
  type: "browser",
  display: "Browser — Control the in-app browser",
} satisfies AtOption

export const buildAtOptions = (input: { agents: AtOption[]; pinned: AtOption[]; files: AtOption[] }) => [
  ...input.agents,
  BROWSER_AT_OPTION,
  ...input.pinned,
  ...input.files,
]

export const getAtOptionKey = (option: AtOption | undefined) => {
  if (!option) return ""
  if (option.type === "agent") return `agent:${option.name}`
  if (option.type === "browser") return "browser"
  return `file:${option.path}`
}

export async function activateBrowserMention(options: {
  api?: Pick<BrowserAPI, "createBrowser" | "navigate">
  browserStore: BrowserActionsStore
  openPanel: () => void
  setPanelOpen: (open: boolean) => void
}): Promise<ContentPart> {
  await openBrowserPanel({
    api: options.api,
    browserStore: options.browserStore,
    openPanel: options.openPanel,
    setPanelOpen: options.setPanelOpen,
  })

  return { type: "text", content: "@browser ", start: 0, end: 0 }
}
