import { withAlpha } from "@opencode/ui/theme/color"
import { useTheme } from "@opencode/ui/theme/context"
import { resolveThemeVariant } from "@opencode/ui/theme/resolve"
import { resolveThemeVariantV2 } from "@opencode/ui/theme/v2/resolve"
import type { HexColor, ResolvedV2Theme } from "@opencode/ui/theme/types"
import { createPersistentPtyClient } from "@opencode/client/solid"
import type { FitAddon, Terminal as Term } from "ghostty-web"
import { createMemo, createSignal, onCleanup, onMount, Show, untrack } from "solid-js"
import { createKeyed, usePlugin } from "@opencode/plugin/gui"
import { uuid } from "@opencode/util/uuid"
import { terminalConnection } from "./connection"
import {
  createPaneDispatch,
  initialPaneState,
  paneFailure,
  paneRevealed,
  paneTerm,
  type PaneEffect,
  type PaneEvent,
  type PaneState,
} from "./pane-machine"
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

type Loaded = Awaited<ReturnType<TerminalProps["ghostty"]>>

/**
 * What the pane's effects hold between events; only `run` in `Terminal` changes them. `phaseTimer` bounds loading and
 * connecting, `connect` aborts the connect attempt and detaches its socket's listeners, and `cleanups` dispose the
 * emulator and its listeners.
 */
type PaneHandles = {
  phaseTimer?: ReturnType<typeof setTimeout>
  measureFrame?: number
  sizeTimer?: ReturnType<typeof setTimeout>
  focusTimer?: ReturnType<typeof setTimeout>
  connect?: AbortController
  socket?: WebSocket
  fit?: FitAddon
  cleanups: VoidFunction[]
}

const MEASURE_REQUESTED: PaneEvent<Loaded, Term> = { type: "measure.requested" }

