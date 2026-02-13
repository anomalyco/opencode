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
  const debug = typeof localStorage !== "undefined" && !!localStorage.getItem("opencode.debug.terminal")
  if (debug) {
    // eslint-disable-next-line no-console
    console.log("[terminal:backend]", "xterm", {
      width: container.clientWidth,
      height: container.clientHeight,
      hasSplitVertical: !!options.onSplitVertical,
      hasSplitHorizontal: !!options.onSplitHorizontal,
    })
  }
  const instance = createTerminalInstance(container, {
    initialTheme: options.theme,
    fontFamily: options.fontFamily,
    onFileLinkClick: options.onFileLinkClick,
    onUrlClick: options.onUrlClick,
  })

  const { xterm, fitAddon } = instance
  // Dispose renderer (WebglAddon) before xterm to prevent "undefined is not an object" errors
  // during disposal (race condition in xterm's refresh loop).
  // Note: cleanups are reversed before execution, so the last item runs first.
  const cleanups: VoidFunction[] = [() => xterm.dispose(), instance.cleanup]

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

  // Alternate scroll mode (DECSET 1007): when enabled, real terminals map
  // wheel/trackpad scroll to Up/Down keypresses instead of scrollback.
  //
  // Additionally, some TUIs don't enable 1007 but still want scroll gestures
  // to stay inside the app (not scroll the surrounding page). In alt-screen,
  // we provide a conservative fallback to PageUp/PageDown when mouse tracking
  // is disabled.
  const setupWheel = () => {
    const el = container
    let acc = 0
    const stepPx = 40
    const maxBurst = 12

    const seq = (dir: 1 | -1) => {
      const appCursor = mode.modes().applicationCursorKeys
      if (dir < 0) return appCursor ? "\x1bOA" : "\x1b[A"
      return appCursor ? "\x1bOB" : "\x1b[B"
    }
    const page = (dir: 1 | -1) => {
      if (dir < 0) return "\x1b[5~"
      return "\x1b[6~"
    }

    const onWheel = (event: WheelEvent) => {
      const m = mode.modes()
      if (!m.alternateScroll && !m.alternateScreen) return

      // Prevent the surrounding page/panels from scrolling when a fullscreen
      // TUI is running. Don't stop propagation so xterm can still handle mouse
      // wheel reporting when mouse tracking is enabled.
      event.preventDefault()

      const mouse =
        m.mouseTrackingX10 ||
        m.mouseTrackingNormal ||
        m.mouseTrackingHighlight ||
        m.mouseTrackingButtonEvent ||
        m.mouseTrackingAnyEvent ||
        m.mouseUtf8 ||
        m.mouseSgr
      if (mouse) return
      if (!m.alternateScroll && !m.alternateScreen) return

      const dy = event.deltaY
      if (!Number.isFinite(dy) || dy === 0) return

      // Normalize delta across devices. deltaMode=1 is "lines", 2 is "pages".
      const unit = event.deltaMode === 1 ? 12 : event.deltaMode === 2 ? 96 : 1
      acc += dy * unit

      const count = Math.min(maxBurst, Math.floor(Math.abs(acc) / stepPx))
      if (count <= 0) return

      const dir = acc < 0 ? -1 : 1
      acc -= dir * count * stepPx

      if (m.alternateScroll) {
        handleWrite(seq(dir as 1 | -1).repeat(count))
        return
      }

      // Alt-screen fallback (no 1007): prefer PageUp/PageDown. Arrow keys tend to
      // move focus rather than scroll in many TUIs.
      handleWrite(page(dir as 1 | -1).repeat(Math.min(6, count)))
    }

    el.addEventListener("wheel", onWheel, { passive: false, capture: true })
    return () => el.removeEventListener("wheel", onWheel, { capture: true } as any)
  }

  cleanups.push(setupWheel())

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
    const onFocus = () => {
      xterm.options.cursorBlink = true
    }
    const onBlur = () => {
      xterm.options.cursorBlink = false
    }
    textarea.addEventListener("focus", onFocus)
    textarea.addEventListener("blur", onBlur)
    cleanups.push(() => {
      textarea.removeEventListener("focus", onFocus)
      textarea.removeEventListener("blur", onBlur)
    })
  }

  // Setup resize handlers (includes visibilitychange + mount fits)
  const resizeHandlers = setupResizeHandlers(
    container,
    xterm,
    fitAddon,
    (cols, rows) => {
      for (const fn of resizeListeners) fn({ cols, rows })
    },
    instance.renderer,
  )
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

    rehydrateSequences() {
      return mode.rehydrateSequences()
    },

    isAltScreen() {
      try {
        return (xterm.buffer.active as unknown as { type?: string })?.type === "alternate"
      } catch {}
      return mode.modes().alternateScreen
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
