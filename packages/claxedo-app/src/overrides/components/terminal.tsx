import type { TerminalBackend } from "../terminal/backend/types"
import { createBackend } from "#terminal-backend"
import { retry } from "../terminal/retry"
import { ComponentProps, Show, createEffect, createSignal, onCleanup, onMount, splitProps } from "solid-js"
import { useSDK } from "@/context/sdk"
import { monoFontFamily, useSettings } from "@/context/settings"
import { LocalPTY } from "@/context/terminal"
import { usePlatform } from "@/context/platform"
import { resolveThemeVariant, useTheme, withAlpha, type HexColor } from "@opencode-ai/ui/theme"
import { useLanguage } from "@/context/language"
import { showToast } from "@opencode-ai/ui/toast"
import { markInitialCommandRan, shouldRunInitialCommand } from "./terminal-recovery"
import { capChunk, createStream, pushStream, takeStream } from "./terminal-stream"
import { preparePersistBuffer, prepareRestoreBuffer } from "./terminal-buffer"
import { shouldRecoverDesync, shouldSendResize } from "./terminal-geometry"
import {
  initWait,
  markBytes,
  markElapsed,
  markInput,
  showWaiting,
  waitProfile,
} from "./terminal-wait"

export interface TerminalProps extends ComponentProps<"div"> {
  pty: LocalPTY
  onSubmit?: () => void
  onCleanup?: (pty: LocalPTY) => void
  onUpdate?: (pty: Partial<LocalPTY> & { id: string }) => void
  onConnect?: () => void
  onConnectError?: (error: unknown) => void
  onSplitVertical?: () => void
  onSplitHorizontal?: () => void
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

const waitStarted = new Map<string, number>()

export const Terminal = (props: TerminalProps) => {
  const sdk = useSDK()
  const settings = useSettings()
  const theme = useTheme()
  const language = useLanguage()
  const platform = usePlatform()

  let container!: HTMLDivElement
  const [local, others] = splitProps(props, ["pty", "class", "classList", "onConnect", "onConnectError"])

  let backend: TerminalBackend | undefined
  let disposed = false
  let isBufferRestored = !props.pty.buffer
  let pendingMessages: string[] = []
  let pendingBytes = 0
  let msgCount = 0
  const hasBuffer = !!(props.pty.buffer && props.pty.buffer.length > 0)
  const profile = waitProfile(!!local.pty.initialCommand)
  const [wait, setWait] = createSignal(initWait(hasBuffer))

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

  const handlePointerDown = () => {
    const activeElement = document.activeElement
    if (activeElement instanceof HTMLElement && activeElement !== container) {
      activeElement.blur()
    }
    focusTerminal()
  }

  onMount(() => {
    let waitTimer: ReturnType<typeof setTimeout> | undefined
    let maxWaitTimer: ReturnType<typeof setTimeout> | undefined
    if (hasBuffer) {
      waitStarted.delete(props.pty.id)
    }
    if (!hasBuffer) {
      const now = Date.now()
      const started = waitStarted.get(props.pty.id) ?? now
      waitStarted.set(props.pty.id, started)
      const elapsed = now - started
      const minDelay = Math.max(0, profile.minMs - elapsed)
      const maxDelay = Math.max(0, profile.maxMs - elapsed)
      waitTimer = setTimeout(() => setWait((state) => markElapsed(state, profile.minMs, profile.minMs, profile.maxMs)), minDelay)
      maxWaitTimer = setTimeout(() => setWait((state) => markElapsed(state, profile.maxMs, profile.minMs, profile.maxMs)), maxDelay)
      cleanups.push(() => {
        if (waitTimer) clearTimeout(waitTimer)
        if (maxWaitTimer) clearTimeout(maxWaitTimer)
      })
    }

    if (debug()) tlog("mount", { ptyId: props.pty.id, dir: sdk.directory, hasBuffer: !!props.pty.buffer })

    const run = async () => {
      const b = await createBackend(container, {
        theme: terminalColors(),
        fontFamily: monoFontFamily(settings.appearance.font()),
        onSplitVertical: props.onSplitVertical,
        onSplitHorizontal: props.onSplitHorizontal,
      })

      if (disposed) {
        b.dispose()
        return
      }

      backend = b
      cleanups.push(() => b.dispose())

      container.addEventListener("pointerdown", handlePointerDown)
      cleanups.push(() => container.removeEventListener("pointerdown", handlePointerDown))

      // Reload detection marker is retained for diagnostics only.
      const reloadKey = `opencode.pty.${local.pty.id}.reload`
      const isReload = !!localStorage.getItem(reloadKey)
      try {
        localStorage.removeItem(reloadKey)
      } catch {}

      const markReload = () => {
        try {
          localStorage.setItem(reloadKey, "1")
        } catch {}
      }
      window.addEventListener("beforeunload", markReload)
      cleanups.push(() => {
        window.removeEventListener("beforeunload", markReload)
        try {
          localStorage.removeItem(reloadKey)
        } catch {}
      })

      // Setup WebSocket connection
      let urlString = sdk.url + `/pty/${local.pty.id}/connect?directory=${encodeURIComponent(sdk.directory)}`
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
      if (window.__OPENCODE__?.serverPassword) {
        url.username = "opencode"
        url.password = window.__OPENCODE__.serverPassword
      }

      const socket = new WebSocket(url)
      tlog("socket connecting", { ptyId: local.pty.id, url: url.toString() })
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
          if (data.length > 0) setWait((state) => markInput(state))
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(data)
          }
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
      let pendingSize: { cols: number; rows: number } | undefined
      let suspectResizes = 0
      let lastRecoveryAt = 0

      const publishResize = (size: { cols: number; rows: number }) => {
        if (socket.readyState !== WebSocket.OPEN) return
        sdk.client.pty
          .update({
            ptyID: local.pty.id,
            size,
          })
          .catch(() => {})
      }

      const recoverDesync = () => {
        const now = Date.now()
        if (!shouldRecoverDesync({ suspect: suspectResizes, now, last: lastRecoveryAt })) return
        lastRecoveryAt = now
        suspectResizes = 0
        tlog("desync recovery", { ptyId: local.pty.id, cols: b.cols, rows: b.rows })
        try {
          b.fit()
          if (b.rows > 0) b.refresh(0, b.rows - 1)
        } catch {}
        const cols = Math.max(2, b.cols)
        const rows = Math.max(2, b.rows)
        // Force SIGWINCH so TUIs reflow after transient layout corruption.
        publishResize({ cols: Math.max(2, cols - 1), rows })
        publishResize({ cols, rows })
      }

      cleanups.push(
        b.onResize((size: { cols: number; rows: number }) => {
          pendingSize = size
          if (backendResizeTimer) clearTimeout(backendResizeTimer)
          backendResizeTimer = setTimeout(() => {
            if (!pendingSize) return
            const rect = container.getBoundingClientRect()
            if (!shouldSendResize(pendingSize, rect)) {
              suspectResizes += 1
              recoverDesync()
              return
            }
            suspectResizes = 0
            publishResize(pendingSize)
          }, 100)
        }).dispose,
      )
      cleanups.push(() => {
        if (backendResizeTimer) clearTimeout(backendResizeTimer)
      })

      // Helper to flush pending messages after buffer restoration
      const stream = createStream()
      let frame = 0
      let writing = false
      let reported = false
      let overload = false
      let pendingDropped = 0
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
      const schedule = () => {
        if (disposed) return
        if (overload) return
        if (frame) return
        if (writing) return
        frame = requestAnimationFrame(drain)
      }
      const drain = () => {
        frame = 0
        if (disposed) return
        if (overload) return
        if (writing) return
        const chunk = takeStream(stream, MAX_BATCH_BYTES, MAX_BATCH_ITEMS)
        if (!chunk) return
        writing = true
        b.write(chunk, () => {
          writing = false
          if (stream.items.length > 0) schedule()
        })
      }
      const enqueue = (data: string) => {
        if (overload) return
        pushStream(stream, data, MAX_STREAM_BYTES)
        if (stream.dropped > 0 && !reported) {
          reported = true
          tlog("output throttled", { ptyId: local.pty.id, dropped: stream.dropped })
        }
        if (stream.dropped >= MAX_DROPPED_CHUNKS) {
          handleOverload("live", stream.dropped)
          return
        }
        schedule()
      }
      cleanups.push(() => {
        if (frame) cancelAnimationFrame(frame)
      })

      const flushPendingMessages = () => {
        isBufferRestored = true
        if (pendingMessages.length > 0) {
          for (const msg of pendingMessages) {
            enqueue(msg)
          }
          tvlog("flush pending", { ptyId: local.pty.id, count: pendingMessages.length })
          pendingMessages = []
          pendingBytes = 0
        }
      }

      // Restore saved buffer on both tab switch and reload. The serialized buffer
      // excludes alt-screen and mode state to avoid corrupting fullscreen TUIs.
      const restore = prepareRestoreBuffer(local.pty.buffer)
      const bufferToRestore = restore.value

      if (debug())
        tlog("restore", {
          id: local.pty.id,
          isReload,
          hasBuffer: !!bufferToRestore,
          len: bufferToRestore?.length ?? 0,
          trimmed: restore.trimmed,
        })

      if (bufferToRestore) {
        if (local.pty.rows && local.pty.cols && local.pty.cols > 2) {
          b.resize(local.pty.cols, local.pty.rows)
        } else {
          b.resize(80, 24)
        }

        b.write(bufferToRestore, () => {
          if (local.pty.scrollY) {
            b.scrollToLine(local.pty.scrollY)
          }
          const stop = retry(
            () => {
              if (disposed) return true
              const rect = container.getBoundingClientRect()
              if (rect.width < 10 || rect.height < 10) return false

              try {
                b.fit()
                if (b.cols < 2 || b.rows < 2) return false
                b.refresh(0, b.rows - 1)
                return true
              } catch {
                return false
              }
            },
            {
              delay: 50,
              max: 8,
              onDone: (ok) => {
                if (disposed) return
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
            if (rect.width < 10 || rect.height < 10) return false

            try {
              b.fit()
              if (b.cols < 2 || b.rows < 2) return false
              b.refresh(0, b.rows - 1)
              return true
            } catch {
              return false
            }
          },
          {
            delay: 50,
            max: 8,
            onDone: (ok) => {
              if (disposed) return
              if (ok) return
              try {
                b.resize(80, 24)
                b.refresh(0, b.rows - 1)
              } catch {}
            },
          },
        )
        cleanups.push(stop)
      }

      // WebSocket event handlers
      const handleOpen = () => {
        tlog("socket open", { ptyId: local.pty.id, cols: b.cols, rows: b.rows })
        local.onConnect?.()

        // Force SIGWINCH via resize toggle so TUI apps (OpenCode, Codex) re-render
        // after reconnect. A direct size update won't trigger SIGWINCH if the size
        // happens to match the PTY's current size, so we send cols-1 first then cols.
        const targetCols = b.cols
        const targetRows = b.rows
        sdk.client.pty
          .update({
            ptyID: local.pty.id,
            size: { cols: Math.max(2, targetCols - 1), rows: targetRows },
          })
          .then(() =>
            sdk.client.pty.update({
              ptyID: local.pty.id,
              size: { cols: targetCols, rows: targetRows },
            }),
          )
          .catch(() => {})

        // Execute initial command only once per PTY, including across reloads.
        if (shouldRunInitialCommand(local.pty)) {
          markInitialCommandRan(local.pty.id)
          const initialCmd = local.pty.initialCommand
          // Small delay to ensure terminal is ready
          setTimeout(() => {
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(initialCmd + "\n")
              props.onUpdate?.({ id: local.pty.id, initialCommand: undefined })
            }
          }, 100)
        }
      }
      socket.addEventListener("open", handleOpen)
      cleanups.push(() => socket.removeEventListener("open", handleOpen))

      const handleMessage = (event: MessageEvent) => {
        if (disposed) return
        if (typeof event.data !== "string") return
        if (event.data.length > 0) setWait((state) => markBytes(state, event.data.length, profile.minReadyBytes))
        msgCount += 1
        if (verbose() && (msgCount <= 5 || msgCount % 50 === 0)) {
          tvlog("socket message", {
            ptyId: local.pty.id,
            index: msgCount,
            bytes: event.data.length,
            restored: isBufferRestored,
          })
        }
        // Queue messages if buffer restoration is still in progress
        if (!isBufferRestored) {
          const pending = capChunk(event.data, MAX_PENDING_BYTES)
          pendingMessages.push(pending.value)
          pendingBytes += pending.value.length
          if (pending.trimmed) pendingDropped += 1
          while (pendingBytes > MAX_PENDING_BYTES && pendingMessages.length > 1) {
            const next = pendingMessages.shift()
            if (!next) break
            pendingBytes -= next.length
            pendingDropped += 1
          }
          if (pendingDropped >= MAX_DROPPED_CHUNKS) {
            handleOverload("pending", pendingDropped)
          }
          return
        }
        enqueue(event.data)
      }
      socket.addEventListener("message", handleMessage)
      cleanups.push(() => socket.removeEventListener("message", handleMessage))

      const handleError = (error: Event) => {
        if (disposed) return
        tlog("socket error", { ptyId: local.pty.id })
        if (once.value) return
        once.value = true
        console.error("WebSocket error:", error)
        local.onConnectError?.(error)
      }
      socket.addEventListener("error", handleError)
      cleanups.push(() => socket.removeEventListener("error", handleError))

      const handleClose = (event: CloseEvent) => {
        if (disposed) return
        tlog("socket close", { ptyId: local.pty.id, code: event.code, reason: event.reason, clean: event.wasClean })
        if (event.code !== 1000) {
          if (once.value) return
          once.value = true
          local.onConnectError?.(new Error(`WebSocket closed abnormally: ${event.code}`))
        }
      }
      socket.addEventListener("close", handleClose)
      cleanups.push(() => socket.removeEventListener("close", handleClose))

      // Focus terminal
      focusTerminal()
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
    if (debug()) tlog("unmount", { ptyId: props.pty.id, msgCount })

    disposed = true

    // Serialize state for restoration
    if (backend && props.onCleanup) {
      const buffer = (() => {
        try {
          return preparePersistBuffer(backend.serialize({ excludeAltBuffer: true, excludeModes: true }))
        } catch {
          return ""
        }
      })()
      props.onCleanup({
        ...local.pty,
        buffer,
        rows: backend.rows,
        cols: backend.cols,
        scrollY: backend.getViewportY(),
      })
    }

    cleanup()
    if (!showWaiting(wait())) waitStarted.delete(props.pty.id)
  })

  return (
    <div class="relative h-full w-full" {...others}>
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
      />
      <Show when={showWaiting(wait())}>
        <div class="absolute inset-0 z-20 flex items-center justify-center pointer-events-none backdrop-blur-xl bg-background-base/85">
          <div class="flex items-center gap-2 rounded px-3 py-2 text-xs text-text-weak bg-surface-raised-base border border-border-weak-base/60">
            <div class="size-3 rounded-full border-2 border-text-weak border-t-transparent animate-spin" />
            <span>Waiting for terminal output...</span>
          </div>
        </div>
      </Show>
    </div>
  )
}