const isHexColor = (value: string): value is HexColor => value.startsWith("#")

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
  const handles: PaneHandles = { cleanups: [] }
  const [paneState, setPaneState] = createSignal<PaneState<Term>>(initialPaneState)
  const [written, setWritten] = createSignal(0)

  const dispatch = createPaneDispatch<Loaded, Term>({
    read: () => untrack(paneState),
    write: (next) => setPaneState(next),
    run,
  })

  const measure = () => dispatch(MEASURE_REQUESTED)

  const connection = terminalConnection({
    attachmentID,
    write: (data, done) => {
      const current = untrack(paneState)
      const term = paneTerm(current)

      if (!term) {
        done()

        return
      }

      term.write(data, () => {
        setWritten((value) => value + 1)
        done()
      })

      if (!paneRevealed(current)) dispatch({ type: "screen.written" })
    },
    resize: (size) => {
      paneTerm(untrack(paneState))?.resize(size.cols, size.rows)
    },
    send: (frame) => {
      if (handles.socket?.readyState === WebSocket.OPEN) handles.socket.send(frame)
    },
    fail: (reason) => dispatch({ type: "connection.failed", failure: reason }),
  })

  const revealed = createMemo(() => paneRevealed(paneState()))
  const failure = createMemo(() => paneFailure(paneState()))
  const opened = createMemo(() => paneTerm(paneState()))

  const failureText = () => {
    const current = failure()

    if (current === "disconnected") return plugin.t("disconnected")

    if (current === "failed") return plugin.t("connectionFailed")

    if (current === "outdated") return plugin.t("serverOutdated")
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

  // The terminal follows the theme and font; it is created with the current ones, so changes before then wait.
  createKeyed(
    () => ({ colors: terminalColors(), mode: theme.mode() === "dark" ? "dark" : "light" }),
    (current) => {
      const term = paneTerm(untrack(paneState))

      if (!term) return

      setOptionIfSupported(term, "theme", current.colors)
      setOptionIfSupported(term, "colorScheme", current.mode)
    },
    { equals: (previous, next) => previous.colors === next.colors && previous.mode === next.mode },
  )

  createKeyed(
    () => appearance.font("mono"),
    (font) => {
      const term = paneTerm(untrack(paneState))

      if (!term) return

      setOptionIfSupported(term, "fontFamily", font)
      measure()
    },
  )

  // A new zoom remeasures; the pane ignores it until the terminal opened.
  createKeyed(
    () => desktop?.zoom(),
    () => measure(),
  )

  const focusTerminal = (t: Term) => {
    // A tab's rename field keeps focus, before and after a tick; it may take it before the terminal mounts. Other
    // fields, such as the command palette that created the terminal, give focus to it.
    const focus = () => {
      const current = document.activeElement

      if (current instanceof HTMLInputElement && current.closest('[role="tablist"]')) return

      if (t.textarea) return t.textarea.focus({ preventScroll: true })

      t.focus()
    }

    focus()
    clearTimeout(handles.focusTimer)
    handles.focusTimer = setTimeout(focus, 0)
  }

  const handlePointerDown = (t: Term) => {
    const activeElement = document.activeElement

    if (activeElement instanceof HTMLElement && activeElement !== container && !container.contains(activeElement)) {
      activeElement.blur()
    }

    connection.interact()
    focusTerminal(t)
  }

  const handleLinkClick = (t: Term, event: MouseEvent) => {
    if (!event.shiftKey && !event.ctrlKey && !event.metaKey) return

    if (event.altKey) return

    if (event.button !== 0) return

    const text = getHoveredLinkText(t)

    if (!text) return

    event.preventDefault()
    event.stopImmediatePropagation()
    system.openExternal(text)
  }

  function run(effect: PaneEffect<Loaded>) {
    if (effect.type === "load-ghostty") {
      handles.phaseTimer = setTimeout(() => dispatch({ type: "phase.timed-out", phase: "loading" }), effect.timeoutMs)
      void props.ghostty().then(
        (loaded) => dispatch({ type: "ghostty.loaded", loaded }),
        (cause: unknown) => {
          if (import.meta.env.DEV) console.debug("[terminal] failed to load ghostty-web", cause)
          dispatch({ type: "ghostty.failed" })
        },
      )

      return
    }

    if (effect.type === "cancel-phase-timer") {
      clearTimeout(handles.phaseTimer)
      handles.phaseTimer = undefined

      return
    }

    if (effect.type === "open-terminal") return open(effect.loaded)

    if (effect.type === "start-connect") {
      const controller = new AbortController()
      handles.connect = controller
      handles.phaseTimer = setTimeout(
        () => dispatch({ type: "phase.timed-out", phase: "connecting" }),
        effect.timeoutMs,
      )
      void connect(controller.signal).catch((cause: unknown) => {
        if (controller.signal.aborted) return

        if (import.meta.env.DEV) console.debug("[terminal] failed to connect terminal", cause)
        connection.error()
      })

      return
    }

    if (effect.type === "apply-size") return connection.size(effect.size)

    if (effect.type === "schedule-measure") {
      if (handles.measureFrame !== undefined) return
      handles.measureFrame = requestAnimationFrame(() => {
        handles.measureFrame = undefined
        dispatch({ type: "measure.sampled", proposed: handles.fit?.proposeDimensions() })
      })

      return
    }

    if (effect.type === "schedule-size-timer") {
      clearTimeout(handles.sizeTimer)
      handles.sizeTimer = setTimeout(() => {
        handles.sizeTimer = undefined
        dispatch({ type: "size.debounced", seq: effect.seq })
      }, effect.delayMs)

      return
    }

    if (effect.type === "cancel-size-timer") {
      clearTimeout(handles.sizeTimer)
      handles.sizeTimer = undefined

      return
    }

    if (effect.type === "notify-failure") return props.onFailure?.()

    stop()

    if (effect.type === "stop") return
    clearTimeout(handles.focusTimer)
    handles.focusTimer = undefined
    handles.fit = undefined
    handles.cleanups
      .splice(0)
      .reverse()
      .forEach((fn) => {
        try {
          fn()
        } catch (err) {
          if (import.meta.env.DEV) console.debug("[terminal] cleanup failed", err)
        }
      })
  }

  // Ends what is in flight: the phase timer, measurement, the connect attempt and its socket. The emulator stays.
  function stop() {
    clearTimeout(handles.phaseTimer)
    handles.phaseTimer = undefined

    if (handles.measureFrame !== undefined) cancelAnimationFrame(handles.measureFrame)
    handles.measureFrame = undefined
    clearTimeout(handles.sizeTimer)
    handles.sizeTimer = undefined
    // Aborting detaches the socket's listeners, so closing it reports nothing.
    handles.connect?.abort()
    handles.connect = undefined
    const socket = handles.socket
    handles.socket = undefined

    if (socket?.readyState === WebSocket.CONNECTING || socket?.readyState === WebSocket.OPEN) socket.close(1000)
  }

  function open(loaded: Loaded) {
    const mod = loaded.mod

    const t = new mod.Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontSize: 14,
      fontFamily: appearance.font("mono"),
      allowTransparency: false,
      convertEol: false,
      theme: terminalColors(),
      scrollback: 10_000,
      ghostty: loaded.ghostty,
    })

    handles.cleanups.push(() => t.dispose())
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
    handles.cleanups.push(() => disposeIfDisposable(fit))
    t.loadAddon(fit)
    handles.fit = fit

    const active = document.activeElement
    t.open(container)
    useTerminalUiBindings({
      container,
      term: t,
      cleanups: handles.cleanups,
      handlePointerDown: () => handlePointerDown(t),
      handleLinkClick: (event) => handleLinkClick(t, event),
      handleFocus: () => connection.interact(),
    })

    // onAutoFocus consumes the request, which flips autoFocus, so read it once, now that the terminal opened: the
    // panel may cancel a request it made while mounting this pane.
    const autoFocus = props.autoFocus === true

    if (autoFocus) {
      focusTerminal(t)
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
      handles.cleanups.push(() => clearTimeout(timer))
    }

    const onData = t.onData((data) => connection.input(data))
    handles.cleanups.push(() => disposeIfDisposable(onData))

    const onKey = t.onKey((key) => {
      if (key.key == "Enter") {
        props.onSubmit?.()
      }
    })

    handles.cleanups.push(() => disposeIfDisposable(onKey))

    // FitAddon.fit() would resize the emulator, which only ever takes the server's canonical size. The pane's size is
    // what this attachment asks for when it controls the terminal.
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    handles.cleanups.push(() => observer.disconnect())
    window.addEventListener("resize", measure)
    handles.cleanups.push(() => window.removeEventListener("resize", measure))
    void document.fonts.ready.then(measure)

    // The container is laid out once the emulator opened in it, so the first size goes out before the socket opens.
    dispatch({ type: "terminal.opened", term: t, initialSize: fit.proposeDimensions() })
  }

  async function connect(signal: AbortSignal) {
    const server = props.server
    const snapshot = await server.client.experimental.persistentPty.snapshot({ ptyID })

    if (signal.aborted) return
    connection.restore({ size: snapshot.info.size, checkpoint: snapshot.checkpoint })

    const socket = await createPersistentPtyClient(server.client, { url: server.url }).connect({
      ptyID,
      cursor: snapshot.info.output.tail,
      attachmentID,
      takeover: true,
    })

    if (signal.aborted) {
      socket.close(1000)

      return
    }

    handles.socket = socket
    socket.addEventListener("open", () => dispatch({ type: "socket.opened" }), { signal })
    socket.addEventListener(
      "message",
      (event) => {
        if (event.data instanceof ArrayBuffer) {
          connection.output(new Uint8Array(event.data))

          return
        }

        // The PTY client receives binary frames as ArrayBuffers, handled above; the rest are text.
        connection.message(String(event.data))
      },
      { signal },
    )
    socket.addEventListener(
      "error",
      (event) => {
        if (import.meta.env.DEV) console.debug("[terminal] websocket error", event)
        connection.error()
      },
      { signal },
    )
    // The removal event closes the tab separately; keep the terminal visible until then.
    socket.addEventListener("close", () => connection.close(), { signal })
  }

  onMount(() => dispatch({ type: "mounted" }))
  onCleanup(() => {
    connection.dispose()
    dispatch({ type: "disposed" })
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
          opacity: revealed() ? 1 : 0,
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
