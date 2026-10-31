import { withAlpha } from "@opencode/ui/theme/color"
import { useTheme } from "@opencode/ui/theme/context"
import { resolveThemeVariant } from "@opencode/ui/theme/resolve"
import { resolveThemeVariantV2 } from "@opencode/ui/theme/v2/resolve"
import type { HexColor, ResolvedV2Theme } from "@opencode/ui/theme/types"
import { createPersistentPtyClient } from "@opencode/client/solid"
import type { FitAddon, Terminal as Term } from "ghostty-web"
import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js"
import { createKeyed, usePlugin } from "@opencode/plugin/gui"
import { uuid } from "@opencode/util/uuid"
import { terminalConnection, type TerminalFailure } from "./connection"
import type { TerminalProps } from "./props"
import { disposeIfDisposable, getHoveredLinkText, setOptionIfSupported } from "./runtime-adapters"
import { consumeTerminalMetaKey, terminalKeyInput } from "./terminal-key-event"
import { TerminalQuote } from "./quote"

type TerminalColors = {
  background: string
  foreground: string
  cursor: string
  selectionBackground: string
}

const DEFAULT_TERMINAL_COLORS = {
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
} as const satisfies Record<"light" | "dark", TerminalColors>

const isHexColor = (value: string): value is HexColor => value.startsWith("#")

const debugTerminal = (...values: unknown[]) => {
  if (!import.meta.env.DEV) return
  console.debug("[terminal]", ...values)
}

const resolveV2Token = (tokens: ResolvedV2Theme, key: string) => {
  let current = tokens[key]

  for (let i = 0; i < 8 && current; i++) {
    const match = /^var\(--([^)]+)\)$/.exec(current.trim())

    if (!match) {
      const hex = current.trim()

      if (/^#[0-9a-fA-F]{8}$/.test(hex)) return hex.slice(0, 7)

      return hex
    }

    current = tokens[match[1]]
  }
}

const useTerminalUiBindings = (input: {
  container: HTMLDivElement
  term: Term
  cleanups: VoidFunction[]
  handlePointerDown: () => void
  handleLinkClick: (event: MouseEvent) => void
  handleFocus: () => void
}) => {
  const handleCopy = (event: ClipboardEvent) => {
    const selection = input.term.getSelection()

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
    input.term.paste(text)
  }

  const handleTextareaFocus = () => {
    input.term.options.cursorBlink = true
    input.handleFocus()
  }

  const handleTextareaBlur = () => {
    input.term.options.cursorBlink = false
  }

  input.container.addEventListener("copy", handleCopy, true)
  input.cleanups.push(() => input.container.removeEventListener("copy", handleCopy, true))

  input.container.addEventListener("paste", handlePaste, true)
  input.cleanups.push(() => input.container.removeEventListener("paste", handlePaste, true))

  input.container.addEventListener("pointerdown", input.handlePointerDown)
  input.cleanups.push(() => input.container.removeEventListener("pointerdown", input.handlePointerDown))

  input.container.addEventListener("click", input.handleLinkClick, {
    capture: true,
  })
  input.cleanups.push(() =>
    input.container.removeEventListener("click", input.handleLinkClick, {
      capture: true,
    }),
  )

  input.term.textarea?.addEventListener("focus", handleTextareaFocus)
  input.term.textarea?.addEventListener("blur", handleTextareaBlur)
  input.cleanups.push(() => input.term.textarea?.removeEventListener("focus", handleTextareaFocus))
  input.cleanups.push(() => input.term.textarea?.removeEventListener("blur", handleTextareaBlur))
}

