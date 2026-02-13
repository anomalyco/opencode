import type { TerminalBackend } from "../terminal/backend/types"
import { createBackend } from "#terminal-backend"
import { retry } from "../terminal/retry"
import { ComponentProps, createEffect, createSignal, onCleanup, onMount, splitProps } from "solid-js"
import { useSDK } from "@/context/sdk"
import { monoFontFamily, useSettings } from "@/context/settings"
import { LocalPTY } from "@/context/terminal"
import { usePlatform } from "@/context/platform"
import { resolveThemeVariant, useTheme, withAlpha, type HexColor } from "@opencode-ai/ui/theme"
import { useLanguage } from "@/context/language"
import { showToast } from "@opencode-ai/ui/toast"
import { markInitialCommandRan, shouldRunInitialCommand } from "./terminal-recovery"
import { preparePersistBuffer, prepareRestoreBuffer } from "./terminal-buffer"
import { hostStable, shouldRecoverDesync, shouldSendResize, sizeSane } from "./terminal-geometry"
import { sigwinchToggleSize, socketCloseIsError } from "./terminal-connection"
import { createTerminalRuntimeQueue } from "./terminal-runtime-queue"
import { cursorPlan, filterModeSequences, isLikelyTui, restoreSize } from "./terminal-tui"
import { stripTerminalRepliesFromInput } from "../terminal/input-reply-filter"

export interface TerminalProps extends ComponentProps<"div"> {
  pty: LocalPTY
  autoFocus?: boolean
  onSubmit?: () => void
  onCleanup?: (pty: LocalPTY) => void
  onUpdate?: (pty: Partial<LocalPTY> & { id: string }) => void
  onConnect?: () => void
  onConnectError?: (error: unknown) => void
  onSplitVertical?: () => void
  onSplitHorizontal?: () => void
  onFileLinkOpen?: (path: string, line?: number, col?: number) => void
}

type TerminalColors = {
  background: string
  foreground: string
  cursor: string
  selectionBackground: string
}

const DEFAULT_TERMINAL_COLORS: Record<"light" | "dark", TerminalColors> = {
  light: {
    background: "#fcfcfc",
    foreground: "#211e1e",
    cursor: "#211e1e",
    selectionBackground: withAlpha("#211e1e", 0.2),
  },
  dark: {
    background: "#191515",
    foreground: "#d4d4d4",
    cursor: "#d4d4d4",
    selectionBackground: withAlpha("#d4d4d4", 0.25),
  },
}

// Tuned for vtebench full profile (ramp stage 6: 1 MiB samples, max-secs=10,
// max-samples=200) so heavy TUI output can complete without early throttling.
// Baseline from stage 6 validation:
// dense_cells 11.55ms, medium_cells 10.72ms, scrolling 18.02ms,
// scrolling_bottom_region 17.95ms, scrolling_bottom_small_region 18.05ms,
// scrolling_fullscreen 23.53ms, scrolling_top_region 18.22ms,
// scrolling_top_small_region 18.04ms, sync_medium_cells 11.75ms, unicode 9.18ms.
const MAX_PENDING_BYTES = 128 * 1024 * 1024
const MAX_STREAM_BYTES = 128 * 1024 * 1024
const MAX_BATCH_BYTES = 4 * 1024 * 1024
const MAX_BATCH_ITEMS = 8192
const MAX_DROPPED_CHUNKS = 1_000_000
const OPEN_RESIZE_SETTLE_MS = 220

let mountCounter = 0

