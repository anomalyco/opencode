import { CliRenderEvents, EmbeddedTerminalRenderable, type RGBA } from "@opentui/core"
import type { ResolvedThemeTokens } from "@opencode-ai/theme/tui"
import { extend, useRenderer } from "@opentui/solid"
import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js"
import { useClient } from "../context/client"
import { Keymap } from "../context/keymap"
import { useTheme, useThemes } from "../context/theme"
import { errorMessage } from "../util/error"

declare module "@opentui/solid" {
  interface OpenTUIComponents {
    embeddedTerminal: typeof EmbeddedTerminalRenderable
  }
}

extend({ embeddedTerminal: EmbeddedTerminalRenderable })

type TerminalSize = { cols: number; rows: number }
type StreamItem =
  | { type: "output"; data: Uint8Array }
  | { type: "resize"; size: TerminalSize; checkpoint?: Uint8Array }
  | { type: "ready" }

export function TerminalPane(props: {
  ptyID: string
  autoFocus?: boolean
  onAutoFocus?: () => void
  onFocusRequest?: (focus: (() => void) | undefined) => void
  onDisconnect?: () => void
  onFocusChange?: (focused: boolean) => void
}) {
  const client = useClient()
  const keymap = Keymap.use()
  const leader = Keymap.useLeaderActive()
  const theme = useTheme("elevated")
  const themes = useThemes()
  const renderer = useRenderer()
  const [failure, setFailure] = createSignal<string>()
  const attachmentID = crypto.randomUUID()
  const stream: StreamItem[] = []
  const pendingInput: Uint8Array[] = []
  let terminal: EmbeddedTerminalRenderable | undefined
  let socket: WebSocket | undefined
  let attached = false
  let controller = false
  let restored = false
  let wantsControl = false
  let disposed = false
  let size: TerminalSize | undefined
  let canonicalSize: TerminalSize | undefined
  let terminalSize: TerminalSize | undefined
  let lastIntermediateRender = 0
  let terminalTheme: Uint8Array | undefined
  let waitingSize: { size: TerminalSize; resolve: () => void } | undefined

  const setCanonicalSize = (value: TerminalSize) => {
    canonicalSize = value
    if (!terminal) return
    terminal.width = value.cols
    terminal.height = value.rows
  }

  const applyTerminalTheme = () => {
    if (terminalTheme) terminal?.write(terminalTheme)
  }

  const send = (data: Uint8Array) => {
    if (attached && socket?.readyState === WebSocket.OPEN) socket.send(data)
  }

  const interact = () => {
    if (!restored) {
      wantsControl = true
      return
    }
    if (!size) return
    send(interactionFrame(size))
  }

  const sendInput = (data: Uint8Array) => {
    if (!restored) {
      pendingInput.push(data)
      return
    }
    if (size) send(interactionFrame(size, data))
  }

  const processStream = () => {
    if (disposed || !terminal || !sameSize(canonicalSize, terminalSize)) return
    while (stream.length > 0) {
      const item = stream[0]!
      if (item.type === "output") {
        stream.shift()
        const output = [item.data]
        while (true) {
          const next = stream[0]
          if (!next || next.type !== "output") break
          output.push(next.data)
          stream.shift()
        }
        terminal.write(output.length === 1 ? output[0] : Buffer.concat(output))
        continue
      }
      if (item.type === "resize") {
        setCanonicalSize(item.size)
        if (!sameSize(canonicalSize, terminalSize)) return
        stream.shift()
        if (item.checkpoint) {
          terminal.write(Buffer.concat([Buffer.from("\x1bc"), Buffer.from(item.checkpoint)]))
          applyTerminalTheme()
        }
        continue
      }
      stream.shift()
      restored = true
      const input = pendingInput.splice(0)
      if (input.length > 0) input.forEach(sendInput)
      if (input.length === 0 && (controller || wantsControl)) interact()
      wantsControl = false
    }
  }

  const enqueue = (item: StreamItem) => {
    stream.push(item)
    processStream()
  }

  const waitForTerminalSize = (value: TerminalSize) => {
    if (sameSize(value, terminalSize)) return Promise.resolve()
    return new Promise<void>((resolve) => {
      waitingSize = { size: value, resolve }
    })
  }

  const offKeys = keymap.intercept(
    "key",
    ({ event }) => {
      if (!terminal?.focused) return
      if (keymap.isLeader(event) || leader()) return
      event.preventDefault()
      event.stopPropagation()
      terminal.handleKeyPress(event)
    },
    { priority: 100 },
  )
  const onFocused = () => props.onFocusChange?.(terminal?.focused === true)
  renderer.on(CliRenderEvents.FOCUSED_RENDERABLE, onFocused)
  createEffect(() => {
    if (!props.autoFocus || !terminal) return
    terminal.focus()
    props.onAutoFocus?.()
  })

  createEffect(() => {
    const tokens = themes.currentTokens().contextual.elevated
    terminalTheme = terminalPalette(tokens, themes.mode(), tokens.background.default)
    applyTerminalTheme()
  })

  onMount(() => {
    void connect().catch((error) => setFailure(errorMessage(error)))
  })

  onCleanup(() => {
    disposed = true
    waitingSize?.resolve()
    socket?.close()
    offKeys()
    renderer.off(CliRenderEvents.FOCUSED_RENDERABLE, onFocused)
    props.onFocusChange?.(false)
    props.onFocusRequest?.(undefined)
  })

  async function connect() {
    const snapshot = await client.api.experimental.persistentPty.snapshot({ ptyID: props.ptyID })
    if (disposed) return
    setCanonicalSize(snapshot.info.size)
    await waitForTerminalSize(snapshot.info.size)
    if (disposed) return
    terminal?.write(Buffer.from(snapshot.checkpoint, "base64"))
    applyTerminalTheme()
    const next = await client.persistentPty.connect({
      ptyID: props.ptyID,
      cursor: snapshot.info.output.tail,
      attachmentID,
      takeover: true,
    })
    if (disposed) {
      next.close()
      return
    }
    next.addEventListener("message", (event) => {
      if (disposed) return
      if (event.data instanceof ArrayBuffer) {
        enqueue({ type: "output", data: new Uint8Array(event.data) })
        const now = performance.now()
        if (now - lastIntermediateRender >= 16) {
          lastIntermediateRender = now
          renderer.intermediateRender()
        }
        return
      }
      if (typeof event.data !== "string") return
      const message: unknown = JSON.parse(event.data)
      if (!message || typeof message !== "object" || !("type" in message)) return
      if (
        message.type === "resized" &&
        "cols" in message &&
        typeof message.cols === "number" &&
        "rows" in message &&
        typeof message.rows === "number" &&
        "checkpoint" in message &&
        typeof message.checkpoint === "string"
      ) {
        enqueue({
          type: "resize",
          size: { cols: message.cols, rows: message.rows },
          checkpoint: Buffer.from(message.checkpoint, "base64"),
        })
        return
      }
      if (message.type === "replay_complete") {
        enqueue({ type: "ready" })
        return
      }
      if (
        message.type === "controller_changed" &&
        "attachmentID" in message &&
        (typeof message.attachmentID === "string" || message.attachmentID === undefined)
      ) {
        const previous = controller
        controller = message.attachmentID === attachmentID
        if (controller && !previous && restored) interact()
        return
      }
      if (message.type !== "attached") return
      if (!("inputProtocol" in message) || message.inputProtocol !== 1) {
        setFailure("Persistent terminal server is out of date; restart OpenCode")
        next.close()
        return
      }
      if (
        "info" in message &&
        message.info &&
        typeof message.info === "object" &&
        "size" in message.info &&
        message.info.size &&
        typeof message.info.size === "object" &&
        "cols" in message.info.size &&
        typeof message.info.size.cols === "number" &&
        "rows" in message.info.size &&
        typeof message.info.size.rows === "number"
      )
        enqueue({ type: "resize", size: { cols: message.info.size.cols, rows: message.info.size.rows } })
      controller = "role" in message && message.role === "controller"
      attached = true
    })
    next.addEventListener("error", () => {
      if (disposed) return
      const focused = terminal?.focused
      terminal = undefined
      setFailure("Terminal connection failed")
      if (focused) props.onDisconnect?.()
    })
    next.addEventListener("close", () => {
      if (disposed) return
      const focused = terminal?.focused
      terminal = undefined
      setFailure("Terminal disconnected")
      if (focused) props.onDisconnect?.()
    })
    socket = next
  }

  return (
    <box
      flexGrow={1}
      minWidth={0}
      minHeight={0}
      overflow="hidden"
      backgroundColor={themes.currentTokens().contextual.elevated.background.default}
      onSizeChange={function () {
        size = { cols: Math.max(1, this.width - 2), rows: this.height }
        if (controller && restored) interact()
      }}
      // TODO: Revisit when embedded terminal mouse handlers can compose without replacing its internal focus handler.
      onMouseDown={() => interact()}
    >
      <Show when={!failure()} fallback={<text fg={theme.text.feedback.error.default}>{failure()}</text>}>
        <>
          <embeddedTerminal
            ref={(value) => {
              terminal = value
              props.onFocusRequest?.(() => {
                value.focus()
                interact()
              })
              terminalSize = { cols: 80, rows: 24 }
              if (canonicalSize) {
                value.width = canonicalSize.cols
                value.height = canonicalSize.rows
              }
              applyTerminalTheme()
            }}
            position="absolute"
            left={1}
            top={0}
            width={80}
            height={24}
            onData={(data, source) => {
              if (source === "input") sendInput(data)
            }}
            onTerminalResize={(cols, rows) => {
              terminalSize = { cols, rows }
              if (waitingSize && sameSize(waitingSize.size, terminalSize)) {
                waitingSize.resolve()
                waitingSize = undefined
              }
              processStream()
            }}
          />
        </>
      </Show>
    </box>
  )
}

