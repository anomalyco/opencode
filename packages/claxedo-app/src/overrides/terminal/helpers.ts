import { Terminal as XTerm } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import { ClipboardAddon } from "@xterm/addon-clipboard"
import { Unicode11Addon } from "@xterm/addon-unicode11"
import { ImageAddon } from "@xterm/addon-image"
import { WebglAddon } from "@xterm/addon-webgl"
import { CanvasAddon } from "@xterm/addon-canvas"
import { WebLinksAddon } from "@xterm/addon-web-links"
import { TERMINAL_OPTIONS, RESIZE_DEBOUNCE_MS } from "./config"
import type { ITheme } from "@xterm/xterm"

// ============================================================================
// Scroll Utilities
// ============================================================================

/**
 * Scroll terminal to bottom using DOM viewport directly.
 * This is more reliable than xterm's internal scrollToBottom() method.
 */
export function scrollToBottom(terminal: XTerm, behavior: ScrollBehavior = "instant"): void {
  const viewport = terminal.element?.querySelector(".xterm-viewport")
  if (viewport) {
    viewport.scrollTo({
      top: viewport.scrollHeight,
      behavior,
    })
  } else {
    terminal.scrollToBottom()
  }
}

// ============================================================================
// Types
// ============================================================================

export interface TerminalRendererRef {
  current: {
    kind: "webgl" | "canvas" | "dom"
    dispose: () => void
    clearTextureAtlas?: () => void
  }
}

export interface CreateTerminalResult {
  xterm: XTerm
  fitAddon: FitAddon
  renderer: TerminalRendererRef
  cleanup: () => void
}

// ============================================================================
// GPU Renderer Loading
// ============================================================================

function loadRenderer(xterm: XTerm): TerminalRendererRef["current"] {
  // Avoid WebGL on macOS due to corruption issues
  const preferCanvas = navigator.userAgent.includes("Macintosh")

  if (preferCanvas) {
    try {
      const canvas = new CanvasAddon()
      xterm.loadAddon(canvas)
      return { kind: "canvas", dispose: () => canvas.dispose() }
    } catch {
      return { kind: "dom", dispose: () => {} }
    }
  }

  try {
    const webgl = new WebglAddon()
    webgl.onContextLoss(() => {
      webgl.dispose()
      // Fallback to canvas on context loss
      try {
        const canvas = new CanvasAddon()
        xterm.loadAddon(canvas)
        xterm.refresh(0, xterm.rows - 1)
      } catch {}
    })
    xterm.loadAddon(webgl)
    return {
      kind: "webgl",
      dispose: () => webgl.dispose(),
      clearTextureAtlas: () => {
        try {
          webgl.clearTextureAtlas()
        } catch {}
      },
    }
  } catch {
    try {
      const canvas = new CanvasAddon()
      xterm.loadAddon(canvas)
      return { kind: "canvas", dispose: () => canvas.dispose() }
    } catch {
      return { kind: "dom", dispose: () => {} }
    }
  }
}

// ============================================================================
// Terminal Instance Creation
// ============================================================================

export function createTerminalInstance(
  container: HTMLDivElement,
  options: { initialTheme?: ITheme | null; fontFamily?: string } = {},
): CreateTerminalResult {
  const theme = options.initialTheme ?? undefined
  const terminalOptions = { ...TERMINAL_OPTIONS, theme }
  if (options.fontFamily) {
    terminalOptions.fontFamily = options.fontFamily
  }

  const xterm = new XTerm(terminalOptions)
  const fitAddon = new FitAddon()
  const clipboardAddon = new ClipboardAddon()
  const unicode11Addon = new Unicode11Addon()
  const imageAddon = new ImageAddon()
  const webLinksAddon = new WebLinksAddon()

  let isDisposed = false
  let rafId: number | null = null

  const rendererRef: TerminalRendererRef = {
    current: { kind: "dom", dispose: () => {}, clearTextureAtlas: undefined },
  }

  xterm.open(container)

  // Load non-renderer addons immediately
  xterm.loadAddon(fitAddon)
  xterm.loadAddon(clipboardAddon)
  xterm.loadAddon(unicode11Addon)
  xterm.loadAddon(imageAddon)
  xterm.loadAddon(webLinksAddon)

  // Defer GPU renderer to next animation frame (avoids race condition)
  rafId = requestAnimationFrame(() => {
    rafId = null
    if (isDisposed) return
    rendererRef.current = loadRenderer(xterm)
    try {
      fitAddon.fit()
      xterm.refresh(0, xterm.rows - 1)
    } catch {}
  })

  // Load ligatures addon async
  import("@xterm/addon-ligatures")
    .then(({ LigaturesAddon }) => {
      if (isDisposed) return
      try {
        xterm.loadAddon(new LigaturesAddon())
      } catch {}
    })
    .catch(() => {})

  xterm.unicode.activeVersion = "11"
  fitAddon.fit()

  return {
    xterm,
    fitAddon,
    renderer: rendererRef,
    cleanup: () => {
      isDisposed = true
      if (rafId !== null) cancelAnimationFrame(rafId)
      rendererRef.current.dispose()
    },
  }
}

