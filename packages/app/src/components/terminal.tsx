import type { Ghostty, Terminal as Term, FitAddon } from "ghostty-web"
import { ComponentProps, createEffect, createSignal, onCleanup, onMount, splitProps } from "solid-js"
import { usePlatform } from "@/context/platform"
import { useSDK } from "@/context/sdk"
import { monoFontFamily, useSettings } from "@/context/settings"
import { parseKeybind, matchKeybind } from "@/context/command"
import { SerializeAddon } from "@/addons/serialize"
import { LocalPTY } from "@/context/terminal"
import { resolveThemeVariant, useTheme, withAlpha, type HexColor } from "@opencode-ai/ui/theme"
import { useLanguage } from "@/context/language"
import { showToast } from "@opencode-ai/ui/toast"
import { disposeIfDisposable, getHoveredLinkText, setOptionIfSupported } from "@/utils/runtime-adapters"

const TOGGLE_TERMINAL_ID = "terminal.toggle"
const DEFAULT_TOGGLE_TERMINAL_KEYBIND = "ctrl+`"
export interface TerminalProps extends ComponentProps<"div"> {
  pty: LocalPTY
  onSubmit?: () => void
  onCleanup?: (pty: LocalPTY) => void
  onConnect?: () => void
  onConnectError?: (error: unknown) => void
}

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

