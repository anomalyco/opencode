import type { Ghostty, Terminal as Term, FitAddon as GhosttyFitAddon } from "ghostty-web"
import { SerializeAddon } from "@/addons/serialize"
import { disposeIfDisposable, setOptionIfSupported, getHoveredLinkText } from "@/utils/runtime-adapters"
import type { TerminalBackend, TerminalBackendOptions, Disposable, CreateBackendFn } from "./types"

let shared: Promise<{ mod: typeof import("ghostty-web"); ghostty: Ghostty }> | undefined

const loadGhostty = () => {
  if (shared) return shared
  shared = import("ghostty-web")
    .then(async (mod) => ({ mod, ghostty: await mod.Ghostty.load() }))
    .catch((err) => {
      shared = undefined
      throw err
    })
  return shared
}

export const createBackend: CreateBackendFn = async (
  container: HTMLDivElement,
  options: TerminalBackendOptions,
): Promise<TerminalBackend> => {
  const loaded = await loadGhostty()
  const mod = loaded.mod
  const g = loaded.ghostty

  const cleanups: VoidFunction[] = []

  const t = new mod.Terminal({
    cursorBlink: true,
    cursorStyle: "bar",
    fontSize: 14,
    fontFamily: options.fontFamily,
    allowTransparency: true,
    convertEol: true,
    theme: options.theme,
    scrollback: 10_000,
    ghostty: g,
  })
  cleanups.push(() => t.dispose())

  // Copy handler
  const copy = () => {
    const selection = t.getSelection()
    if (!selection) return false

    const body = document.body
    if (body) {
      const textarea = document.createElement("textarea")
      textarea.value = selection
      textarea.setAttribute("readonly", "")
      textarea.style.position = "fixed"
      textarea.style.opacity = "0"
      body.appendChild(textarea)
      textarea.select()
      const copied = document.execCommand("copy")
      body.removeChild(textarea)
      if (copied) return true
    }

    const clipboard = navigator.clipboard
    if (clipboard?.writeText) {
      clipboard.writeText(selection).catch(() => {})
      return true
    }

    return false
  }

  // Custom key event handler
  t.attachCustomKeyEventHandler((event) => {
    const key = event.key.toLowerCase()

    // Ctrl+Shift+C: copy
    if (event.ctrlKey && event.shiftKey && !event.metaKey && key === "c") {
      copy()
      return true
    }

    // Cmd+C: copy if selection
    if (event.metaKey && !event.ctrlKey && !event.altKey && key === "c") {
      if (!t.hasSelection()) return true
      copy()
      return true
    }

    // Cmd+D: split vertical
    if (event.metaKey && !event.shiftKey && !event.ctrlKey && !event.altKey && key === "d") {
      if (event.type === "keydown" && options.onSplitVertical) {
        event.preventDefault()
        event.stopPropagation()
        options.onSplitVertical()
      }
      return false
    }

    // Cmd+Shift+D: split horizontal
    if (event.metaKey && event.shiftKey && !event.ctrlKey && !event.altKey && key === "d") {
      if (event.type === "keydown" && options.onSplitHorizontal) {
        event.preventDefault()
        event.stopPropagation()
        options.onSplitHorizontal()
      }
      return false
    }

    // Ctrl+`: allow for parent app toggle
    if (event.ctrlKey && key === "`") {
      return true
    }

    return false
  })

  const fit = new mod.FitAddon()
  const serializeAddon = new SerializeAddon()
  cleanups.push(() => disposeIfDisposable(fit))
  t.loadAddon(serializeAddon)
  t.loadAddon(fit)

  t.open(container)

  // Link click handler
  const handleLinkClick = (event: MouseEvent) => {
    if (!event.shiftKey && !event.ctrlKey && !event.metaKey) return
    if (event.altKey) return
    if (event.button !== 0) return

    const text = getHoveredLinkText(t)
    if (!text) return

    event.preventDefault()
    event.stopImmediatePropagation()
    window.open(text, "_blank")
  }
  container.addEventListener("click", handleLinkClick, { capture: true })
  cleanups.push(() => container.removeEventListener("click", handleLinkClick, { capture: true }))

  fit.fit()
  fit.observeResize()

  // Window resize handler
  const handleResize = () => fit.fit()
  window.addEventListener("resize", handleResize)
  cleanups.push(() => window.removeEventListener("resize", handleResize))

  // Listen for fit events
  const handleFit = () => fit.fit()
  window.addEventListener("opencode:terminal-fit", handleFit)
  cleanups.push(() => window.removeEventListener("opencode:terminal-fit", handleFit))

  let disposed = false

  const backend: TerminalBackend = {
    get cols() {
      return t.cols
    },
    get rows() {
      return t.rows
    },
    get textarea() {
      return t.textarea ?? null
    },
    get element() {
      return t.element ?? null
    },

    write(data: string, callback?: () => void) {
      if (callback) {
        t.write(data, callback)
      } else {
        t.write(data)
      }
    },

    onData(fn: (data: string) => void): Disposable {
      const sub = t.onData(fn)
      return { dispose: () => disposeIfDisposable(sub) }
    },

    onKey(fn: (e: { key: string }) => void): Disposable {
      const sub = t.onKey(fn)
      return { dispose: () => disposeIfDisposable(sub) }
    },

    onResize(fn: (size: { cols: number; rows: number }) => void): Disposable {
      const sub = t.onResize(fn)
      return { dispose: () => disposeIfDisposable(sub) }
    },

    setTheme(theme) {
      setOptionIfSupported(t, "theme", theme)
    },

    setFontFamily(font) {
      setOptionIfSupported(t, "fontFamily", font)
    },

    setCursorBlink(blink) {
      t.options.cursorBlink = blink
    },

    focus() {
      t.focus()
      setTimeout(() => t.textarea?.focus(), 0)
    },

    getSelection() {
      return t.getSelection()
    },

    hasSelection() {
      return t.hasSelection()
    },

    scrollToLine(line) {
      t.scrollToLine(line)
    },

    scrollToBottom() {
      t.scrollToBottom()
    },

    getViewportY() {
      return t.getViewportY()
    },

    isAtBottom() {
      // ghostty-web: check if viewport is at the bottom
      const buffer = (t as any).buffer?.active
      if (buffer) return buffer.viewportY >= buffer.baseY
      // Fallback: assume at bottom
      return true
    },

    resize(cols, rows) {
      t.resize(cols, rows)
    },

    fit() {
      fit.fit()
    },

    refresh(_start, _end) {
      // ghostty-web handles refresh internally; no-op
    },

    flushResize() {
      // ghostty-web handles resize flushing internally; no-op
    },

    serialize() {
      return serializeAddon.serialize()
    },

    dispose() {
      if (disposed) return
      disposed = true
      const fns = cleanups.splice(0).reverse()
      for (const fn of fns) {
        try {
          fn()
        } catch {}
      }
    },
  }

  return backend
}
