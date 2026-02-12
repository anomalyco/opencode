import { SerializeAddon } from "@xterm/addon-serialize"
import "@xterm/xterm/css/xterm.css"
import "../terminal.css"
import {
  createTerminalInstance,
  setupKeyboardHandler,
  setupPasteHandler,
  setupCopyHandler,
  setupResizeHandlers,
  scrollToBottom,
} from "../helpers"
import { createModeScanner } from "../mode-scan"
import { createQuerySuppressor } from "../query-suppression"
import type { TerminalBackend, TerminalBackendOptions, Disposable, CreateBackendFn } from "./types"

export const createBackend: CreateBackendFn = async (
  container: HTMLDivElement,
  options: TerminalBackendOptions,
): Promise<TerminalBackend> => {
  const instance = createTerminalInstance(container, {
    initialTheme: options.theme,
    fontFamily: options.fontFamily,
  })

  const { xterm, fitAddon } = instance
  const cleanups: VoidFunction[] = [instance.cleanup, () => xterm.dispose()]

  // Load serialize addon
  const serializeAddon = new SerializeAddon()
  xterm.loadAddon(serializeAddon)

  // Load search addon (async, best-effort)
  import("@xterm/addon-search")
    .then(({ SearchAddon }) => {
      const searchAddon = new SearchAddon()
      xterm.loadAddon(searchAddon)
    })
    .catch(() => {})

  // Track bracketed paste mode across split writes.
  const mode = createModeScanner()
  const suppress = createQuerySuppressor()
  const originalWrite = xterm.write.bind(xterm)

  // Data/key listeners managed externally
  let dataListeners: Array<(data: string) => void> = []
  let keyListeners: Array<(e: { key: string }) => void> = []
  let resizeListeners: Array<(size: { cols: number; rows: number }) => void> = []

  // Setup keyboard handler with a write function that goes through onData listeners
  const handleWrite = (data: string) => {
    for (const fn of dataListeners) fn(data)
  }

  const cleanupKeyboard = setupKeyboardHandler(xterm, {
    onShiftEnter: () => handleWrite("\x1b\r"),
    onWrite: handleWrite,
    onSplitVertical: options.onSplitVertical,
    onSplitHorizontal: options.onSplitHorizontal,
  })
  cleanups.push(cleanupKeyboard)

  const cleanupPaste = setupPasteHandler(xterm, {
    onWrite: handleWrite,
    isBracketedPasteEnabled: () => mode.bracketed(),
  })
  cleanups.push(cleanupPaste)

  const cleanupCopy = setupCopyHandler(xterm)
  cleanups.push(cleanupCopy)

  // Toggle cursor blink on focus/blur (matches upstream ghostty-web behavior)
  const textarea = xterm.textarea
  if (textarea) {
    const onFocus = () => { xterm.options.cursorBlink = true }
    const onBlur = () => { xterm.options.cursorBlink = false }
    textarea.addEventListener("focus", onFocus)
    textarea.addEventListener("blur", onBlur)
    cleanups.push(() => {
      textarea.removeEventListener("focus", onFocus)
      textarea.removeEventListener("blur", onBlur)
    })
  }

  // Setup resize handlers (includes visibilitychange + mount fits)
  const resizeHandlers = setupResizeHandlers(container, xterm, fitAddon, (cols, rows) => {
    for (const fn of resizeListeners) fn({ cols, rows })
  }, instance.renderer)
  cleanups.push(resizeHandlers.cleanup)

  // Wire xterm's native onData (user typing) into our data listeners
  const xtermOnData = xterm.onData((data) => {
    for (const fn of dataListeners) fn(data)
  })
  cleanups.push(() => xtermOnData.dispose())

  // Wire xterm's native onKey into our key listeners
  const xtermOnKey = xterm.onKey((e) => {
    for (const fn of keyListeners) fn({ key: e.key })
  })
  cleanups.push(() => xtermOnKey.dispose())

  let disposed = false

  const backend: TerminalBackend = {
    get cols() {
      return xterm.cols
    },
    get rows() {
      return xterm.rows
    },
    get textarea() {
      return xterm.textarea ?? null
    },
    get element() {
      return xterm.element ?? null
    },

    write(data: string, callback?: () => void) {
      const filtered = suppress.scan(data)
      mode.scan(filtered)
      if (!filtered) {
        callback?.()
        return
      }
      if (callback) {
        originalWrite(filtered, callback)
      } else {
        originalWrite(filtered)
      }
    },

    onData(fn: (data: string) => void): Disposable {
      dataListeners.push(fn)
      return {
        dispose() {
          dataListeners = dataListeners.filter((f) => f !== fn)
        },
      }
    },

    onKey(fn: (e: { key: string }) => void): Disposable {
      keyListeners.push(fn)
      return {
        dispose() {
          keyListeners = keyListeners.filter((f) => f !== fn)
        },
      }
    },

    onResize(fn: (size: { cols: number; rows: number }) => void): Disposable {
      resizeListeners.push(fn)
      return {
        dispose() {
          resizeListeners = resizeListeners.filter((f) => f !== fn)
        },
      }
    },

    setTheme(theme) {
      xterm.options.theme = theme
    },

    setFontFamily(font) {
      xterm.options.fontFamily = font
    },

    setCursorBlink(blink) {
      xterm.options.cursorBlink = blink
    },

    focus() {
      xterm.focus()
      setTimeout(() => xterm.textarea?.focus(), 0)
    },

    getSelection() {
      return xterm.getSelection()
    },

    hasSelection() {
      return xterm.hasSelection()
    },

    scrollToLine(line) {
      xterm.scrollToLine(line)
    },

    scrollToBottom() {
      scrollToBottom(xterm)
    },

    getViewportY() {
      return xterm.buffer.active.viewportY
    },

    isAtBottom() {
      const buffer = xterm.buffer.active
      return buffer.viewportY >= buffer.baseY
    },

    resize(cols, rows) {
      xterm.resize(cols, rows)
    },

    fit() {
      fitAddon.fit()
    },

    refresh(start, end) {
      xterm.refresh(start, end)
    },

    flushResize() {
      resizeHandlers.coordinator.flush()
    },

    serialize(options) {
      return serializeAddon.serialize(options)
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
      dataListeners = []
      keyListeners = []
      resizeListeners = []
    },
  }

  return backend
}
