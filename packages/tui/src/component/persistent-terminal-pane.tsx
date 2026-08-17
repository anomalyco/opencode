import { EmbeddedTerminalRenderable } from "@opentui/core"
import { extend, useRenderer } from "@opentui/solid"
import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js"
import { useClient } from "../context/client"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
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

export function PersistentTerminalPane(props: { ptyID: string; autoFocus?: boolean; onAutoFocus?: () => void }) {
  const client = useClient()
  const keymap = Keymap.use()
  const theme = useTheme()
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
  let waitingSize: { size: TerminalSize; resolve: () => void } | undefined

  const setCanonicalSize = (value: TerminalSize) => {
    canonicalSize = value
    if (!terminal) return
    terminal.width = value.cols
    terminal.height = value.rows
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
        if (item.checkpoint)
          terminal.write(Buffer.concat([Buffer.from("\x1bc"), Buffer.from(item.checkpoint)]))
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
      event.preventDefault()
      event.stopPropagation()
      terminal.handleKeyPress(event)
    },
    { priority: 100 },
  )

  createEffect(() => {
    if (!props.autoFocus || !terminal) return
    terminal.focus()
    props.onAutoFocus?.()
  })

  onMount(() => {
    void connect().catch((error) => setFailure(errorMessage(error)))
  })

  onCleanup(() => {
    disposed = true
    waitingSize?.resolve()
    socket?.close()
    offKeys()
  })

  async function connect() {
    const endpoint = client.endpoint
    if (!endpoint) throw new Error("Persistent terminal server endpoint is unavailable")
    const snapshot = await client.api["server.persistentPty"].snapshot({ ptyID: props.ptyID })
    if (disposed) return
    setCanonicalSize(snapshot.info.size)
    await waitForTerminalSize(snapshot.info.size)
    if (disposed) return
    terminal?.write(Buffer.from(snapshot.checkpoint, "base64"))
    const token = await client.api["server.persistentPty"].connectToken(
      { ptyID: props.ptyID },
      { headers: { "x-opencode-ticket": "1" } },
    )
    if (disposed) return
    const url = new URL(`/api/persistent-pty/${encodeURIComponent(props.ptyID)}/connect`, endpoint.url)
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
    url.searchParams.set("ticket", token.ticket)
    url.searchParams.set("cursor", String(snapshot.info.output.tail))
    url.searchParams.set("attachment_id", attachmentID)
    url.searchParams.set("takeover", "true")
    url.searchParams.set("input_protocol", "1")

    const next = new WebSocket(url)
    next.binaryType = "arraybuffer"
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
      if (!disposed) setFailure("Terminal connection failed")
    })
    next.addEventListener("close", () => {
      if (!disposed) setFailure("Terminal disconnected")
    })
    socket = next
  }

  return (
    <box
      flexGrow={1}
      minWidth={0}
      minHeight={0}
      overflow="hidden"
      onSizeChange={function () {
        size = { cols: this.width, rows: this.height }
        if (controller && restored) interact()
      }}
      // TODO: Revisit when embedded terminal mouse handlers can compose without replacing its internal focus handler.
      onMouseDown={() => interact()}
    >
      <Show when={!failure()} fallback={<text fg={theme.text.feedback.error.default}>{failure()}</text>}>
        <embeddedTerminal
          ref={(value) => {
            terminal = value
            terminalSize = { cols: 80, rows: 24 }
            if (canonicalSize) {
              value.width = canonicalSize.cols
              value.height = canonicalSize.rows
            }
          }}
          position="absolute"
          left={0}
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
      </Show>
    </box>
  )
}

function sameSize(first: TerminalSize | undefined, second: TerminalSize | undefined) {
  return !!first && !!second && first.cols === second.cols && first.rows === second.rows
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
