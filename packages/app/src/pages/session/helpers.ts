import type { CommandOption } from "@/context/command"

const previewExtensions = new Set([
  "html",
  "htm",
  "pdf",
  "svg",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "avif",
  "ico",
  "mp3",
  "wav",
  "ogg",
  "m4a",
  "aac",
  "flac",
  "opus",
])

export const isPreviewablePath = (path: string) => {
  const idx = path.lastIndexOf(".")
  if (idx === -1) return false
  return previewExtensions.has(path.slice(idx + 1).toLowerCase())
}

export const focusTerminalById = (id: string) => {
  const wrapper = document.getElementById(`terminal-wrapper-${id}`)
  const terminal = wrapper?.querySelector('[data-component="terminal"]')
  if (!(terminal instanceof HTMLElement)) return false

  const textarea = terminal.querySelector("textarea")
  if (textarea instanceof HTMLTextAreaElement) {
    textarea.focus()
    return true
  }

  terminal.focus()
  terminal.dispatchEvent(
    typeof PointerEvent === "function"
      ? new PointerEvent("pointerdown", { bubbles: true, cancelable: true })
      : new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
  )
  return true
}

export const createOpenReviewFile = (input: {
  showAllFiles: () => void
  tabForPath: (path: string) => string
  openTab: (tab: string) => void
  loadFile: (path: string) => void
}) => {
  return (path: string) => {
    input.showAllFiles()
    input.openTab(input.tabForPath(path))
    input.loadFile(path)
  }
}

export const createOpenPreviewFile = (input: {
  showAllFiles: () => void
  openTab: (tab: string) => void
  setPreviewPath: (path: string) => void
  loadFile: (path: string) => void
}) => {
  return (path: string) => {
    input.showAllFiles()
    input.setPreviewPath(path)
    input.openTab("preview")
    input.loadFile(path)
  }
}

export const combineCommandSections = (sections: readonly (readonly CommandOption[])[]) => {
  return sections.flatMap((section) => section)
}

export const getTabReorderIndex = (tabs: readonly string[], from: string, to: string) => {
  const fromIndex = tabs.indexOf(from)
  const toIndex = tabs.indexOf(to)
  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return undefined
  return toIndex
}
