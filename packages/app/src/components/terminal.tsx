import { Ghostty, Terminal as Term, FitAddon } from "ghostty-web"
import { ComponentProps, createEffect, createSignal, onCleanup, onMount, splitProps } from "solid-js"
import { useSDK } from "@/context/sdk"
import { SerializeAddon } from "@/addons/serialize"
import { LocalPTY } from "@/context/terminal"
import { resolveThemeVariant, useTheme } from "@opencode-ai/ui/theme"

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
}

const DEFAULT_TERMINAL_COLORS: Record<"light" | "dark", TerminalColors> = {
  light: {
    background: "#fcfcfc",
    foreground: "#211e1e",
    cursor: "#211e1e",
  },
  dark: {
    background: "#191515",
    foreground: "#d4d4d4",
    cursor: "#d4d4d4",
  },
}

export const Terminal = (props: TerminalProps) => {
  const sdk = useSDK()
  const theme = useTheme()
  let container!: HTMLDivElement
  const [local, others] = splitProps(props, ["pty", "class", "classList", "onConnectError"])
  let ws: WebSocket
  let term: Term
  let ghostty: Ghostty
  let serializeAddon: SerializeAddon
  let fitAddon: FitAddon
  let handleResize: () => void

  const getTerminalColors = (): TerminalColors => {
    const mode = theme.mode()
    const fallback = DEFAULT_TERMINAL_COLORS[mode]
    const currentTheme = theme.themes()[theme.themeId()]
    if (!currentTheme) return fallback
    const variant = mode === "dark" ? currentTheme.dark : currentTheme.light
    if (!variant?.seeds) return fallback
    const resolved = resolveThemeVariant(variant, mode === "dark")
    const text = resolved["text-base"] ?? fallback.foreground
    const background = resolved["background-stronger"] ?? fallback.background
    return {
      background,
      foreground: text,
      cursor: text,
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

  const focusTerminal = () => term?.focus()
  const copySelection = () => {
    if (!term || !term.hasSelection()) return false
    const selection = term.getSelection()
    if (!selection) return false
    const clipboard = navigator.clipboard
    if (clipboard?.writeText) {
      clipboard.writeText(selection).catch(() => {})
      return true
    }
    if (!document.body) return false
    const textarea = document.createElement("textarea")
    textarea.value = selection
    textarea.setAttribute("readonly", "")
    textarea.style.position = "fixed"
    textarea.style.opacity = "0"
    document.body.appendChild(textarea)
    textarea.select()
    const copied = document.execCommand("copy")
    document.body.removeChild(textarea)
    return copied
  }
  const handlePointerDown = () => {
    const activeElement = document.activeElement
    if (activeElement instanceof HTMLElement && activeElement !== container) {
      activeElement.blur()
    }
    focusTerminal()
  }

  onMount(async () => {
    ghostty = await Ghostty.load()

    ws = new WebSocket(sdk.url + `/pty/${local.pty.id}/connect?directory=${encodeURIComponent(sdk.directory)}`)
    term = new Term({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "IBM Plex Mono, monospace",
      allowTransparency: true,
      theme: terminalColors(),
      scrollback: 10_000,
      ghostty,
    })
    term.attachCustomKeyEventHandler((event) => {
      const key = event.key.toLowerCase()
      if (key === "c") {
        const macCopy = event.metaKey && !event.ctrlKey && !event.altKey
        const linuxCopy = event.ctrlKey && event.shiftKey && !event.metaKey
        if ((macCopy || linuxCopy) && copySelection()) {
          event.preventDefault()
          return true
        }
      }
      // allow for ctrl-` to toggle terminal in parent
      if (event.ctrlKey && key === "`") {
        event.preventDefault()
        return true
      }
      return false
    })

    fitAddon = new FitAddon()
    serializeAddon = new SerializeAddon()
    term.loadAddon(serializeAddon)
    term.loadAddon(fitAddon)

    term.open(container)
    container.addEventListener("pointerdown", handlePointerDown)
    focusTerminal()

    if (local.pty.buffer) {
      if (local.pty.rows && local.pty.cols) {
        term.resize(local.pty.cols, local.pty.rows)
      }
      term.reset()
      term.write(local.pty.buffer)
      if (local.pty.scrollY) {
        term.scrollToLine(local.pty.scrollY)
      }
      fitAddon.fit()
    }

    fitAddon.observeResize()
    handleResize = () => fitAddon.fit()
    window.addEventListener("resize", handleResize)
    term.onResize(async (size) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
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
    term.onData((data) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(data)
      }
    })
    term.onKey((key) => {
      if (key.key == "Enter") {
        props.onSubmit?.()
      }
    })
    // term.onScroll((ydisp) => {
    // console.log("Scroll position:", ydisp)
    // })
    ws.addEventListener("open", () => {
      console.log("WebSocket connected")
      sdk.client.pty
        .update({
          ptyID: local.pty.id,
          size: {
            cols: term.cols,
            rows: term.rows,
          },
        })
        .catch(() => {})
    })
    ws.addEventListener("message", (event) => {
      term.write(event.data)
    })
    ws.addEventListener("error", (error) => {
      console.error("WebSocket error:", error)
      props.onConnectError?.(error)
    })
    ws.addEventListener("close", () => {
      console.log("WebSocket disconnected")
    })
  })

  onCleanup(() => {
    if (handleResize) {
      window.removeEventListener("resize", handleResize)
    }
    container.removeEventListener("pointerdown", handlePointerDown)
    if (serializeAddon && props.onCleanup) {
      const buffer = serializeAddon.serialize()
      props.onCleanup({
        ...local.pty,
        buffer,
        rows: term.rows,
        cols: term.cols,
        scrollY: term.getViewportY(),
      })
    }
    ws?.close()
    term?.dispose()
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
