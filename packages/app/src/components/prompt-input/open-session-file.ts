import { cloneSelectedLineRange } from "@opencode-ai/ui/pierre/selection-bridge"
import type { FileNodeType } from "@/components/blocksuite/file-reference-block"
import type { SelectedLineRange } from "@/context/file"

export type OpenSessionFileInput = {
  path: string
  nodeType?: FileNodeType
  selection?: SelectedLineRange | null
  origin?: "review" | "file"
  commentFocus?: { file: string; id: string }
}

export type OpenSessionFileDeps = {
  commentInReview: (path: string) => boolean
  reviewPanel: { opened: () => boolean; open: () => void }
  fileTree: { opened: () => boolean; open: () => void; setTab: (tab: "changes" | "all") => void }
  tabs: { setActive: (tab: string) => void; open: (tab: string) => void }
  tabForPath: (path: string) => string
  normalizePath: (path: string) => string
  expandTree: (dir: string) => void
  loadFile: (path: string) => void | Promise<void>
  setSelectedLines: (path: string, range: SelectedLineRange | null) => void
  setCommentActive: (focus: { file: string; id: string }) => void
  setCommentFocus: (focus: { file: string; id: string }) => void
  commentFocus: () => { file: string; id: string } | null | undefined
}

export const treeDirsForReveal = (path: string) => {
  const trimmed = path.replace(/\/+$/, "")
  if (!trimmed) return [""]
  const parts = trimmed.split("/").filter(Boolean)
  const out = [""]
  let current = ""
  for (const part of parts) {
    current = current ? `${current}/${part}` : part
    out.push(current)
  }
  return out
}

const scrollTreeTo = (path: string, left = 12) => {
  const run = (attempts: number) => {
    requestAnimationFrame(() => {
      const panel = document.getElementById("file-tree-panel")
      const el = panel?.querySelector(`[data-file-tree-path="${CSS.escape(path)}"]`)
      if (el instanceof HTMLElement) {
        el.scrollIntoView({ block: "nearest", behavior: "smooth" })
        return
      }
      if (attempts > 0) run(attempts - 1)
    })
  }
  run(left)
}

const queueCommentFocus = (deps: OpenSessionFileDeps, focus: { file: string; id: string }, attempts = 6) => {
  const schedule = (left: number) => {
    requestAnimationFrame(() => {
      deps.setCommentFocus(focus)
      if (left <= 0) return
      requestAnimationFrame(() => {
        const current = deps.commentFocus()
        if (!current) return
        if (current.file !== focus.file || current.id !== focus.id) return
        schedule(left - 1)
      })
    })
  }
  schedule(attempts)
}

export function createOpenSessionFile(deps: OpenSessionFileDeps) {
  return (input: OpenSessionFileInput) => {
    if (input.nodeType === "directory") {
      const path = deps.normalizePath(input.path)
      if (!deps.reviewPanel.opened()) deps.reviewPanel.open()
      if (!deps.fileTree.opened()) deps.fileTree.open()
      deps.fileTree.setTab("all")
      for (const dir of treeDirsForReveal(path)) deps.expandTree(dir)
      scrollTreeTo(path)
      return
    }

    const wantsReview =
      input.origin === "review" || (input.origin !== "file" && deps.commentInReview(input.path))

    if (input.commentFocus) deps.setCommentActive(input.commentFocus)

    const applySelection = () => {
      if (input.selection) deps.setSelectedLines(input.path, cloneSelectedLineRange(input.selection))
      else deps.setSelectedLines(input.path, null)
    }

    if (wantsReview) {
      if (!deps.reviewPanel.opened()) deps.reviewPanel.open()
      deps.fileTree.setTab("changes")
      applySelection()
      deps.tabs.setActive("review")
      if (input.commentFocus) queueCommentFocus(deps, input.commentFocus)
      return
    }

    if (!deps.reviewPanel.opened()) deps.reviewPanel.open()
    deps.fileTree.setTab("all")
    const tab = deps.tabForPath(input.path)
    deps.tabs.open(tab)
    deps.tabs.setActive(tab)
    Promise.resolve(deps.loadFile(input.path)).finally(() => {
      applySelection()
      if (input.commentFocus) queueCommentFocus(deps, input.commentFocus)
    })
  }
}
