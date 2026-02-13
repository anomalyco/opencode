import type { PaneDir, PaneManager } from "./pane-manager"

type NavDir = "up" | "down" | "left" | "right" | "parent" | "child"

type Handlers = {
  onSplit?: (containerId: string, nodeId: string, dir: PaneDir) => void | Promise<void>
  onClose?: (containerId: string, nodeId: string) => void | Promise<void>
  onNavigate?: (containerId: string, nodeId: string, dir: NavDir) => void | Promise<void>
}

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform)

const key = (e: KeyboardEvent) => (e.key.length === 1 ? e.key.toLowerCase() : e.key)

const nav = (e: KeyboardEvent): NavDir | undefined => {
  if (key(e) === "arrowleft") return "left"
  if (key(e) === "arrowright") return "right"
  if (key(e) === "arrowup") return "up"
  if (key(e) === "arrowdown") return "down"
  return
}

export const createPaneShortcuts = <Meta,>(pane: PaneManager<Meta>) => {
  const handlers = { current: undefined as Handlers | undefined }

  const onKeyDown = async (e: KeyboardEvent) => {
    const h = handlers.current
    if (!h) return
    if (typeof window === "undefined") return

    const containerId = await pane.getActiveContainer()
    if (!containerId) return
    const nodeId = await pane.getActiveNode(containerId)
    if (!nodeId) return

    const mod = isMac() ? e.metaKey : e.ctrlKey
    const alt = e.altKey

    if (mod && key(e) === "d" && !e.shiftKey) {
      await h.onSplit?.(containerId, nodeId, "v")
      e.preventDefault()
      e.stopPropagation()
      return
    }

    if (mod && key(e) === "d" && e.shiftKey) {
      await h.onSplit?.(containerId, nodeId, "h")
      e.preventDefault()
      e.stopPropagation()
      return
    }

    if (mod && key(e) === "w") {
      await h.onClose?.(containerId, nodeId)
      e.preventDefault()
      e.stopPropagation()
      return
    }

    const d = mod && alt ? nav(e) : undefined
    if (!d) return
    await h.onNavigate?.(containerId, nodeId, d)
    e.preventDefault()
    e.stopPropagation()
  }

  return {
    register(input: Handlers) {
      handlers.current = input
      if (typeof window === "undefined") return () => {}
      window.addEventListener("keydown", onKeyDown, true)
      return () => window.removeEventListener("keydown", onKeyDown, true)
    },
  }
}