function sameSize(first: TerminalSize | undefined, second: TerminalSize | undefined) {
  return !!first && !!second && first.cols === second.cols && first.rows === second.rows
}

function terminalPalette(theme: ResolvedThemeTokens, mode: "dark" | "light", background: RGBA) {
  const base = mode === "dark" ? 500 : 700
  const bright = mode === "dark" ? 300 : 500
  const colors = [
    background,
    theme.text.feedback.error.default,
    theme.text.feedback.success.default,
    theme.text.feedback.warning.default,
    theme.hue.blue[base],
    theme.hue.purple[base],
    theme.text.feedback.info.default,
    theme.text.default,
    theme.text.subdued,
    theme.text.feedback.error.subdued,
    theme.text.feedback.success.subdued,
    theme.text.feedback.warning.subdued,
    theme.hue.blue[bright],
    theme.hue.purple[bright],
    theme.hue.cyan[bright],
    theme.hue.neutral[mode === "dark" ? 100 : 900],
  ]
  return Buffer.from(
    colors
      .map((color, index) => `\x1b]4;${index};${hex(color)}\x1b\\`)
      .concat(`\x1b]10;${hex(theme.text.default)}\x1b\\`, `\x1b]11;${hex(background)}\x1b\\`)
      .join(""),
  )
}

function hex(color: RGBA) {
  return `#${color
    .toInts()
    .slice(0, 3)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`
}

function interactionFrame(size: { cols: number; rows: number }, data?: Uint8Array) {
  const frame = new Uint8Array(5 + (data?.byteLength ?? 0))
  const view = new DataView(frame.buffer)
  frame[0] = data ? 1 : 0
  view.setUint16(1, size.cols)
  view.setUint16(3, size.rows)
  if (data) frame.set(data, 5)
  return frame
}
