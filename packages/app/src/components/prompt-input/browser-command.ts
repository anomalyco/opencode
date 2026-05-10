import type { BrowserAPI } from "@/context/browser-types"
import type { ImageAttachmentPart, Prompt } from "@/context/prompt"
import type { SlashCommand } from "./slash-popover"

type BrowserActionEntry = {
  id: string
  title: string
  url: string
  visible: boolean
}

export type BrowserCommandTarget = {
  api?: Pick<BrowserAPI, "createBrowser" | "navigate">
  store: {
    store: {
      activeId: string | null
      instances?: Record<string, BrowserActionEntry>
    }
    addBrowser?: (id: string) => void
    setActiveBrowser?: (id: string) => void
    updateBrowser?: (id: string, patch: Partial<BrowserActionEntry>) => void
  }
  openPanel: () => void
  setPanelOpen: (open: boolean) => void
}

export const BROWSER_SLASH_DESCRIPTION = "Control the in-app browser"

export const browserSlashSelection = (images: ImageAttachmentPart[]) => {
  const text = "/browser "
  return {
    text,
    cursor: text.length,
    prompt: [{ type: "text", content: text, start: 0, end: text.length }, ...images] satisfies Prompt,
  }
}

export const applySlashCommandSelection = (input: {
  cmd: SlashCommand | undefined
  images: ImageAttachmentPart[]
  setEditorText: (value: string) => void
  setPrompt: (value: Prompt, cursor: number) => void
  focusEditorEnd: () => void
  clearEditor: () => void
  triggerCommand: (id: string, source: "slash") => void
}) => {
  if (!input.cmd) return

  if (input.cmd.type === "custom") {
    const text = `/${input.cmd.trigger} `
    input.setEditorText(text)
    input.setPrompt([{ type: "text", content: text, start: 0, end: text.length }, ...input.images], text.length)
    input.focusEditorEnd()
    return
  }

  if (input.cmd.trigger === "browser") {
    const selection = browserSlashSelection(input.images)
    input.setEditorText(selection.text)
    input.setPrompt(selection.prompt, selection.cursor)
    input.focusEditorEnd()
    return
  }

  input.clearEditor()
  input.setPrompt([{ type: "text", content: "", start: 0, end: 0 }, ...input.images], 0)
  input.triggerCommand(input.cmd.id, "slash")
}

export const parseBrowserSlashCommand = (text: string) => {
  const match = text.trim().match(/^\/browser(?:\s+([\s\S]+))?$/)
  if (!match) return undefined
  const task = match[1]?.trim()
  if (!task) return { ok: true as const }
  return { ok: true as const, task }
}