export const Terminal = (props: TerminalProps) => {
  const sdk = useSDK()
  const settings = useSettings()
  const theme = useTheme()
  const language = useLanguage()
  const platform = usePlatform()

  let container!: HTMLDivElement
  const [local, others] = splitProps(props, ["pty", "autoFocus", "class", "classList", "onConnect", "onConnectError"])

  let backend: TerminalBackend | undefined
  let disposed = false
  let isBufferRestored = !props.pty.buffer
  let msgCount = 0
  const hasBuffer = !!(props.pty.buffer && props.pty.buffer.length > 0)
  let cursor =
    typeof local.pty.cursor === "number" && Number.isSafeInteger(local.pty.cursor) ? local.pty.cursor : 0
  const mountId = ++mountCounter
  const resizeBySource: Record<string, number> = {}
  const stats = {
    resizeEvent: 0,
    resizeRejected: 0,
    resizePublishAttempt: 0,
    resizePublishSkip: 0,
    resizePublishAck: 0,
    textFrames: 0,
    textBytes: 0,
    metaFrames: 0,
    metaCursor: 0,
    metaInvalid: 0,
    binaryIgnored: 0,
    emptyFrames: 0,
    inputEvents: 0,
    inputBytes: 0,
    initialCheckTrue: 0,
    initialCheckFalse: 0,
    initialSent: 0,
  }

  // CLAXEDO PATCH: Instrumentation — frontend timing for terminal lifecycle
  const timing = {
    mountAt: 0,
    backendReadyAt: 0,
    socketConnectAt: 0,
    socketOpenAt: 0,
    firstTextByteAt: 0,
  }

  const cleanups: VoidFunction[] = []
  const debugLevel = () => {
    if (typeof localStorage === "undefined") return 0
    const raw = localStorage.getItem("opencode.debug.terminal")
    if (!raw) return 0
    if (raw === "true") return 1
    if (raw === "false") return 0
    const n = Number(raw)
    if (!Number.isFinite(n)) return 1
    return n
  }
  const debug = () => debugLevel() >= 1
  const verbose = () => debugLevel() >= 2
  const tlog = (...args: unknown[]) => {
    if (!debug()) return
    // eslint-disable-next-line no-console
    console.log("[terminal:ui]", ...args)
  }
  const tvlog = (...args: unknown[]) => {
    if (!verbose()) return
    // eslint-disable-next-line no-console
    console.log("[terminal:ui:verbose]", ...args)
  }
  const trace = (...args: unknown[]) => {
    if (!debug()) return
    tlog("trace", { mountId, ptyId: local.pty.id }, ...args)
  }
  const traceVerbose = (...args: unknown[]) => {
    if (!verbose()) return
    tvlog("trace", { mountId, ptyId: local.pty.id }, ...args)
  }
  const oneLine = (value: string) =>
    value
      .replaceAll("\r", "\\r")
      .replaceAll("\n", "\\n")
      .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "<esc>")
      .slice(0, 120)
  const trimTrailingLines = (value: string, count: number) => {
    let out = value
    let left = count
    while (left > 0) {
      const idx = Math.max(out.lastIndexOf("\n"), out.lastIndexOf("\r"))
      if (idx < 0) return ""
      out = out.slice(0, idx + 1)
      left -= 1
    }
    return out
  }
  const markResizeSource = (source: string) => {
    resizeBySource[source] = (resizeBySource[source] ?? 0) + 1
  }
  const num = (value: number) => Math.round(value * 10) / 10
  const host = () => {
    if (!container) return
    const rect = container.getBoundingClientRect()
    return {
      clientWidth: num(container.clientWidth),
      clientHeight: num(container.clientHeight),
      rectWidth: num(rect.width),
      rectHeight: num(rect.height),
      offsetWidth: num(container.offsetWidth),
      offsetHeight: num(container.offsetHeight),
      visible: container.getClientRects().length > 0,
    }
  }

  const cleanup = () => {
    if (!cleanups.length) return
    const fns = cleanups.splice(0).reverse()
    for (const fn of fns) {
      try {
        fn()
      } catch {
        // ignore
      }
    }
  }

  // Theme handling
  const getTerminalColors = (): TerminalColors => {
    const mode = theme.mode()
    const fallback = DEFAULT_TERMINAL_COLORS[mode]
    const currentTheme = theme.themes()[theme.themeId()]
    if (!currentTheme) return fallback
    const variant = mode === "dark" ? currentTheme.dark : currentTheme.light
    if (!variant?.seeds) return fallback
    const resolved = resolveThemeVariant(variant, mode === "dark")
    const text = resolved["text-stronger"] ?? fallback.foreground
    const background = resolved["background-stronger"] ?? fallback.background
    const alpha = mode === "dark" ? 0.25 : 0.2
    const base = text.startsWith("#") ? (text as HexColor) : (fallback.foreground as HexColor)
    const selectionBackground = withAlpha(base, alpha)
    return {
      background,
      foreground: text,
      cursor: text,
      selectionBackground,
    }
  }

  const [terminalColors, setTerminalColors] = createSignal<TerminalColors>(getTerminalColors())

  // Update theme when it changes
  createEffect(() => {
    const colors = getTerminalColors()
    setTerminalColors(colors)
    backend?.setTheme(colors)
  })

  // Update font when settings change
  createEffect(() => {
    const font = monoFontFamily(settings.appearance.font())
    backend?.setFontFamily(font)
  })

  const focusTerminal = () => {
    if (!backend) return
    backend.focus()
  }

  const refreshTerminal = (reason: string) => {
    if (!backend) return
    try {
      backend.fit()
    } catch {}
    try {
      backend.flushResize()
    } catch {}
    try {
      if (backend.rows > 0) backend.refresh(0, backend.rows - 1)
    } catch {}
    traceVerbose("activation refresh", {
      reason,
      backendCols: backend.cols,
      backendRows: backend.rows,
      host: host(),
    })
  }

  let didAutoFocus = false
  createEffect(() => {
    const should = local.autoFocus !== false
    if (!should) {
      didAutoFocus = false
      return
    }
    if (!backend) return
    if (didAutoFocus) return
    didAutoFocus = true
    queueMicrotask(() => {
      if (disposed) return
      if (container.getClientRects().length === 0) return
      refreshTerminal("auto-focus")
      focusTerminal()
    })
  })

  const handlePointerDown = () => {
    const activeElement = document.activeElement
    if (
      activeElement instanceof HTMLElement &&
      activeElement !== container &&
      !container.contains(activeElement)
    ) {
      activeElement.blur()
    }
    focusTerminal()
  }

  onMount(() => {
    timing.mountAt = performance.now()

    trace("mount", {
      dir: sdk.directory,
      hasBuffer: !!props.pty.buffer,
      start: typeof local.pty.cursor === "number" && Number.isSafeInteger(local.pty.cursor) ? local.pty.cursor : undefined,
      cursor,
    })

    const run = async () => {
      const b = await createBackend(container, {
        theme: terminalColors(),
        fontFamily: monoFontFamily(settings.appearance.font()),
        onSplitVertical: props.onSplitVertical,
        onSplitHorizontal: props.onSplitHorizontal,
        onUrlClick: (_event: MouseEvent, url: string) => {
          platform.openLink(url)
        },
        onFileLinkClick: (path: string, line?: number, col?: number) => {
          if (props.onFileLinkOpen) {
            props.onFileLinkOpen(path, line, col)
          } else if (platform.openPath) {
            void platform.openPath(path)
          }
        },
      })

      if (disposed) {
        b.dispose()
        return
      }

      backend = b
      cleanups.push(() => b.dispose())

      // Auto-focus: the createEffect-based auto-focus cannot track `backend`
      // because it's a plain variable (not a signal), so it returns early and
      // never re-fires. Focus directly after backend creation instead
      // (matches upstream's focusTerminal() call after t.open()).
      if (local.autoFocus !== false) {
        didAutoFocus = true
        queueMicrotask(() => {
          if (disposed) return
          if (container.getClientRects().length === 0) return
          refreshTerminal("auto-focus")
          focusTerminal()
        })
      }
      const mountCols = b.cols
      timing.backendReadyAt = performance.now()
      trace("backend ready", { backendCols: b.cols, backendRows: b.rows, host: host(), backendMs: Math.round(timing.backendReadyAt - timing.mountAt) })

      // Allow queued store updates from the previous mount cleanup to settle
      // so restore/connect use one consistent snapshot (cursor + buffer).
      await Promise.resolve()

      container.addEventListener("pointerdown", handlePointerDown)
      cleanups.push(() => container.removeEventListener("pointerdown", handlePointerDown))

      const snapshotCursor =
        typeof local.pty.cursor === "number" && Number.isSafeInteger(local.pty.cursor) ? local.pty.cursor : undefined
      const snapshotBuffer = local.pty.buffer
      const snapshotHasBuffer = !!(snapshotBuffer && snapshotBuffer.length > 0)
      const snapshotWasAltScreen = local.pty.wasAltScreen ?? false
      const snapshotRows = local.pty.rows
      const snapshotCols = local.pty.cols
      const snapshotWasAtBottom = local.pty.wasAtBottom
      const snapshotScrollY = local.pty.scrollY
      cursor = snapshotCursor ?? 0
      const splitWidthChanged = typeof snapshotCols === "number" && snapshotCols > 0 && snapshotCols !== mountCols

      // Reload detection marker is retained for diagnostics only.
      const reloadKey = `opencode.pty.${local.pty.id}.reload`
      const isReload = !!localStorage.getItem(reloadKey)
      try {
        localStorage.removeItem(reloadKey)
      } catch {}

      const persistSnapshot = (reason: string) => {
        if (!backend) return
        const buffer = (() => {
          try {
            // If a fullscreen TUI is active, persist the alternate buffer so
            // reloads can restore the screen without waiting for app output.
            const isAlt = backend.isAltScreen()
            return preparePersistBuffer(backend.serialize({ excludeAltBuffer: !isAlt, excludeModes: true }))
          } catch {
            return ""
          }
        })()
        const modeSequences = (() => {
          try {
            return backend.rehydrateSequences()
          } catch {
            return ""
          }
        })()
        const wasAltScreen = (() => {
          try {
            return backend.isAltScreen()
          } catch {
            return false
          }
        })()
        const wasAtBottom = (() => {
          try {
            return backend.isAtBottom()
          } catch {
            return true
          }
        })()
        props.onUpdate?.({
          id: local.pty.id,
          buffer,
          modeSequences,
          wasAltScreen,
          wasAtBottom,
          cursor,
          rows: backend.rows,
          cols: backend.cols,
          scrollY: backend.getViewportY(),
        })
        traceVerbose("snapshot persisted", { reason, len: buffer.length, cursor })
      }

      const markReload = () => {
        // Persist a final snapshot before the document tears down. Solid cleanup
        // callbacks are not guaranteed to run on a hard reload.
        persistSnapshot("beforeunload")
        try {
          localStorage.setItem(reloadKey, "1")
        } catch {}
      }
      window.addEventListener("beforeunload", markReload)
      const handlePageHide = () => persistSnapshot("pagehide")
      window.addEventListener("pagehide", handlePageHide)
      cleanups.push(() => {
        window.removeEventListener("beforeunload", markReload)
        window.removeEventListener("pagehide", handlePageHide)
        try {
          localStorage.removeItem(reloadKey)
        } catch {}
      })

      const likelyTui = isLikelyTui({
        snapshotWasAltScreen: snapshotWasAltScreen === true,
        initialCommand: local.pty.initialCommand ?? "",
        title: local.pty.title ?? "",
      })

      // Never restore alternate-screen toggles from mode rehydrate (snapshot
      // buffer restore handles alt-screen). For non-TUIs, strip mouse/focus
      // reporting to avoid accidental SGR mouse "gibberish" in shells.
      const snapshotModeSequences = filterModeSequences({
        raw: local.pty.modeSequences ?? "",
        likelyTui,
      })

      if (verbose()) {
        traceVerbose("snapshot", {
          isReload,
          splitWidthChanged,
          likelyTui,
          snapshotWasAltScreen,
          snapshotHasBuffer,
          snapshotCols,
          snapshotRows,
          mountCols,
          cursor: snapshotCursor,
        })
      }

      // Setup WebSocket connection.
      // For normal shell buffers, reconnect from live tail to avoid replaying
      // stale prompt redraw bytes during split/remount churn.
      // For TUI/alt-screen sessions, keep cursor replay so the screen can
      // recover full layout before SIGWINCH reflow.
      const plan = cursorPlan({
        likelyTui,
        splitWidthChanged,
        isReload,
        snapshotHasBuffer,
        snapshotWasAltScreen: snapshotWasAltScreen === true,
        snapshotCursor,
      })
      const hasPersistedBuffer = snapshotHasBuffer
      const useLiveTailCursor = plan.useLiveTailCursor
      const cursorStart = plan.cursorStart
      const cursorParam = `&cursor=${plan.cursorParam}`
      let urlString =
        sdk.url + `/pty/${local.pty.id}/connect?directory=${encodeURIComponent(sdk.directory)}${cursorParam}`
      if (platform.getAuthToken) {
        try {
          const token = await platform.getAuthToken()
          if (token) {
            urlString += `&token=${token}`
          }
        } catch (err) {
          console.error("Failed to get auth token for terminal:", err)
        }
      }

      const url = new URL(urlString)
      if (url.protocol === "http:") url.protocol = "ws:"
      if (url.protocol === "https:") url.protocol = "wss:"
      if (url.protocol !== "ws:" && url.protocol !== "wss:") {
        url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
      }
      if (window.__OPENCODE__?.serverPassword) {
        url.username = "opencode"
        url.password = window.__OPENCODE__.serverPassword
      }

      const socket = new WebSocket(url)
      socket.binaryType = "arraybuffer"
      timing.socketConnectAt = performance.now()
      trace("socket connecting", {
        url: url.toString(),
        cursorStart,
        hasPersistedBuffer,
        useLiveTailCursor,
        splitWidthChanged,
        sinceMount: Math.round(timing.socketConnectAt - timing.mountAt),
      })
      cleanups.push(() => {
        if (socket.readyState === WebSocket.OPEN) socket.close()
      })

      if (disposed) {
        cleanup()
        return
      }

      const once = { value: false }

      // Wire I/O: user input → server
      cleanups.push(
        b.onData((data: string) => {
          stats.inputEvents += 1
          stats.inputBytes += data.length
          const filtered = stripTerminalRepliesFromInput(data)
          if (verbose() && (stats.inputEvents <= 5 || stats.inputEvents % 20 === 0)) {
            traceVerbose("onData", {
              event: stats.inputEvents,
              bytes: data.length,
              sample: oneLine(data),
              filteredBytes: filtered.length,
              filteredSample: oneLine(filtered),
              socketReadyState: socket.readyState,
            })
          }
          if (!filtered) {
            traceVerbose("input suppressed", {
              event: stats.inputEvents,
              bytes: data.length,
              sample: oneLine(data),
            })
            return
          }
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(filtered)
            return
          }
          trace("input dropped", {
            event: stats.inputEvents,
            bytes: filtered.length,
            socketReadyState: socket.readyState,
          })
        }).dispose,
      )

      // Enter key tracking
      cleanups.push(
        b.onKey((e: { key: string }) => {
          if (e.key === "Enter") {
            props.onSubmit?.()
          }
        }).dispose,
      )

      // Debounce backend resize updates
      let backendResizeTimer: ReturnType<typeof setTimeout> | undefined
      let openResizeSettleTimer: ReturnType<typeof setTimeout> | undefined
      let pendingSize: { cols: number; rows: number } | undefined
      let suspectResizes = 0
      let lastRecoveryAt = 0
      let lastPublishedSize: { cols: number; rows: number } | undefined
      let holdResizeUntil = 0

      const publishResize = (size: { cols: number; rows: number }, source: string) => {
        stats.resizePublishAttempt += 1
        markResizeSource(source)
        const snapshot = {
          mountId,
          source,
          size,
          host: host(),
          backendCols: b.cols,
          backendRows: b.rows,
          socketReadyState: socket.readyState,
          resizePublishAttempt: stats.resizePublishAttempt,
        }
        if (socket.readyState !== WebSocket.OPEN) {
          stats.resizePublishSkip += 1
          trace("resize publish skipped", { ...snapshot, resizePublishSkip: stats.resizePublishSkip })
          return
        }
        if (source !== "desync-recovery") {
          const last = lastPublishedSize
          if (last && last.cols === size.cols && last.rows === size.rows) {
            stats.resizePublishSkip += 1
            traceVerbose("resize publish dedup", { ...snapshot, resizePublishSkip: stats.resizePublishSkip })
            return
          }
        }
        lastPublishedSize = size
        trace("resize publish", snapshot)
        sdk.client.pty
          .update({
            ptyID: local.pty.id,
            size,
          })
          .then(() => {
            stats.resizePublishAck += 1
            traceVerbose("resize ack", { ...snapshot, resizePublishAck: stats.resizePublishAck })
          })
          .catch((error) => {
            trace("resize publish failed", {
              ...snapshot,
              error: error instanceof Error ? error.message : String(error),
            })
          })
      }
      const recoverDesync = () => {
        const now = Date.now()
        if (!shouldRecoverDesync({ suspect: suspectResizes, now, last: lastRecoveryAt })) return
        lastRecoveryAt = now
        suspectResizes = 0
        trace("desync recovery", { cols: b.cols, rows: b.rows })
        try {
          b.fit()
          if (b.rows > 0) b.refresh(0, b.rows - 1)
        } catch {}
        const cols = Math.max(2, b.cols)
        const rows = Math.max(2, b.rows)
        // Force SIGWINCH so TUIs reflow after transient layout corruption.
        for (const size of sigwinchToggleSize(cols, rows)) {
          publishResize(size, "desync-recovery")
        }
      }
      const scheduleOpenResize = (source: string) => {
        if (openResizeSettleTimer) clearTimeout(openResizeSettleTimer)
        openResizeSettleTimer = setTimeout(() => {
          openResizeSettleTimer = undefined
          holdResizeUntil = 0
          publishResize(pendingSize ?? { cols: b.cols, rows: b.rows }, source)
        }, OPEN_RESIZE_SETTLE_MS)
      }

      cleanups.push(
        b.onResize((size: { cols: number; rows: number }) => {
          stats.resizeEvent += 1
          if (verbose() && (stats.resizeEvent <= 8 || stats.resizeEvent % 25 === 0)) {
            traceVerbose("onResize event", {
              event: stats.resizeEvent,
              size,
              host: host(),
              backendCols: b.cols,
              backendRows: b.rows,
            })
          }
          pendingSize = size
          if (backendResizeTimer) clearTimeout(backendResizeTimer)
          backendResizeTimer = setTimeout(() => {
            if (!pendingSize) return
            const rect = container.getBoundingClientRect()
            const hostOk = hostStable(rect)
            const sizeOk = sizeSane(pendingSize, rect)
            if (!hostOk || !sizeOk || !shouldSendResize(pendingSize, rect)) {
              suspectResizes += 1
              stats.resizeRejected += 1
              if (debug()) {
                trace("resize rejected", {
                  pendingSize,
                  rect: { width: num(rect.width), height: num(rect.height) },
                  hostOk,
                  sizeOk,
                  suspectResizes,
                  resizeRejected: stats.resizeRejected,
                  backendCols: b.cols,
                  backendRows: b.rows,
                })
              }
              recoverDesync()
              return
            }
            suspectResizes = 0
            if (verbose()) {
              traceVerbose("resize accepted", {
                pendingSize,
                rect: { width: num(rect.width), height: num(rect.height) },
                backendCols: b.cols,
                backendRows: b.rows,
              })
            }
            if (holdResizeUntil > Date.now()) {
              traceVerbose("resize held during open settle", {
                pendingSize,
                holdMs: holdResizeUntil - Date.now(),
              })
              scheduleOpenResize("socket-open-settled")
              return
            }
            publishResize(pendingSize, "backend-onResize")
          }, 100)
        }).dispose,
      )
      cleanups.push(() => {
        if (backendResizeTimer) clearTimeout(backendResizeTimer)
        if (openResizeSettleTimer) clearTimeout(openResizeSettleTimer)
      })

      let overload = false
      const handleOverload = (kind: "pending" | "live", dropped: number) => {
        if (overload) return
        overload = true
        tlog("stream overload", { ptyId: local.pty.id, kind, dropped })
        showToast({
          variant: "error",
          title: "Terminal output overflow",
          description: "This terminal produced too much output too quickly. It has been disconnected to keep the app responsive.",
        })
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
          socket.close(4000, "terminal overload")
        }
      }
      const queue = createTerminalRuntimeQueue({
        maxPendingBytes: MAX_PENDING_BYTES,
        maxStreamBytes: MAX_STREAM_BYTES,
        maxBatchBytes: MAX_BATCH_BYTES,
        maxBatchItems: MAX_BATCH_ITEMS,
        maxDroppedChunks: MAX_DROPPED_CHUNKS,
        requestFrame: (cb) => window.setTimeout(cb, 0),
        cancelFrame: (id) => window.clearTimeout(id),
        // xterm write callbacks can be dropped during rapid remount/resize churn.
        // Complete synchronously so queue drain cannot deadlock on missing callbacks.
        write: (chunk, done) => {
          b.write(chunk)
          done()
        },
        onOverload: handleOverload,
        onThrottled: (dropped) => tlog("output throttled", { ptyId: local.pty.id, dropped }),
      })
      cleanups.push(() => queue.dispose())

      const flushPendingMessages = () => {
        isBufferRestored = true
        const count = queue.pendingCount()
        queue.flushPending()
        if (count > 0) tvlog("flush pending", { ptyId: local.pty.id, count })
      }

      // Restore saved buffer on both tab switch and reload. The serialized buffer
      // may include the alternate buffer for fullscreen TUIs so reloads can
      // show the last screen without waiting for app output.
      // Mode sequences (DECSET/DECRST) are prepended to restore input behavior
      // (app cursor keys, mouse tracking, bracketed paste, etc.).
      const restore = prepareRestoreBuffer(snapshotBuffer)
      const bufferToRestore = restore.value
      const modeSequences = snapshotModeSequences
      const wasAltScreen = snapshotWasAltScreen

      if (debug()) {
        trace("restore", {
          isReload,
          hasBuffer: !!bufferToRestore,
          len: bufferToRestore?.length ?? 0,
          trimmed: restore.trimmed,
          hasModes: modeSequences.length > 0,
          wasAltScreen,
        })
      }

      if (bufferToRestore) {
        const size = restoreSize({
          likelyTui,
          splitWidthChanged,
          mountCols,
          snapshotCols,
          snapshotRows,
          backendCols: b.cols,
          backendRows: b.rows,
        })
        if (size.cols > 2 && size.rows > 0) {
          b.resize(size.cols, size.rows)
        } else {
          b.resize(80, 24)
        }

        const widthChanged = splitWidthChanged
        const shouldTrimTrailingLine =
          !isReload &&
          !wasAltScreen &&
          snapshotWasAtBottom !== false &&
          widthChanged &&
          !likelyTui
        const restoreBuffer = shouldTrimTrailingLine ? trimTrailingLines(bufferToRestore, 2) : bufferToRestore

        // Restore ordering:
        // - For fullscreen TUIs: enter alt screen first, then write snapshot.
        //   This avoids a blank screen on reload when the app doesn't emit
        //   output until the next input event.
        // - For normal shells: restore modes + scrollback snapshot.
        // If a TUI leaves custom SGR attributes active (e.g. composer bg),
        // subsequent resizes can fill new rows with that background. Reset SGR
        // after snapshot restore so fit/resize uses theme defaults for new cells.
        const restoreTail = likelyTui ? "\x1b[0m" : ""
        const restoreData = wasAltScreen
          ? `\x1b[?1049h${modeSequences}${restoreBuffer}${restoreTail}`
          : `${modeSequences}${restoreBuffer}${restoreTail}`
        if (shouldTrimTrailingLine && debug()) {
          trace("restore trimmed trailing line", {
            originalLen: bufferToRestore.length,
            nextLen: restoreBuffer.length,
            linesTrimmed: 2,
            snapshotCols,
            mountCols,
            backendCols: b.cols,
          })
        }
        b.write(restoreData, () => {
          // Restore scroll position. Alt-screen TUIs have no scrollback
          // so the viewport starts at 0 after \x1b[?1049h — no scroll needed.
          // For normal-screen terminals, scroll to bottom (the common case)
          // unless the user had explicitly scrolled up.
          if (!wasAltScreen) {
            if (snapshotWasAtBottom !== false) {
              b.scrollToBottom()
            } else if (typeof snapshotScrollY === "number") {
              b.scrollToLine(snapshotScrollY)
            }
          }

          const stop = retry(
            () => {
              if (disposed) return true
              const rect = container.getBoundingClientRect()
              if (verbose()) {
                traceVerbose("restore retry", {
                  phase: "with-buffer",
                  rect: { width: num(rect.width), height: num(rect.height) },
                  backendCols: b.cols,
                  backendRows: b.rows,
                })
              }
              if (rect.width < 10 || rect.height < 10) return false

              try {
                b.flushResize()
                if (b.cols < 2 || b.rows < 2) return false
                return true
              } catch {
                return false
              }
            },
            {
              delay: 50,
              max: 10,
              onDone: (ok) => {
                if (disposed) return
                if (debug()) {
                  trace("restore retry complete", {
                    phase: "with-buffer",
                    ok,
                    host: host(),
                    backendCols: b.cols,
                    backendRows: b.rows,
                  })
                }
                if (!ok) {
                  try {
                    b.resize(80, 24)
                    b.refresh(0, b.rows - 1)
                  } catch {}
                }
                flushPendingMessages()
              },
            },
          )
          cleanups.push(stop)
        })
      } else {
        isBufferRestored = true
        const stop = retry(
          () => {
            if (disposed) return true
            const rect = container.getBoundingClientRect()
            if (verbose()) {
              traceVerbose("restore retry", {
                phase: "without-buffer",
                rect: { width: num(rect.width), height: num(rect.height) },
                backendCols: b.cols,
                backendRows: b.rows,
              })
            }
            if (rect.width < 10 || rect.height < 10) return false

            try {
              b.flushResize()
              if (b.cols < 2 || b.rows < 2) return false
              return true
            } catch {
              return false
            }
          },
          {
            delay: 50,
            max: 10,
            onDone: (ok) => {
              if (disposed) return
              if (debug()) {
                trace("restore retry complete", {
                  phase: "without-buffer",
                  ok,
                  host: host(),
                  backendCols: b.cols,
                  backendRows: b.rows,
                })
              }
              if (!ok) {
                try {
                  b.resize(80, 24)
                  b.refresh(0, b.rows - 1)
                } catch {}
              }
              flushPendingMessages()
            },
          },
        )
        cleanups.push(stop)
      }

      // WebSocket event handlers
      const handleOpen = () => {
        timing.socketOpenAt = performance.now()
        trace("socket open", {
          cols: b.cols,
          rows: b.rows,
          wsHandshakeMs: Math.round(timing.socketOpenAt - timing.socketConnectAt),
          sinceMountMs: Math.round(timing.socketOpenAt - timing.mountAt),
        })
        local.onConnect?.()

        // For fullscreen-ish TUIs that run in the normal buffer (Ink/Codex),
        // ensure resizes don't inherit whatever SGR the app last used.
        if (likelyTui && (splitWidthChanged || isReload)) {
          try {
            b.write("\x1b[0m")
          } catch {}
          traceVerbose("pre-fit sgr reset", { splitWidthChanged, isReload })
        }

        // Fit first: after buffer restore, b.cols/rows may still reflect saved
        // dimensions from b.resize(savedCols, savedRows).
        try {
          b.fit()
        } catch {}
        const shouldForceSigwinch = likelyTui
        if (!shouldForceSigwinch) {
          holdResizeUntil = Date.now() + OPEN_RESIZE_SETTLE_MS
          scheduleOpenResize("socket-open")
        } else {
          holdResizeUntil = 0
          if (openResizeSettleTimer) {
            clearTimeout(openResizeSettleTimer)
            openResizeSettleTimer = undefined
          }
          if (splitWidthChanged) {
            // Clear visible screen before SIGWINCH so Ink-style TUIs don't leave
            // behind "composer-colored" blank bars after reflow.
            try {
              b.write("\x1b[0m\x1b[H\x1b[2J")
            } catch {}
            traceVerbose("sigwinch preclear", { cols: b.cols, rows: b.rows, splitWidthChanged })
          }
          // Force SIGWINCH via resize toggle so TUI apps re-render after reconnect.
          const targetCols = b.cols
          const targetRows = b.rows
          const [first, second] = sigwinchToggleSize(targetCols, targetRows)
          if (debug()) {
            trace("socket open sigwinch", {
              target: { cols: targetCols, rows: targetRows },
              first,
              second,
              host: host(),
              wasAltScreen: snapshotWasAltScreen === true,
              likelyTui,
            })
          }
          sdk.client.pty
            .update({
              ptyID: local.pty.id,
              size: first,
            })
            .then(() => {
              traceVerbose("sigwinch ack", { size: first, step: 1 })
              return sdk.client.pty.update({
                ptyID: local.pty.id,
                size: second,
              })
            })
            .then(() => {
              traceVerbose("sigwinch ack", { size: second, step: 2 })
            })
            .catch((error) => {
              trace("socket open sigwinch failed", { first, second, error: error instanceof Error ? error.message : String(error) })
            })
        }

        // Execute initial command only once per PTY, including across reloads.
        const runInitial = shouldRunInitialCommand(local.pty)
        if (runInitial) stats.initialCheckTrue += 1
        else stats.initialCheckFalse += 1
        trace("initial command decision", {
          runInitial,
          hasInitialCommand: !!local.pty.initialCommand,
          initialLen: local.pty.initialCommand?.length,
        })
        if (runInitial) {
          markInitialCommandRan(local.pty.id)
          const initialCmd = local.pty.initialCommand ?? ""
          // Small delay to ensure terminal is ready
          setTimeout(() => {
            if (socket.readyState === WebSocket.OPEN) {
              stats.initialSent += 1
              trace("initial command sent", {
                len: initialCmd.length,
                initialSent: stats.initialSent,
                sample: oneLine(initialCmd),
              })
              socket.send(initialCmd + "\n")
              props.onUpdate?.({ id: local.pty.id, initialCommand: undefined })
              return
            }
            trace("initial command skipped", { reason: "socket-not-open", socketReadyState: socket.readyState })
          }, 100)
          return
        }
      }
      socket.addEventListener("open", handleOpen)
      cleanups.push(() => socket.removeEventListener("open", handleOpen))

      const decoder = new TextDecoder()
      const encoder = new TextEncoder()

      const handleMessage = (event: MessageEvent) => {
        if (disposed) return
        if (event.data instanceof ArrayBuffer) {
          stats.metaFrames += 1
          // WebSocket control frame: 0x00 + UTF-8 JSON (currently { cursor }).
          const bytes = new Uint8Array(event.data)
          if (bytes[0] !== 0) {
            stats.binaryIgnored += 1
            if (verbose() && (stats.binaryIgnored <= 5 || stats.binaryIgnored % 20 === 0)) {
              traceVerbose("binary frame ignored", { count: stats.binaryIgnored, byteLength: bytes.length, first: bytes[0] })
            }
            return
          }
          const json = decoder.decode(bytes.subarray(1))
          try {
            const meta = JSON.parse(json) as { cursor?: unknown }
            const next = meta?.cursor
            if (typeof next === "number" && Number.isSafeInteger(next) && next >= 0) {
              stats.metaCursor += 1
              if (verbose() && (stats.metaCursor <= 5 || stats.metaCursor % 20 === 0)) {
                traceVerbose("cursor meta", { before: cursor, next, count: stats.metaCursor })
              }
              cursor = next
              return
            }
            stats.metaInvalid += 1
            trace("cursor meta ignored", { cursor: meta?.cursor, count: stats.metaInvalid })
          } catch {
            stats.metaInvalid += 1
            trace("cursor meta parse failed", { count: stats.metaInvalid, byteLength: bytes.length })
          }
          return
        }

        const data = typeof event.data === "string" ? event.data : ""
        if (!data) {
          stats.emptyFrames += 1
          return
        }
        const dataBytes = encoder.encode(data).byteLength
        stats.textFrames += 1
        stats.textBytes += dataBytes
        cursor += dataBytes
        // CLAXEDO PATCH: Instrumentation — first text byte from server
        if (timing.firstTextByteAt === 0 && dataBytes > 0) {
          timing.firstTextByteAt = performance.now()
          tlog("terminal timing: first text byte", {
            ptyId: local.pty.id,
            sinceMountMs: Math.round(timing.firstTextByteAt - timing.mountAt),
            sinceSocketOpenMs: Math.round(timing.firstTextByteAt - timing.socketOpenAt),
            bytes: dataBytes,
          })
        }
        msgCount += 1
        if (verbose() && (msgCount <= 5 || msgCount % 50 === 0)) {
          traceVerbose("socket message", {
            index: msgCount,
            bytes: dataBytes,
            textFrames: stats.textFrames,
            textBytes: stats.textBytes,
            restored: isBufferRestored,
            sample: oneLine(data),
          })
        }
        // Queue messages if buffer restoration is still in progress
        if (!isBufferRestored) {
          queue.push(data)
          return
        }
        b.write(data)
      }
      socket.addEventListener("message", handleMessage)
      cleanups.push(() => socket.removeEventListener("message", handleMessage))

      const handleError = (error: Event) => {
        if (disposed) return
        trace("socket error")
        if (once.value) return
        once.value = true
        console.error("WebSocket error:", error)
        local.onConnectError?.(error)
      }
      socket.addEventListener("error", handleError)
      cleanups.push(() => socket.removeEventListener("error", handleError))

      const handleClose = (event: CloseEvent) => {
        if (disposed) return
        trace("socket close", { code: event.code, reason: event.reason, clean: event.wasClean })
        if (socketCloseIsError(event.code)) {
          if (once.value) return
          once.value = true
          local.onConnectError?.(new Error(`WebSocket closed abnormally: ${event.code}`))
        }
      }
      socket.addEventListener("close", handleClose)
      cleanups.push(() => socket.removeEventListener("close", handleClose))

    }

    void run().catch((err) => {
      if (disposed) return
      showToast({
        variant: "error",
        title: language.t("terminal.connectionLost.title"),
        description: err instanceof Error ? err.message : language.t("terminal.connectionLost.description"),
      })
      local.onConnectError?.(err)
    })
  })

  onCleanup(() => {
    if (debug()) {
      trace("unmount", {
        msgCount,
        host: host(),
        backendCols: backend?.cols,
        backendRows: backend?.rows,
      })
      trace("summary", {
        msgCount,
        cursor,
        resizeBySource,
        stats,
      })
    }

    disposed = true

    // Serialize state for restoration
    if (backend && props.onCleanup) {
      const buffer = (() => {
        try {
          const isAlt = backend.isAltScreen()
          return preparePersistBuffer(backend.serialize({ excludeAltBuffer: !isAlt, excludeModes: true }))
        } catch {
          return ""
        }
      })()
      const modeSequences = (() => {
        try {
          return backend.rehydrateSequences()
        } catch {
          return ""
        }
      })()
      const wasAltScreen = (() => {
        try {
          return backend.isAltScreen()
        } catch {
          return false
        }
      })()
      const wasAtBottom = (() => {
        try {
          return backend.isAtBottom()
        } catch {
          return true
        }
      })()
      props.onCleanup({
        ...local.pty,
        buffer,
        modeSequences,
        wasAltScreen,
        wasAtBottom,
        cursor,
        rows: backend.rows,
        cols: backend.cols,
        scrollY: backend.getViewportY(),
      })
    }

    cleanup()
  })

  return (
    <div
      ref={container}
      data-component="terminal"
      data-prevent-autofocus
      tabIndex={-1}
      style={{ "background-color": terminalColors().background }}
      classList={{
        ...(local.classList ?? {}),
        "select-text": true,
        "h-full w-full overflow-hidden font-mono": true,
        [local.class ?? ""]: !!local.class,
      }}
      {...others}
    />
  )
}
