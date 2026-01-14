import type { Ghostty, Terminal as Term, FitAddon } from "ghostty-web"
import { ComponentProps, createEffect, createSignal, onCleanup, onMount, splitProps } from "solid-js"
import { useSDK } from "@/context/sdk"
import { SerializeAddon } from "@/addons/serialize"
import { LocalPTY } from "@/context/terminal"
import { resolveThemeVariant, useTheme, withAlpha, type HexColor } from "@opencode-ai/ui/theme"

export interface TerminalProps extends ComponentProps<"div"> {
  pty: LocalPTY
  onSubmit?: () => void
  onCleanup?: (pty: LocalPTY) => void
  onConnectError?: (error: unknown) => void
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
  const sdk = useSDK()
  const theme = useTheme()
  let container!: HTMLDivElement
  const [local, others] = splitProps(props, ["pty", "class", "classList", "onConnectError"])
  let ws: WebSocket | undefined
  let term: Term | undefined
  let ghostty: Ghostty
  let serializeAddon: SerializeAddon
  let fitAddon: FitAddon
  let handleResize: () => void
  let handleTextareaFocus: () => void
  let handleTextareaBlur: () => void
  let reconnect: number | undefined
  let disposed = false

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
    const setOption = (term as unknown as { setOption?: (key: string, value: TerminalColors) => void }).setOption
    if (!setOption) return
    setOption("theme", colors)
  })

  const focusTerminal = () => {
    const t = term
    if (!t) return
    t.focus()
    setTimeout(() => t.textarea?.focus(), 0)
  }
  const handlePointerDown = () => {
    const activeElement = document.activeElement
    if (activeElement instanceof HTMLElement && activeElement !== container) {
      activeElement.blur()
    }
    focusTerminal()
  }

  onMount(async () => {
    const mod = await import("ghostty-web")
    ghostty = await mod.Ghostty.load()

    const url = new URL(sdk.url + `/pty/${local.pty.id}/connect?directory=${encodeURIComponent(sdk.directory)}`)
    if (window.__OPENCODE__?.serverPassword) {
      url.username = "opencode"
      url.password = window.__OPENCODE__?.serverPassword
    }
    const socket = new WebSocket(url)
    ws = socket

    const t = new mod.Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontSize: 14,
      fontFamily: "IBM Plex Mono, monospace",
      allowTransparency: true,
      theme: terminalColors(),
      scrollback: 10_000,
      ghostty,
    })
    term = t

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

    t.attachCustomKeyEventHandler((event) => {
      const key = event.key.toLowerCase()

      if (event.ctrlKey && event.shiftKey && !event.metaKey && key === "c") {
        copy()
        return true
      }

      if (event.metaKey && !event.ctrlKey && !event.altKey && key === "c") {
        if (!t.hasSelection()) return true
        copy()
        return true
      }

      // allow for ctrl-` to toggle terminal in parent
      if (event.ctrlKey && key === "`") {
        return true
      }

      return false
    })

    fitAddon = new mod.FitAddon()
    serializeAddon = new SerializeAddon()
    t.loadAddon(serializeAddon)
    t.loadAddon(fitAddon)

    t.open(container)
    container.addEventListener("pointerdown", handlePointerDown)

    handleTextareaFocus = () => {
      t.options.cursorBlink = true
    }
    handleTextareaBlur = () => {
      t.options.cursorBlink = false
    }

    t.textarea?.addEventListener("focus", handleTextareaFocus)
    t.textarea?.addEventListener("blur", handleTextareaBlur)

    focusTerminal()

    if (local.pty.buffer) {
      if (local.pty.rows && local.pty.cols) {
        t.resize(local.pty.cols, local.pty.rows)
      }
      t.write(local.pty.buffer, () => {
        if (local.pty.scrollY) {
          t.scrollToLine(local.pty.scrollY)
        }
        fitAddon.fit()
      })
    }

    fitAddon.observeResize()
    handleResize = () => fitAddon.fit()
    window.addEventListener("resize", handleResize)
    t.onResize(async (size) => {
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
    t.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(data)
      }
    })
    t.onKey((key) => {
      if (key.key == "Enter") {
        props.onSubmit?.()
      }
    })
    // t.onScroll((ydisp) => {
    // console.log("Scroll position:", ydisp)
    // })
    socket.addEventListener("open", () => {
      console.log("WebSocket connected")
      sdk.client.pty
        .update({
          ptyID: local.pty.id,
          size: {
            cols: t.cols,
            rows: t.rows,
          },
        })
        .catch(() => {})
    })
    socket.addEventListener("message", (event) => {
      t.write(event.data)
    })
    socket.addEventListener("error", (error) => {
      console.error("WebSocket error:", error)
      props.onConnectError?.(error)
    })
    socket.addEventListener("close", () => {
      console.log("WebSocket disconnected")
    })
  })

  onCleanup(() => {
    if (handleResize) {
      window.removeEventListener("resize", handleResize)
    }
    container.removeEventListener("pointerdown", handlePointerDown)
    term?.textarea?.removeEventListener("focus", handleTextareaFocus)
    term?.textarea?.removeEventListener("blur", handleTextareaBlur)

    const t = term
    if (serializeAddon && props.onCleanup && t) {
      const buffer = serializeAddon.serialize()
      props.onCleanup({
        ...local.pty,
        buffer,
        rows: t.rows,
        cols: t.cols,
        scrollY: t.getViewportY(),
      })
    }

    ws?.close()
    t?.dispose()
  })

  return (
    <div
      ref={container}
      data-component="terminal"
      data-prevent-autofocus
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