export const Terminal = (props: TerminalProps) => {
  const platform = usePlatform()
  const sdk = useSDK()
  const settings = useSettings()
  const theme = useTheme()
  const language = useLanguage()
  let container!: HTMLDivElement
  const [local, others] = splitProps(props, ["pty", "class", "classList", "onConnect", "onConnectError"])
  let ws: WebSocket | undefined
  let term: Term | undefined
  let ghostty: Ghostty
  let serializeAddon: SerializeAddon
  let fitAddon: FitAddon
  let handleResize: () => void
  let handleTextareaFocus: () => void
  let handleTextareaBlur: () => void
  let disposed = false
  const cleanups: VoidFunction[] = []
  const start =
    typeof local.pty.cursor === "number" && Number.isSafeInteger(local.pty.cursor) ? local.pty.cursor : undefined
  let cursor = start ?? 0

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

  createEffect(() => {
    const colors = getTerminalColors()
    setTerminalColors(colors)
    if (!term) return
    setOptionIfSupported(term, "theme", colors)
  })

  createEffect(() => {
    const font = monoFontFamily(settings.appearance.font())
    if (!term) return
    setOptionIfSupported(term, "fontFamily", font)
  })

  const focusTerminal = () => {
    const t = term
    if (!t) return
    t.focus()
    t.textarea?.focus()
    setTimeout(() => t.textarea?.focus(), 0)
  }
  const handlePointerDown = () => {
    const activeElement = document.activeElement
    if (activeElement instanceof HTMLElement && activeElement !== container && !container.contains(activeElement)) {
      activeElement.blur()
    }
    focusTerminal()
  }

  const handleLinkClick = (event: MouseEvent) => {
    if (!event.shiftKey && !event.ctrlKey && !event.metaKey) return
    if (event.altKey) return
    if (event.button !== 0) return

    const t = term
    if (!t) return

    const text = getHoveredLinkText(t)
    if (!text) return

    event.preventDefault()
    event.stopImmediatePropagation()
    platform.openLink(text)
  }

  onMount(() => {
    const run = async () => {
      const loaded = await loadGhostty()
      if (disposed) return

      const mod = loaded.mod
      const g = loaded.ghostty

      const once = { value: false }

      const url = new URL(sdk.url + `/pty/${local.pty.id}/connect`)
      url.searchParams.set("directory", sdk.directory)
      url.searchParams.set("cursor", String(start !== undefined ? start : local.pty.buffer ? -1 : 0))
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
      if (window.__OPENCODE__?.serverPassword) {
        url.username = "opencode"
        url.password = window.__OPENCODE__?.serverPassword
      }
      const socket = new WebSocket(url)
      socket.binaryType = "arraybuffer"
      cleanups.push(() => {
        if (socket.readyState !== WebSocket.CLOSED && socket.readyState !== WebSocket.CLOSING) socket.close()
      })
      if (disposed) {
        cleanup()
        return
      }
      ws = socket

      const t = new mod.Terminal({
        cursorBlink: true,
        cursorStyle: "bar",
        fontSize: 14,
        fontFamily: monoFontFamily(settings.appearance.font()),
        allowTransparency: false,
        convertEol: true,
        theme: terminalColors(),
        scrollback: 10_000,
        ghostty: g,
      })
      cleanups.push(() => t.dispose())
      if (disposed) {
        cleanup()
        return
      }
      ghostty = g
      term = t

      const handleCopy = (event: ClipboardEvent) => {
        const selection = t.getSelection()
        if (!selection) return

        const clipboard = event.clipboardData
        if (!clipboard) return

        event.preventDefault()
        clipboard.setData("text/plain", selection)
      }

      const handlePaste = (event: ClipboardEvent) => {
        const clipboard = event.clipboardData
        const text = clipboard?.getData("text/plain") ?? clipboard?.getData("text") ?? ""
        if (!text) return

        event.preventDefault()
        event.stopPropagation()
        t.paste(text)
      }

      t.attachCustomKeyEventHandler((event) => {
        const key = event.key.toLowerCase()

        if (event.ctrlKey && event.shiftKey && !event.metaKey && key === "c") {
          document.execCommand("copy")
          return true
        }

        // allow for toggle terminal keybinds in parent
        const config = settings.keybinds.get(TOGGLE_TERMINAL_ID) ?? DEFAULT_TOGGLE_TERMINAL_KEYBIND
        const keybinds = parseKeybind(config)

        return matchKeybind(keybinds, event)
      })

      container.addEventListener("copy", handleCopy, true)
      cleanups.push(() => container.removeEventListener("copy", handleCopy, true))

      container.addEventListener("paste", handlePaste, true)
      cleanups.push(() => container.removeEventListener("paste", handlePaste, true))

      const fit = new mod.FitAddon()
      const serializer = new SerializeAddon()
      cleanups.push(() => disposeIfDisposable(fit))
      t.loadAddon(serializer)
      t.loadAddon(fit)
      fitAddon = fit
      serializeAddon = serializer

      t.open(container)

      container.addEventListener("pointerdown", handlePointerDown)
      cleanups.push(() => container.removeEventListener("pointerdown", handlePointerDown))

      container.addEventListener("click", handleLinkClick, { capture: true })
      cleanups.push(() => container.removeEventListener("click", handleLinkClick, { capture: true }))

      handleTextareaFocus = () => {
        t.options.cursorBlink = true
      }
      handleTextareaBlur = () => {
        t.options.cursorBlink = false
      }

      t.textarea?.addEventListener("focus", handleTextareaFocus)
      t.textarea?.addEventListener("blur", handleTextareaBlur)
      cleanups.push(() => t.textarea?.removeEventListener("focus", handleTextareaFocus))
      cleanups.push(() => t.textarea?.removeEventListener("blur", handleTextareaBlur))

      focusTerminal()

      fit.fit()

      if (local.pty.buffer) {
        t.write(local.pty.buffer, () => {
          if (local.pty.scrollY) t.scrollToLine(local.pty.scrollY)
        })
      }

      fit.observeResize()
      handleResize = () => fit.fit()
      window.addEventListener("resize", handleResize)
      cleanups.push(() => window.removeEventListener("resize", handleResize))

      const onResize = t.onResize(async (size) => {
        if (socket.readyState === WebSocket.OPEN) {
          await sdk.client.pty
            .update({
              ptyID: local.pty.id,
              size: {
                cols: size.cols,
                rows: size.rows,
              },
            })
            .catch(() => {})
        }
      })
      cleanups.push(() => disposeIfDisposable(onResize))
      const onData = t.onData((data) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(data)
        }
      })
      cleanups.push(() => disposeIfDisposable(onData))
      const onKey = t.onKey((key) => {
        if (key.key == "Enter") {
          props.onSubmit?.()
        }
      })
      cleanups.push(() => disposeIfDisposable(onKey))
      // t.onScroll((ydisp) => {
      // console.log("Scroll position:", ydisp)
      // })

      const handleOpen = () => {
        local.onConnect?.()
        sdk.client.pty
          .update({
            ptyID: local.pty.id,
            size: {
              cols: t.cols,
              rows: t.rows,
            },
          })
          .catch(() => {})
      }
      socket.addEventListener("open", handleOpen)
      cleanups.push(() => socket.removeEventListener("open", handleOpen))

      const decoder = new TextDecoder()

      const handleMessage = (event: MessageEvent) => {
        if (disposed) return
        if (event.data instanceof ArrayBuffer) {
          // WebSocket control frame: 0x00 + UTF-8 JSON (currently { cursor }).
          const bytes = new Uint8Array(event.data)
          if (bytes[0] !== 0) return
          const json = decoder.decode(bytes.subarray(1))
          try {
            const meta = JSON.parse(json) as { cursor?: unknown }
            const next = meta?.cursor
            if (typeof next === "number" && Number.isSafeInteger(next) && next >= 0) {
              cursor = next
            }
          } catch {
            // ignore
          }
          return
        }

        const data = typeof event.data === "string" ? event.data : ""
        if (!data) return
        t.write(data)
        cursor += data.length
      }
      socket.addEventListener("message", handleMessage)
      cleanups.push(() => socket.removeEventListener("message", handleMessage))

      const handleError = (error: Event) => {
        if (disposed) return
        if (once.value) return
        once.value = true
        console.error("WebSocket error:", error)
        local.onConnectError?.(error)
      }
      socket.addEventListener("error", handleError)
      cleanups.push(() => socket.removeEventListener("error", handleError))

      const handleClose = (event: CloseEvent) => {
        if (disposed) return
        // Normal closure (code 1000) means PTY process exited - server event handles cleanup
        // For other codes (network issues, server restart), trigger error handler
        if (event.code !== 1000) {
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
    disposed = true
    const t = term
    if (serializeAddon && props.onCleanup && t) {
      const buffer = (() => {
        try {
          return serializeAddon.serialize()
        } catch {
          return ""
        }
      })()
      props.onCleanup({
        ...local.pty,
        buffer,
        cursor,
        rows: t.rows,
        cols: t.cols,
        scrollY: t.getViewportY(),
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
        "size-full px-6 py-3 font-mono": true,
        [local.class ?? ""]: !!local.class,
      }}
      {...others}
    />
  )
}