// ============================================================================
// Keyboard Handler
// ============================================================================

export function setupKeyboardHandler(
  xterm: XTerm,
  options: {
    onShiftEnter?: () => void
    onClear?: () => void
    onWrite?: (data: string) => void
    onSplitVertical?: () => void
    onSplitHorizontal?: () => void
  } = {},
): () => void {
  const handler = (event: KeyboardEvent): boolean => {
    // Shift+Enter: Send ESC+CR for line continuation
    if (event.key === "Enter" && event.shiftKey && !event.metaKey && !event.ctrlKey) {
      if (event.type === "keydown" && options.onShiftEnter) {
        options.onShiftEnter()
      }
      return false
    }

    // Cmd+Backspace: Clear line (Ctrl+U + left arrow)
    if (event.key === "Backspace" && event.metaKey) {
      if (event.type === "keydown" && options.onWrite) {
        options.onWrite("\x15\x1b[D")
      }
      return false
    }

    // Cmd+Left: Beginning of line (Ctrl+A)
    if (event.key === "ArrowLeft" && event.metaKey) {
      if (event.type === "keydown" && options.onWrite) {
        options.onWrite("\x01")
      }
      return false
    }

    // Cmd+Right: End of line (Ctrl+E)
    if (event.key === "ArrowRight" && event.metaKey) {
      if (event.type === "keydown" && options.onWrite) {
        options.onWrite("\x05")
      }
      return false
    }

    // Cmd+D: Split vertical (left/right)
    if (event.key === "d" && event.metaKey && !event.shiftKey && !event.ctrlKey && !event.altKey) {
      if (event.type === "keydown" && options.onSplitVertical) {
        event.preventDefault()
        options.onSplitVertical()
      }
      return false
    }

    // Cmd+Shift+D: Split horizontal (top/bottom)
    if (event.key === "d" && event.metaKey && event.shiftKey && !event.ctrlKey && !event.altKey) {
      if (event.type === "keydown" && options.onSplitHorizontal) {
        event.preventDefault()
        options.onSplitHorizontal()
      }
      return false
    }

    // Allow Ctrl+` for parent app toggle
    if (event.ctrlKey && event.key === "`") {
      return true
    }

    return true
  }

  xterm.attachCustomKeyEventHandler(handler)
  return () => xterm.attachCustomKeyEventHandler(() => true)
}

// ============================================================================
// Paste Handler with Bracketed Paste
// ============================================================================

export function setupPasteHandler(
  xterm: XTerm,
  options: {
    onWrite?: (data: string) => void
    isBracketedPasteEnabled?: () => boolean
  } = {},
): () => void {
  const textarea = xterm.textarea
  if (!textarea) return () => {}

  // Track active paste to allow cancellation
  let cancelActivePaste: (() => void) | null = null

  const handlePaste = (event: ClipboardEvent) => {
    const text = event.clipboardData?.getData("text/plain")
    if (!text) return

    event.preventDefault()
    event.stopImmediatePropagation()

    // Cancel any in-flight chunked paste
    cancelActivePaste?.()
    cancelActivePaste = null

    // Constants for chunking
    const MAX_SYNC_PASTE_CHARS = 16_384
    const CHUNK_CHARS = 4096
    const CHUNK_DELAY_MS = 5

    if (!options.onWrite) {
      // Fallback to xterm's built-in paste (handles bracketed paste internally)
      if (text.length <= MAX_SYNC_PASTE_CHARS) {
        xterm.paste(text)
        return
      }

      // Chunk large pastes through xterm.paste()
      let cancelled = false
      let offset = 0

      const pasteNext = () => {
        if (cancelled) return
        const chunk = text.slice(offset, offset + CHUNK_CHARS)
        offset += CHUNK_CHARS
        xterm.paste(chunk)
        if (offset < text.length) {
          setTimeout(pasteNext, CHUNK_DELAY_MS)
        }
      }

      cancelActivePaste = () => {
        cancelled = true
      }
      pasteNext()
      return
    }

    // Normalize newlines for direct write
    const prepared = text.replace(/\r?\n/g, "\r")
    const bracketed = options.isBracketedPasteEnabled?.() ?? false

    // For small/medium pastes, use fast path
    if (prepared.length <= MAX_SYNC_PASTE_CHARS) {
      if (bracketed) {
        options.onWrite(`\x1b[200~${prepared}\x1b[201~`)
      } else {
        options.onWrite(prepared)
      }
      return
    }

    // Chunk large pastes to prevent PTY pipeline overflow
    let cancelled = false
    let offset = 0

    const pasteNext = () => {
      if (cancelled) return
      const chunk = prepared.slice(offset, offset + CHUNK_CHARS)
      offset += CHUNK_CHARS

      if (bracketed) {
        // Wrap each chunk to avoid long-running open bracketed paste blocks
        options.onWrite?.(`\x1b[200~${chunk}\x1b[201~`)
      } else {
        options.onWrite?.(chunk)
      }

      if (offset < prepared.length) {
        setTimeout(pasteNext, CHUNK_DELAY_MS)
      }
    }

    cancelActivePaste = () => {
      cancelled = true
    }
    pasteNext()
  }

  textarea.addEventListener("paste", handlePaste, { capture: true })
  return () => {
    cancelActivePaste?.()
    cancelActivePaste = null
    textarea.removeEventListener("paste", handlePaste, { capture: true })
  }
}

