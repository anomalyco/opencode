import type { Ghostty, Terminal as Term, FitAddon as GhosttyFitAddon } from "ghostty-web"
import { SerializeAddon } from "@/addons/serialize"
import { disposeIfDisposable, setOptionIfSupported } from "@/utils/runtime-adapters"
import { createModeScanner } from "../mode-scan"
import { createQuerySuppressor } from "../query-suppression"
import { createResizeCoordinator } from "../resize-coordinator"
import { MIN_CONTAINER_PX } from "../config"
import { detectLinks, detectFallbackLinks, getCurrentOS, removeLinkSuffix, decodeUrlEncodedPath } from "../link-parsing"
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

// Platform detection (module-level for reuse)
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || "")

// --------------------------------------------------------------------------
// Link-provider helpers (shared between file-path and fallback providers)
// --------------------------------------------------------------------------
const IGNORED_PATH_RE =
  /(^|[\\/])(?:node_modules|\.git|\.next|dist|build|coverage|out|vendor|target|__pycache__|\.turbo|\.cache|\.pytest_cache|\.mypy_cache|\.ruff_cache|\.venv)([\\/]|$)/

function shouldSkipPath(p: string): boolean {
  if (p === "/dev/null" || p.startsWith("/dev/fd/")) return true
  if (/^--?[a-zA-Z0-9][a-zA-Z0-9_-]*(?:=|$)/.test(p)) return true
  if (/[*?[\]]/.test(p)) return true
  if (p.startsWith("node:")) return true
  return IGNORED_PATH_RE.test(p)
}

function isExplicitPath(p: string): boolean {
  return /^(?:file:\/\/\/|~\/|\.{1,2}\/|\/|\\\\|[a-zA-Z]:[\\/])/.test(p)
}

function hasDotBasename(p: string): boolean {
  const base = p.split(/[\\/]/).pop() ?? ""
  if (!base.includes(".")) return false
  const i = base.lastIndexOf(".")
  if (i === -1 || i === base.length - 1) return false
  return /[a-zA-Z]/.test(base.slice(i + 1))
}

