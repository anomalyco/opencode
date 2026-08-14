import { EmbeddedTerminalRenderable } from "@opentui/core"
import { extend } from "@opentui/solid"
import { createSignal, onCleanup, onMount, Show } from "solid-js"
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

export function PersistentTerminalPane(props: { ptyID: string; autoFocus?: boolean }) {
  const client = useClient()
  const keymap = Keymap.use()
  const theme = useTheme()
  const [failure, setFailure] = createSignal<string>()
  const attachmentID = crypto.randomUUID()
  const pending: Uint8Array[] = []
  const output: Uint8Array[] = []
  let terminal: EmbeddedTerminalRenderable | undefined
  let socket: WebSocket | undefined
  let outputTimer: ReturnType<typeof setTimeout> | undefined
  let attached = false
  let disposed = false
  let size: { cols: number; rows: number } | undefined

  const send = (data: Uint8Array) => {
    if (attached && socket?.readyState === WebSocket.OPEN) {
      socket.send(data)
      return
    }
    pending.push(data)
  }

  const resize = () => {
    if (!attached || !size) return
    void client.api["server.persistentPty"]
      .update({ ptyID: props.ptyID, attachmentID, size })
      .catch((error) => setFailure(errorMessage(error)))
  }

  const writeOutput = (data: Uint8Array) => {
    output.push(data)
    if (outputTimer) return
    outputTimer = setTimeout(() => {
      outputTimer = undefined
      if (disposed) return
      terminal?.write(output.length === 1 ? output[0] : Buffer.concat(output))
      output.length = 0
    }, 16)
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

  onMount(() => {
    void connect().catch((error) => setFailure(errorMessage(error)))
  })

  onCleanup(() => {
    disposed = true
    if (outputTimer) clearTimeout(outputTimer)
    socket?.close()
    offKeys()
  })

  async function connect() {
    const endpoint = client.endpoint
    if (!endpoint) throw new Error("Persistent terminal server endpoint is unavailable")
    const snapshot = await client.api["server.persistentPty"].snapshot({ ptyID: props.ptyID })
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

    const next = new WebSocket(url)
    next.binaryType = "arraybuffer"
    next.addEventListener("message", (event) => {
      if (disposed) return
      if (event.data instanceof ArrayBuffer) {
        writeOutput(new Uint8Array(event.data))
        return
      }
      if (typeof event.data !== "string") return
      const message: unknown = JSON.parse(event.data)
      if (!message || typeof message !== "object" || !("type" in message) || message.type !== "attached") return
      attached = true
      pending.splice(0).forEach((data) => next.send(data))
      resize()
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
    <box flexGrow={1} minWidth={0} minHeight={0}>
      <Show when={!failure()} fallback={<text fg={theme.text.feedback.error.default}>{failure()}</text>}>
        <embeddedTerminal
          ref={(value) => {
            terminal = value
            if (props.autoFocus) value.focus()
          }}
          width="100%"
          height="100%"
          onData={(data, source) => {
            if (source === "input") send(data)
          }}
          onTerminalResize={(cols, rows) => {
            size = { cols, rows }
            resize()
          }}
        />
      </Show>
    </box>
  )
}
