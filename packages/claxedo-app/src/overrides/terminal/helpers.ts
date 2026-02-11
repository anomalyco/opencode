import { Terminal as XTerm } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import { ClipboardAddon } from "@xterm/addon-clipboard"
import { Unicode11Addon } from "@xterm/addon-unicode11"
import { ImageAddon } from "@xterm/addon-image"
import { WebglAddon } from "@xterm/addon-webgl"
import { WebLinksAddon } from "@xterm/addon-web-links"
import { TERMINAL_OPTIONS, MIN_CONTAINER_PX } from "./config"
import { createResizeCoordinator, type ResizeCoordinator } from "./resize-coordinator"
import type { ITheme } from "@xterm/xterm"

function terminalDebugLevel() {
  if (typeof localStorage === "undefined") return 0
  try {
    const raw = localStorage.getItem("opencode.debug.terminal")
    if (!raw) return 0
    if (raw === "true") return 1
    if (raw === "false") return 0
    const n = Number(raw)
    if (!Number.isFinite(n)) return 1
    return n
  } catch {
    return 0
  }
}

function fitDebug() {
  return terminalDebugLevel() >= 2
}

function flog(...args: unknown[]) {
  if (!fitDebug()) return
  // eslint-disable-next-line no-console
  console.log("[terminal:fit]", ...args)
}

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
    kind: "webgl" | "dom"
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
  try {
    const webgl = new WebglAddon()
    webgl.onContextLoss(() => {
      webgl.dispose()
      // Fall back to DOM renderer on context loss
      xterm.refresh(0, xterm.rows - 1)
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
    return { kind: "dom", dispose: () => {} }
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

  flog("open", {
    clientWidth: container.clientWidth,
    clientHeight: container.clientHeight,
  })
  xterm.open(container)

  // Load non-renderer addons immediately
  xterm.loadAddon(fitAddon)
  xterm.loadAddon(clipboardAddon)
  xterm.loadAddon(unicode11Addon)
  xterm.loadAddon(imageAddon)
  xterm.loadAddon(webLinksAddon)

  // Defer GPU renderer to next animation frame (avoids race condition).
  // After loading, fit immediately with the new cell metrics (GPU renderers
  // measure differently than DOM). Then dispatch an event so the coordinator
  // updates its lastCols/lastRows tracking and fires notify/clear if needed.
  rafId = requestAnimationFrame(() => {
    rafId = null
    if (isDisposed) return
    rendererRef.current = loadRenderer(xterm)
    // Fit immediately after renderer loads — this is the fast path that sizes
    // the terminal correctly on the first frame. The coordinator event below
    // handles the bookkeeping (lastCols/lastRows, notify, clear).
    try {
      fitAddon.fit()
    } catch {}
    try {
      xterm.refresh(0, xterm.rows - 1)
    } catch {}
    flog("renderer-ready", {
      renderer: rendererRef.current.kind,
      cols: xterm.cols,
      rows: xterm.rows,
      proposed: (() => {
        try {
          return fitAddon.proposeDimensions()
        } catch {
          return undefined
        }
      })(),
    })
    window.dispatchEvent(new Event("opencode:terminal-fit"))
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
  try {
    fitAddon.fit()
  } catch {
    // Container may be 0x0 on portal mount — coordinator + retry loop handle sizing later
  }
  flog("initial-fit", {
    cols: xterm.cols,
    rows: xterm.rows,
    proposed: (() => {
      try {
        return fitAddon.proposeDimensions()
      } catch {
        return undefined
      }
    })(),
  })

  // Re-trigger fit after fonts are ready. If the initial fit ran before fonts
  // loaded, xterm's cell dimensions may be 0 (proposeDimensions() returns
  // undefined) or measured against a fallback font. Either way the terminal
  // stays at the default 80×24. Dispatching the fit event after fonts.ready
  // lets the resize coordinator re-fit with accurate cell metrics.
  if (typeof document !== "undefined" && document.fonts) {
    document.fonts.ready.then(() => {
      if (isDisposed) return
      flog("fonts-ready", {
        cols: xterm.cols,
        rows: xterm.rows,
        proposed: (() => {
          try {
            return fitAddon.proposeDimensions()
          } catch {
            return undefined
          }
        })(),
      })
      window.dispatchEvent(new Event("opencode:terminal-fit"))
    })
  }

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
    const key = event.key.toLowerCase()

    // Shift+Enter: Send ESC+CR for line continuation
    if (key === "enter" && event.shiftKey && !event.metaKey && !event.ctrlKey) {
      if (event.type === "keydown" && options.onShiftEnter) {
        options.onShiftEnter()
      }
      return false
    }

    // Cmd+Backspace: Clear line (Ctrl+U + left arrow)
    if (key === "backspace" && event.metaKey) {
      if (event.type === "keydown" && options.onWrite) {
        options.onWrite("\x15\x1b[D")
      }
      return false
    }

    // Cmd+Left: Beginning of line (Ctrl+A)
    if (key === "arrowleft" && event.metaKey) {
      if (event.type === "keydown" && options.onWrite) {
        options.onWrite("\x01")
      }
      return false
    }

    // Cmd+Right: End of line (Ctrl+E)
    if (key === "arrowright" && event.metaKey) {
      if (event.type === "keydown" && options.onWrite) {
        options.onWrite("\x05")
      }
      return false
    }

    // Cmd+D: Split vertical (left/right)
    if (key === "d" && event.metaKey && !event.shiftKey && !event.ctrlKey && !event.altKey) {
      if (event.type === "keydown" && options.onSplitVertical) {
        event.preventDefault()
        event.stopPropagation()
        options.onSplitVertical()
      }
      return false
    }

    // Cmd+Shift+D: Split horizontal (top/bottom)
    if (key === "d" && event.metaKey && event.shiftKey && !event.ctrlKey && !event.altKey) {
      if (event.type === "keydown" && options.onSplitHorizontal) {
        event.preventDefault()
        event.stopPropagation()
        options.onSplitHorizontal()
      }
      return false
    }

    // Allow Ctrl+` for parent app toggle
    if (event.ctrlKey && key === "`") {
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

export interface ResizeHandlersResult {
  coordinator: ResizeCoordinator
  cleanup: () => void
}

export function setupResizeHandlers(
  container: HTMLDivElement,
  xterm: XTerm,
  fitAddon: FitAddon,
  onResize: (cols: number, rows: number) => void,
  renderer?: TerminalRendererRef,
): ResizeHandlersResult {
  const snapshot = () => ({
    clientWidth: Math.round(container.clientWidth),
    clientHeight: Math.round(container.clientHeight),
    cols: xterm.cols,
    rows: xterm.rows,
    proposed: (() => {
      try {
        return fitAddon.proposeDimensions()
      } catch {
        return undefined
      }
    })(),
  })
  const coordinator = createResizeCoordinator({
    fit: () => {
      // proposeDimensions() accesses RenderService.dimensions internally.
      // If the renderer isn't ready yet, it throws — guard here to prevent
      // fit() from triggering internal xterm Viewport.syncScrollArea errors.
      try {
        const dims = fitAddon.proposeDimensions()
        if (!dims) return
      } catch { return }
      fitAddon.fit()
    },
    measure: () => ({ width: container.clientWidth, height: container.clientHeight }),
    getCols: () => xterm.cols,
    getRows: () => xterm.rows,
    refresh: () => {
      try { xterm.refresh(0, xterm.rows - 1) } catch {}
      try { renderer?.current.clearTextureAtlas?.() } catch {}
    },
    notify: (cols, rows) => {
      flog("coordinator-notify", {
        cols,
        rows,
        snapshot: snapshot(),
      })
      onResize(cols, rows)
    },
    clock: {
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms) as unknown as number,
      clearTimeout: (id: number) => clearTimeout(id),
    },
    raf: {
      request: (fn: () => void) => requestAnimationFrame(fn),
      cancel: (id: number) => cancelAnimationFrame(id),
    },
  })

  // Check global suspension flag
  const isSuspended = () =>
    typeof document !== "undefined" && document.documentElement.dataset.terminalResizeSuspended === "1"

  let wasSuspended = isSuspended()

  const checkSuspension = () => {
    const nowSuspended = isSuspended()
    if (nowSuspended && !wasSuspended) {
      coordinator.suspend()
    } else if (!nowSuspended && wasSuspended) {
      coordinator.resume()
    }
    wasSuspended = nowSuspended
  }

  const handleResize = () => {
    flog("window-resize", snapshot())
    checkSuspension()
    coordinator.request("window-resize")
  }

  // Track container visibility transitions. When the container goes from
  // 0x0 to non-zero (e.g., tab switch from display:none), xterm's cached
  // cell dimensions may be 0 from the initial open(). Nudge fontSize to
  // force xterm to re-measure cells so fitAddon.fit() can work.
  let lastObservedWidth = 0
  let lastObservedHeight = 0

  const resizeObserver = new ResizeObserver((entries) => {
    if (!container.isConnected) return

    const entry = entries[0]
    const width = entry?.contentRect?.width ?? container.clientWidth
    const height = entry?.contentRect?.height ?? container.clientHeight

    if (lastObservedWidth === 0 && lastObservedHeight === 0 && width > 0 && height > 0) {
      // Container just became visible — force cell re-measurement
      const fs = xterm.options.fontSize ?? 14
      xterm.options.fontSize = fs + 0.001
      xterm.options.fontSize = fs
    }

    lastObservedWidth = width
    lastObservedHeight = height

    checkSuspension()
    flog("resize-observer", { width, height, snapshot: snapshot() })
    coordinator.request("resize-observer")
  })
  resizeObserver.observe(container)
  window.addEventListener("resize", handleResize)

  const handleFit = () => {
    flog("fit-event", snapshot())
    checkSuspension()
    coordinator.request("fit-event")
  }
  window.addEventListener("opencode:terminal-fit", handleFit)

  // Visibility change: request fit when tab becomes visible
  const handleVisibilityChange = () => {
    if (document.hidden) return
    flog("visibility", snapshot())
    coordinator.request("visibility")
  }
  document.addEventListener("visibilitychange", handleVisibilityChange)

  // Initial mount fits (tab/portal mount can report 0px initially)
  requestAnimationFrame(() => coordinator.request("mount"))
  const mountTimer = setTimeout(() => coordinator.request("mount"), 50)
  const mountLateTimer = setTimeout(() => coordinator.request("mount"), 250)
  flog("mount-scheduled", snapshot())

  // Safety net: poll for dimension mismatch for the first 3 seconds.
  // Handles the case where fitAddon.fit() was a no-op because cell dims were 0
  // (container was display:none or renderer hadn't measured font yet).
  let retryCount = 0
  const retryTimer = setInterval(() => {
    retryCount++
    if (retryCount >= 10) {
      clearInterval(retryTimer)
      return
    }
    if (container.clientWidth < MIN_CONTAINER_PX) return
    const proposed = fitAddon.proposeDimensions()
    if (!proposed) return
    flog("retry-fit", {
      retryCount,
      proposed,
      snapshot: snapshot(),
    })
    if (proposed.cols !== xterm.cols || proposed.rows !== xterm.rows) {
      coordinator.request("retry-fit")
    } else {
      // Dims match — terminal is correctly sized, stop polling
      flog("retry-fit-stable", { retryCount, snapshot: snapshot() })
      clearInterval(retryTimer)
    }
  }, 200)

  return {
    coordinator,
    cleanup: () => {
      window.removeEventListener("resize", handleResize)
      window.removeEventListener("opencode:terminal-fit", handleFit)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      resizeObserver.disconnect()
      clearTimeout(mountTimer)
      clearTimeout(mountLateTimer)
      clearInterval(retryTimer)
      coordinator.dispose()
    },
  }
}