function isUrlContext(p: string, start: number, text: string): boolean {
  if (/^(?:https?|ftp):\/\//.test(p)) return true
  if (start >= 1) {
    const ctx = text.substring(Math.max(0, start - 10), start + 1)
    if (/https?:\/\//.test(ctx) || /ftp:\/\//.test(ctx)) return true
  }
  return false
}

function trimUnbalancedParens(url: string): string {
  let openCount = 0
  let endIndex = url.length
  for (let i = 0; i < url.length; i++) {
    if (url[i] === "(") openCount++
    else if (url[i] === ")") {
      if (openCount > 0) openCount--
      else { endIndex = i; break }
    }
  }
  let result = url.slice(0, endIndex)
  while (result.endsWith("(")) result = result.slice(0, -1)
  return result
}

// ==========================================================================
// Backend factory
// ==========================================================================

export const createBackend: CreateBackendFn = async (
  container: HTMLDivElement,
  options: TerminalBackendOptions,
): Promise<TerminalBackend> => {
  const debug = typeof localStorage !== "undefined" && !!localStorage.getItem("opencode.debug.terminal")
  if (debug) {
    // eslint-disable-next-line no-console
    console.log("[terminal:backend]", "ghostty", {
      width: container.clientWidth,
      height: container.clientHeight,
      hasSplitVertical: !!options.onSplitVertical,
      hasSplitHorizontal: !!options.onSplitHorizontal,
    })
  }
  const loaded = await loadGhostty()
  const mod = loaded.mod
  const g = loaded.ghostty

  const cleanups: VoidFunction[] = []
  const mode = createModeScanner()
  const suppress = createQuerySuppressor()

  // Step 10 + Step 6: cursorBlink starts false; toggled by focus/blur listeners
  const t = new mod.Terminal({
    cursorBlink: false,
    cursorStyle: "bar",
    fontSize: 14,
    fontFamily: options.fontFamily,
    allowTransparency: false,
    convertEol: true,
    theme: options.theme,
    scrollback: 10_000,
    ghostty: g,
  })
  cleanups.push(() => t.dispose())

  // --------------------------------------------------------------------------
  // Step 1: Managed listener arrays + handleWrite
  // --------------------------------------------------------------------------
  let dataListeners: Array<(data: string) => void> = []
  let keyListeners: Array<(e: { key: string }) => void> = []
  let resizeListeners: Array<(size: { cols: number; rows: number }) => void> = []

  const handleWrite = (data: string) => {
    for (const fn of dataListeners) fn(data)
  }

  // --------------------------------------------------------------------------
  // Step 5: Copy with trailing-whitespace trimming
  // --------------------------------------------------------------------------
  const copy = () => {
    const selection = t.getSelection()
    if (!selection) return false

    const trimmed = selection.split("\n").map((l: string) => l.trimEnd()).join("\n")

    const body = document.body
    if (body) {
      const ta = document.createElement("textarea")
      ta.value = trimmed
      ta.setAttribute("readonly", "")
      ta.style.position = "fixed"
      ta.style.opacity = "0"
      body.appendChild(ta)
      ta.select()
      const ok = document.execCommand("copy")
      body.removeChild(ta)
      if (ok) return true
    }

    const clipboard = navigator.clipboard
    if (clipboard?.writeText) {
      clipboard.writeText(trimmed).catch(() => {})
      return true
    }
    return false
  }

  // --------------------------------------------------------------------------
  // Step 3: Keyboard shortcuts
  //
  // CRITICAL: ghostty-web convention is INVERTED from xterm:
  //   return true  = "I handled it" -> ghostty calls preventDefault, stops
  //   return false = "I didn't handle it" -> ghostty continues processing
  // --------------------------------------------------------------------------
  const actionMod = (e: KeyboardEvent) => (isMac ? e.metaKey : e.ctrlKey)

  t.attachCustomKeyEventHandler((event: KeyboardEvent) => {
    const key = event.key.toLowerCase()

    // Shift+Enter: line continuation (ESC + CR)
    if (key === "enter" && event.shiftKey && !event.metaKey && !event.ctrlKey) {
      if (event.type === "keydown") handleWrite("\x1b\r")
      return true
    }

    // Cmd/Ctrl+Backspace: clear line (Ctrl+U + left)
    if (key === "backspace" && actionMod(event)) {
      if (event.type === "keydown") handleWrite("\x15\x1b[D")
      return true
    }

    // Cmd/Ctrl+Left: beginning of line (Ctrl+A)
    if (key === "arrowleft" && actionMod(event)) {
      if (event.type === "keydown") handleWrite("\x01")
      return true
    }

    // Cmd/Ctrl+Right: end of line (Ctrl+E)
    if (key === "arrowright" && actionMod(event)) {
      if (event.type === "keydown") handleWrite("\x05")
      return true
    }

    // Ctrl+Shift+C: copy
    if (event.ctrlKey && event.shiftKey && !event.metaKey && key === "c") {
      if (event.type === "keydown") copy()
      return true
    }

    // Cmd+C: copy if selection exists, else pass through for SIGINT
    if (event.metaKey && !event.ctrlKey && !event.altKey && key === "c") {
      if (!t.hasSelection()) return false
      if (event.type === "keydown") copy()
      return true
    }

    // Cmd+D: split vertical (FIX: return true to block ghostty)
    if (event.metaKey && !event.shiftKey && !event.ctrlKey && !event.altKey && key === "d") {
      if (event.type === "keydown" && options.onSplitVertical) {
        event.preventDefault()
        event.stopPropagation()
        options.onSplitVertical()
      }
      return true
    }

    // Cmd+Shift+D: split horizontal (FIX: return true to block ghostty)
    if (event.metaKey && event.shiftKey && !event.ctrlKey && !event.altKey && key === "d") {
      if (event.type === "keydown" && options.onSplitHorizontal) {
        event.preventDefault()
        event.stopPropagation()
        options.onSplitHorizontal()
      }
      return true
    }

    // Ctrl+`: block ghostty so event propagates to parent app toggle
    if (event.ctrlKey && key === "`") {
      return true
    }

    // Default: let ghostty handle
    return false
  })

  // --------------------------------------------------------------------------
  // Addons
  // --------------------------------------------------------------------------
  const fit = new mod.FitAddon()
  const serializeAddon = new SerializeAddon()
  cleanups.push(() => disposeIfDisposable(fit))
  t.loadAddon(serializeAddon)
  t.loadAddon(fit)

  t.open(container)

  // Wire native onData into managed listeners
  const nativeOnData = t.onData((data: string) => {
    for (const fn of dataListeners) fn(data)
  })
  cleanups.push(() => disposeIfDisposable(nativeOnData))

  // Wire native onKey into managed listeners
  const nativeOnKey = t.onKey((e: { key: string }) => {
    for (const fn of keyListeners) fn({ key: e.key })
  })
  cleanups.push(() => disposeIfDisposable(nativeOnKey))

  // --------------------------------------------------------------------------
  // Step 4: Paste handler (capture-phase on textarea)
  // --------------------------------------------------------------------------
  const textarea = t.textarea
  if (textarea) {
    let cancelActivePaste: (() => void) | null = null
    const MAX_SYNC = 16_384
    const CHUNK = 4096
    const CHUNK_MS = 5

    const handlePaste = (event: ClipboardEvent) => {
      const text = event.clipboardData?.getData("text/plain")
      if (!text) return

      event.preventDefault()
      event.stopImmediatePropagation()

      cancelActivePaste?.()
      cancelActivePaste = null

      const prepared = text.replace(/\r?\n/g, "\r")
      const bracketed = mode.bracketed()

      if (prepared.length <= MAX_SYNC) {
        handleWrite(bracketed ? `\x1b[200~${prepared}\x1b[201~` : prepared)
        return
      }

      // Chunked paste for large payloads
      let cancelled = false
      let offset = 0

      const pasteNext = () => {
        if (cancelled) return
        const chunk = prepared.slice(offset, offset + CHUNK)
        offset += CHUNK
        handleWrite(bracketed ? `\x1b[200~${chunk}\x1b[201~` : chunk)
        if (offset < prepared.length) setTimeout(pasteNext, CHUNK_MS)
      }

      cancelActivePaste = () => { cancelled = true }
      pasteNext()
    }

    textarea.addEventListener("paste", handlePaste, { capture: true })
    cleanups.push(() => {
      cancelActivePaste?.()
      cancelActivePaste = null
      textarea.removeEventListener("paste", handlePaste, { capture: true })
    })
  }

  // --------------------------------------------------------------------------
  // Step 5 (cont.): Copy event handler — trim trailing whitespace
  // --------------------------------------------------------------------------
  const element = t.element
  if (element) {
    const handleCopy = (event: ClipboardEvent) => {
      const selection = t.getSelection()
      if (!selection) return
      const trimmed = selection.split("\n").map((l: string) => l.trimEnd()).join("\n")
      event.preventDefault()
      event.clipboardData?.setData("text/plain", trimmed)
    }
    element.addEventListener("copy", handleCopy)
    cleanups.push(() => element.removeEventListener("copy", handleCopy))
  }

  // --------------------------------------------------------------------------
  // Step 6: Focus/blur cursor blink toggle
  // --------------------------------------------------------------------------
  if (textarea) {
    const onFocus = () => { t.options.cursorBlink = true }
    const onBlur = () => { t.options.cursorBlink = false }
    textarea.addEventListener("focus", onFocus)
    textarea.addEventListener("blur", onBlur)
    cleanups.push(() => {
      textarea.removeEventListener("focus", onFocus)
      textarea.removeEventListener("blur", onBlur)
    })
  }

  // --------------------------------------------------------------------------
  // Step 7: Wheel/scroll handler
  //
  // Convention: return true = "I handled it" (skip ghostty), false = pass.
  // Note: ghostty-web already calls preventDefault+stopPropagation on all
  // wheel events before our handler runs; we only control whether ghostty's
  // own scroll logic proceeds.
  // --------------------------------------------------------------------------
  {
    let acc = 0
    const stepPx = 40
    const maxBurst = 12

    const arrowSeq = (dir: 1 | -1) => {
      const app = mode.modes().applicationCursorKeys
      return dir < 0 ? (app ? "\x1bOA" : "\x1b[A") : (app ? "\x1bOB" : "\x1b[B")
    }
    const pageSeq = (dir: 1 | -1) => (dir < 0 ? "\x1b[5~" : "\x1b[6~")

    t.attachCustomWheelEventHandler((event: WheelEvent) => {
      const m = mode.modes()

      // Normal mode (not alt-screen, not 1007) → ghostty handles scrollback
      if (!m.alternateScroll && !m.alternateScreen) return false

      // Mouse tracking active → ghostty handles SGR mouse wheel
      if (
        m.mouseTrackingX10 || m.mouseTrackingNormal || m.mouseTrackingHighlight ||
        m.mouseTrackingButtonEvent || m.mouseTrackingAnyEvent || m.mouseUtf8 || m.mouseSgr
      ) return false

      const dy = event.deltaY
      if (!Number.isFinite(dy) || dy === 0) return true

      const unit = event.deltaMode === 1 ? 12 : event.deltaMode === 2 ? 96 : 1
      acc += dy * unit

      const count = Math.min(maxBurst, Math.floor(Math.abs(acc) / stepPx))
      if (count <= 0) return true

      const dir = (acc < 0 ? -1 : 1) as 1 | -1
      acc -= dir * count * stepPx

      if (m.alternateScroll) {
        // DECSET 1007: arrow keys with application-cursor awareness
        handleWrite(arrowSeq(dir).repeat(count))
        return true
      }

      // Alt-screen fallback: PageUp/PageDown (capped at 6)
      handleWrite(pageSeq(dir).repeat(Math.min(6, count)))
      return true
    })
  }

  // --------------------------------------------------------------------------
  // Step 8: Resize coordinator (replaces fit.observeResize + naive handlers)
  // --------------------------------------------------------------------------
  const coordinator = createResizeCoordinator({
    fit: () => { try { fit.fit() } catch {} },
    measure: () => ({ width: container.clientWidth, height: container.clientHeight }),
    getCols: () => t.cols,
    getRows: () => t.rows,
    refresh: () => {
      // ghostty-web repaints internally — no-op
    },
    clear: () => {
      // Clear visible screen in alt-screen to prevent TUI duplication after resize
      try {
        if (!mode.modes().alternateScreen) return
        t.write("\x1b[0m\x1b[H\x1b[2J")
      } catch {}
    },
    notify: (cols, rows) => {
      for (const fn of resizeListeners) fn({ cols, rows })
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

  // Suspension flag (set by SplitDragHandle during resize drags)
  const isSuspended = () =>
    typeof document !== "undefined" && document.documentElement.dataset.terminalResizeSuspended === "1"

  let wasSuspended = isSuspended()

  const checkSuspension = () => {
    const now = isSuspended()
    if (now && !wasSuspended) coordinator.suspend()
    else if (!now && wasSuspended) coordinator.resume()
    wasSuspended = now
  }

  // ResizeObserver with 0→visible transition detection
  let lastObsW = 0
  let lastObsH = 0

  const resizeObserver = new ResizeObserver((entries) => {
    if (!container.isConnected) return
    const entry = entries[0]
    const w = entry?.contentRect?.width ?? container.clientWidth
    const h = entry?.contentRect?.height ?? container.clientHeight

    // Container just became visible — nudge fontSize to force cell re-measurement
    if (lastObsW === 0 && lastObsH === 0 && w > 0 && h > 0) {
      const fs = t.options.fontSize ?? 14
      t.options.fontSize = fs + 0.001
      t.options.fontSize = fs
    }
    lastObsW = w
    lastObsH = h
    checkSuspension()
    coordinator.request("resize-observer")
  })
  resizeObserver.observe(container)

  const handleResize = () => { checkSuspension(); coordinator.request("window-resize") }
  window.addEventListener("resize", handleResize)

  const handleFit = () => { checkSuspension(); coordinator.request("fit-event") }
  window.addEventListener("opencode:terminal-fit", handleFit)

  const handleVisibility = () => { if (!document.hidden) coordinator.request("visibility") }
  document.addEventListener("visibilitychange", handleVisibility)

  // Mount fits (portal mount can report 0px initially)
  requestAnimationFrame(() => coordinator.request("mount"))
  const mountTimer = setTimeout(() => coordinator.request("mount"), 50)
  const mountLateTimer = setTimeout(() => coordinator.request("mount"), 250)

  // Safety-net polling: 200ms for 3s (10 attempts)
  let retryCount = 0
  const retryTimer = setInterval(() => {
    retryCount++
    if (retryCount >= 10) { clearInterval(retryTimer); return }
    if (container.clientWidth < MIN_CONTAINER_PX) return
    const proposed = fit.proposeDimensions()
    if (!proposed) return
    if (proposed.cols !== t.cols || proposed.rows !== t.rows) {
      coordinator.request("retry-fit")
    } else {
      clearInterval(retryTimer)
    }
  }, 200)

  // Initial fit
  try { fit.fit() } catch {}

  cleanups.push(() => {
    window.removeEventListener("resize", handleResize)
    window.removeEventListener("opencode:terminal-fit", handleFit)
    document.removeEventListener("visibilitychange", handleVisibility)
    resizeObserver.disconnect()
    clearTimeout(mountTimer)
    clearTimeout(mountLateTimer)
    clearInterval(retryTimer)
    coordinator.dispose()
  })

  // --------------------------------------------------------------------------
  // Step 9: Link providers via registerLinkProvider
  // --------------------------------------------------------------------------

  // File-path link provider
  if (options.onFileLinkClick) {
    const onFileClick = options.onFileLinkClick
    t.registerLinkProvider({
      provideLinks(y: number, callback: (links: any[] | undefined) => void) {
        const line = t.buffer.active.getLine(y)
        if (!line) { callback(undefined); return }

        const lineText = line.translateToString(true)
        const os = getCurrentOS()
        const detected = detectLinks(lineText, os)
        const links: any[] = []

        for (const parsed of detected) {
          const pathText = parsed.path.text
          if (isUrlContext(pathText, parsed.path.index, lineText)) continue
          if (shouldSkipPath(pathText)) continue
          if (/^v?\d+\.\d+(\.\d+)*$/.test(pathText)) continue
          if (/^\d+(:\d+)*$/.test(pathText)) continue
          if (/^\d+(?:\/\d+)+$/.test(pathText)) continue
          if (!isExplicitPath(pathText) && !hasDotBasename(pathText)) continue

          const linkStart = parsed.prefix?.index ?? parsed.path.index
          const linkEnd = parsed.suffix
            ? parsed.suffix.suffix.index + parsed.suffix.suffix.text.length
            : parsed.path.index + parsed.path.text.length

          links.push({
            text: lineText.substring(linkStart, linkEnd),
            range: { start: { x: linkStart, y }, end: { x: linkEnd, y } },
            activate(event: MouseEvent) {
              if (!event.metaKey && !event.ctrlKey) return
              event.preventDefault()
              let cleanPath = removeLinkSuffix(pathText)
              if (!cleanPath) return
              cleanPath = decodeUrlEncodedPath(cleanPath)
              onFileClick(cleanPath, parsed.suffix?.row, parsed.suffix?.col)
            },
          })
        }

        // Fallback matchers (Python tracebacks, Rust errors, etc.)
        if (links.length === 0) {
          for (const fb of detectFallbackLinks(lineText)) {
            if (shouldSkipPath(fb.path)) continue
            if (!isExplicitPath(fb.path) && !hasDotBasename(fb.path)) continue
            links.push({
              text: fb.link,
              range: { start: { x: fb.index, y }, end: { x: fb.index + fb.link.length, y } },
              activate(event: MouseEvent) {
                if (!event.metaKey && !event.ctrlKey) return
                event.preventDefault()
                const cleanPath = decodeUrlEncodedPath(fb.path)
                if (cleanPath) onFileClick(cleanPath, fb.line, fb.col)
              },
            })
          }
        }

        callback(links.length > 0 ? links : undefined)
      },
    })
  }

  // URL link provider
  {
    const URL_RE = /\bhttps?:\/\/[^\s<>[\]'"]+/g
    const TRAILING_PUNCT = /[.,;:!?]+$/

    t.registerLinkProvider({
      provideLinks(y: number, callback: (links: any[] | undefined) => void) {
        const line = t.buffer.active.getLine(y)
        if (!line) { callback(undefined); return }

        const lineText = line.translateToString(true)
        const links: any[] = []
        const re = new RegExp(URL_RE.source, "g")

        for (const match of lineText.matchAll(re)) {
          let text = match[0]
          const idx = match.index ?? 0
          text = trimUnbalancedParens(text)
          text = text.replace(TRAILING_PUNCT, "")
          const end = idx + text.length

          const activateText = text
          links.push({
            text,
            range: { start: { x: idx, y }, end: { x: end, y } },
            activate(event: MouseEvent) {
              if (!event.metaKey && !event.ctrlKey) return
              event.preventDefault()
              if (options.onUrlClick) options.onUrlClick(event, activateText)
              else window.open(activateText, "_blank")
            },
          })
        }

        callback(links.length > 0 ? links : undefined)
      },
    })
  }

  // --------------------------------------------------------------------------
  // Backend object
  // --------------------------------------------------------------------------
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

    // Step 2: Query suppression in write path
    write(data: string, callback?: () => void) {
      const filtered = suppress.scan(data)
      mode.scan(filtered)
      if (!filtered) {
        callback?.()
        return
      }
      if (callback) {
        t.write(filtered, callback)
      } else {
        t.write(filtered)
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
      const buffer = (t as any).buffer?.active
      if (buffer) return buffer.viewportY >= buffer.baseY
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
      coordinator.flush()
    },

    serialize() {
      return serializeAddon.serialize()
    },

    rehydrateSequences() {
      return mode.rehydrateSequences()
    },

    isAltScreen() {
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