// ============================================================================
// Copy Handler (Trim Whitespace)
// ============================================================================

export function setupCopyHandler(xterm: XTerm): () => void {
  const element = xterm.element
  if (!element) return () => {}

  const handleCopy = (event: ClipboardEvent) => {
    const selection = xterm.getSelection()
    if (!selection) return

    // Trim trailing whitespace from each line
    const trimmed = selection
      .split("\n")
      .map((line) => line.trimEnd())
      .join("\n")
    event.preventDefault()
    event.clipboardData?.setData("text/plain", trimmed)
  }

  element.addEventListener("copy", handleCopy)
  return () => element.removeEventListener("copy", handleCopy)
}

// ============================================================================
// Resize Handler
// ============================================================================

export function setupResizeHandlers(
  container: HTMLDivElement,
  xterm: XTerm,
  fitAddon: FitAddon,
  onResize: (cols: number, rows: number) => void,
): () => void {
  const suspended = () => typeof document !== "undefined" && document.documentElement.dataset.terminalResizeSuspended === "1"

  let resizeTimer: ReturnType<typeof setTimeout> | undefined
  let raf = 0
  let lastFit = 0
  let lastCols = xterm.cols
  let lastRows = xterm.rows
  let w = 0
  let h = 0
  let pending = false

  const run = (force?: boolean) => {
    if (suspended()) return
    const now = performance.now()
    if (!force && now - lastFit < 50) return
    lastFit = now
    pending = false

    // Skip resize if container has no dimensions (hidden or transitioning)
    if (!w || !h) {
      w = container.clientWidth
      h = container.clientHeight
    }
    if (w < 10 || h < 10) return

    const buffer = xterm.buffer.active
    const wasAtBottom = buffer.viewportY >= buffer.baseY

    try {
      fitAddon.fit()
    } catch {
      // fit() can throw if terminal is disposed
      return
    }

    try {
      xterm.refresh(0, xterm.rows - 1)
    } catch {}

    // Only notify if dimensions actually changed
    if (xterm.cols !== lastCols || xterm.rows !== lastRows) {
      lastCols = xterm.cols
      lastRows = xterm.rows
      onResize(xterm.cols, xterm.rows)
    }

    if (wasAtBottom) {
      requestAnimationFrame(() => scrollToBottom(xterm))
    }
  }

  const schedule = () => {
    if (suspended()) {
      pending = true
      return
    }
    pending = true
    if (resizeTimer) clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => {
      if (!pending) return
      run(true)
    }, RESIZE_DEBOUNCE_MS)
    if (raf) return
    raf = requestAnimationFrame(() => {
      raf = 0
      run()
    })
  }

  const handleResize = () => {
    if (suspended()) {
      pending = true
      return
    }
    w = container.clientWidth
    h = container.clientHeight
    schedule()
  }

  const resizeObserver = new ResizeObserver((entries) => {
    if (!container.isConnected) return
    const r = entries[0]?.contentRect
    if (r) {
      w = r.width
      h = r.height
    } else {
      w = container.clientWidth
      h = container.clientHeight
    }
    schedule()
  })
  resizeObserver.observe(container)
  window.addEventListener("resize", handleResize)
  const handleFit = () => schedule()
  window.addEventListener("opencode:terminal-fit", handleFit)

  return () => {
    window.removeEventListener("resize", handleResize)
    window.removeEventListener("opencode:terminal-fit", handleFit)
    resizeObserver.disconnect()
    if (resizeTimer) clearTimeout(resizeTimer)
    if (raf) cancelAnimationFrame(raf)
  }
}