export const Terminal = (props: TerminalProps) => {
  const plugin = usePlugin()
  const appearance = plugin.appearance
  const keybinds = plugin.keybinds
  const system = plugin.system
  const desktop = plugin.desktop
  const theme = useTheme()
  let container!: HTMLDivElement

  // Intentional mount-time capture: each surface attaches to one terminal.
  const ptyID = props.ptyID
  const attachmentID = uuid()
  let socket: WebSocket | undefined
  let term: Term | undefined
  let fitAddon: FitAddon | undefined
  let measureFrame: number | undefined
  let sizeTimer: ReturnType<typeof setTimeout> | undefined
  let measured = false
  let revealed = false
  let disposed = false
  const cleanups: VoidFunction[] = []
  // The opened terminal, for the quote toolbar.
  const [opened, setOpened] = createSignal<Term>()
  const [written, setWritten] = createSignal(0)
  const [failure, setFailure] = createSignal<TerminalFailure>()

  const reveal = () => {
    if (revealed) return
    revealed = true
    container.style.opacity = "1"
  }

  const connection = terminalConnection({
    attachmentID,
    write: (data, done) => {
      if (disposed || !term) {
        done()

        return
      }

      term.write(data, () => {
        setWritten((value) => value + 1)
        done()
      })
      reveal()
    },
    resize: (size) => {
      if (!disposed) term?.resize(size.cols, size.rows)
    },
    send: (frame) => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(frame)
    },
    fail: (next) => {
      if (disposed) return
      setFailure(next)
      reveal()
      props.onFailure?.()

      if (next === "outdated") socket?.close(1000)
    },
  })

  const failureText = () => {
    const current = failure()

    if (current === "disconnected") return plugin.t("disconnected")

    if (current === "failed") return plugin.t("connectionFailed")

    if (current === "outdated") return plugin.t("serverOutdated")
  }

  const cleanup = () => {
    if (!cleanups.length) return
    const fns = cleanups.splice(0).reverse()

    for (const fn of fns) {
      try {
        fn()
      } catch (err) {
        debugTerminal("cleanup failed", err)
      }
    }
  }

  const getTerminalColors = (): TerminalColors => {
    const mode = theme.mode() === "dark" ? "dark" : "light"
    const fallback = DEFAULT_TERMINAL_COLORS[mode]
    const currentTheme = theme.themes()[theme.themeId()]

    if (!currentTheme) return fallback
    const variant = mode === "dark" ? currentTheme.dark : currentTheme.light

    if (!variant?.seeds && !variant?.palette) return fallback
    const resolved = resolveThemeVariant(variant, mode === "dark")
    const text = resolved["text-stronger"] ?? fallback.foreground

    const background =
      resolveV2Token(resolveThemeVariantV2(variant, mode === "dark"), "v2-background-bg-base") ?? fallback.background

    const alpha = mode === "dark" ? 0.25 : 0.2
    const base = isHexColor(text) ? text : fallback.foreground
    const selectionBackground = withAlpha(base, alpha)

    return {
      background,
      foreground: text,
      cursor: text,
      selectionBackground,
    }
  }

  const terminalColors = createMemo(getTerminalColors)

  // FitAddon.fit() would resize the emulator, which only ever takes the server's canonical size. The pane's size is
  // what this attachment asks for when it controls the terminal; changes after the first are debounced.
  const measure = () => {
    if (disposed || !fitAddon) return

    if (measureFrame !== undefined) return

    measureFrame = requestAnimationFrame(() => {
      measureFrame = undefined

      if (disposed) return
      const next = fitAddon?.proposeDimensions()

      if (!next) return

      if (!measured) {
        measured = true
        connection.size(next)

        return
      }

      if (sizeTimer !== undefined) clearTimeout(sizeTimer)
      sizeTimer = setTimeout(() => {
        sizeTimer = undefined

        if (!disposed) connection.size(next)
      }, 100)
    })
  }

  // The terminal follows the theme and font; it is created with the current ones, so changes before then wait.
  createKeyed(
    () => ({ colors: terminalColors(), mode: theme.mode() === "dark" ? "dark" : "light" }),
    (current) => {
      if (!term) return

      setOptionIfSupported(term, "theme", current.colors)
      setOptionIfSupported(term, "colorScheme", current.mode)
    },
  )

  createKeyed(
    () => appearance.font("mono"),
    (font) => {
      if (!term) return

      setOptionIfSupported(term, "fontFamily", font)
      measure()
    },
  )

  // A new zoom remeasures; the first value finds no fit addon yet.
  createKeyed(
    () => desktop?.zoom(),
    () => measure(),
  )

  const focusTerminal = () => {
    const t = term

    if (!t) return

    // A tab's rename field keeps focus, before and after a tick; it may take it before the terminal mounts. Other
    // fields, such as the command palette that created the terminal, give focus to it.
    const focus = () => {
      if (disposed) return

      const current = document.activeElement

      if (current instanceof HTMLInputElement && current.closest('[role="tablist"]')) return

      if (t.textarea) return t.textarea.focus({ preventScroll: true })

      t.focus()
    }

    focus()
    setTimeout(focus, 0)
  }

  const handlePointerDown = () => {
    const activeElement = document.activeElement

    if (activeElement instanceof HTMLElement && activeElement !== container && !container.contains(activeElement)) {
      activeElement.blur()
    }

    connection.interact()
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
    system.openExternal(text)
  }

  const connect = async () => {
    const server = props.server
    const snapshot = await server.client.experimental.persistentPty.snapshot({ ptyID })

    if (disposed) return
    connection.restore({ size: snapshot.info.size, checkpoint: snapshot.checkpoint })

    const next = await createPersistentPtyClient(server.client, { url: server.url }).connect({
      ptyID,
      cursor: snapshot.info.output.tail,
      attachmentID,
      takeover: true,
    })

    if (disposed) {
      next.close(1000)

      return
    }

    socket = next
    next.addEventListener("message", (event) => {
      if (disposed) return

      if (event.data instanceof ArrayBuffer) {
        connection.output(new Uint8Array(event.data))

        return
      }

      // The PTY client receives binary frames as ArrayBuffers, handled above; the rest are text.
      connection.message(String(event.data))
    })
    next.addEventListener("error", (event) => {
      if (disposed) return
      debugTerminal("websocket error", event)
      connection.error()
    })
    // The removal event closes the tab separately; keep the terminal visible until then.
    next.addEventListener("close", () => {
      if (!disposed) connection.close()
    })
  }

  onMount(() => {
    const run = async () => {
      const loaded = await props.ghostty()

      if (disposed) return

      const mod = loaded.mod
      const g = loaded.ghostty

      const t = new mod.Terminal({
        cursorBlink: true,
        cursorStyle: "bar",
        fontSize: 14,
        fontFamily: appearance.font("mono"),
        allowTransparency: false,
        convertEol: false,
        theme: terminalColors(),
        scrollback: 10_000,
        ghostty: g,
      })

      cleanups.push(() => t.dispose())

      if (disposed) {
        cleanup()

        return
      }

      term = t
      setOptionIfSupported(t, "colorScheme", theme.mode() === "dark" ? "dark" : "light")

      t.attachCustomKeyEventHandler((event) => {
        const key = event.key.toLowerCase()

        const input = terminalKeyInput(event)

        if (input) {
          t.input(input, true)

          return true
        }

        if (event.ctrlKey && event.shiftKey && !event.metaKey && key === "c") {
          document.execCommand("copy")

          return true
        }

        // allow for toggle terminal keybinds in parent
        if (keybinds.matches("terminal.toggle", event)) return true

        return consumeTerminalMetaKey(event, {
          paste: () => void document.execCommand("paste"),
          copy: () => t.hasSelection() && (document.execCommand("copy") || t.copySelection()),
        })
      })

      const fit = new mod.FitAddon()
      cleanups.push(() => disposeIfDisposable(fit))
      t.loadAddon(fit)
      fitAddon = fit

      const active = document.activeElement
      t.open(container)
      useTerminalUiBindings({
        container,
        term: t,
        cleanups,
        handlePointerDown,
        handleLinkClick,
        handleFocus: () => connection.interact(),
      })
      setOpened(t)

      // onAutoFocus consumes the request, which flips autoFocus, so read it once.
      const autoFocus = props.autoFocus === true

      if (autoFocus) {
        focusTerminal()
        props.onAutoFocus?.()
      }

      if (!autoFocus) {
        const restoreFocus = () => {
          const current = document.activeElement

          if (current !== container && !container.contains(current)) return
          t.blur()
          t.textarea?.blur()

          if (active instanceof HTMLElement && active.isConnected) active.focus()
        }

        restoreFocus()
        const timer = setTimeout(restoreFocus, 0)
        cleanups.push(() => clearTimeout(timer))
      }

      const onData = t.onData((data) => connection.input(data))
      cleanups.push(() => disposeIfDisposable(onData))

      const onKey = t.onKey((key) => {
        if (key.key == "Enter") {
          props.onSubmit?.()
        }
      })

      cleanups.push(() => disposeIfDisposable(onKey))

      const observer = new ResizeObserver(measure)
      observer.observe(container)
      cleanups.push(() => observer.disconnect())
      window.addEventListener("resize", measure)
      cleanups.push(() => window.removeEventListener("resize", measure))

      if (typeof document !== "undefined" && document.fonts) {
        void document.fonts.ready.then(measure)
      }

      measure()
      await connect()
    }

    void run().catch((err) => {
      if (disposed) return
      debugTerminal("failed to connect terminal", err)
      connection.error()
    })
  })

  onCleanup(() => {
    disposed = true

    if (measureFrame !== undefined) cancelAnimationFrame(measureFrame)

    if (sizeTimer !== undefined) clearTimeout(sizeTimer)

    if (socket && socket.readyState !== WebSocket.CLOSED && socket.readyState !== WebSocket.CLOSING) socket.close(1000)
    cleanup()
  })

  return (
    <>
      <div
        ref={container}
        data-component="terminal"
        dir="ltr"
        data-prevent-autofocus
        tabIndex={-1}
        style={{
          "background-color": terminalColors().background,
          "caret-color": "transparent",
          "font-family": appearance.font("mono"),
          opacity: 0,
        }}
        classList={{
          "select-text": true,
          "size-full px-6 py-3 relative overflow-hidden": true,
          [props.class ?? ""]: !!props.class,
        }}
      />
      <Show when={failureText()}>
        {(text) => (
          <div
            class="absolute inset-x-0 top-0 px-6 py-3 text-12-regular text-text-danger-base pointer-events-none"
            style={{ "background-color": terminalColors().background }}
          >
            {text()}
          </div>
        )}
      </Show>
      <Show when={props.quote}>
        {(target) => (
          <Show when={opened()}>
            {(term) => <TerminalQuote term={term()} container={container} target={target()} written={written()} />}
          </Show>
        )}
      </Show>
    </>
  )
}
