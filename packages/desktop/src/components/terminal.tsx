import { init, Terminal as Term, FitAddon } from "ghostty-web"
import { ComponentProps, onCleanup, onMount, splitProps } from "solid-js"
import { useSDK } from "@/context/sdk"
import { SerializeAddon } from "@/addons/serialize"
import { LocalPTY } from "@/context/session"

await init()

export interface TerminalProps extends ComponentProps<"div"> {
  pty: LocalPTY
  onSubmit?: () => void
  onCleanup?: (pty: LocalPTY) => void
  onConnectError?: (error: unknown) => void
}

export const Terminal = (props: TerminalProps) => {
  const sdk = useSDK()
  let container!: HTMLDivElement
  const [local, others] = splitProps(props, ["pty", "class", "classList", "onConnectError"])
  let ws: WebSocket
  let term: Term
  let serializeAddon: SerializeAddon
  let fitAddon: FitAddon

  onMount(async () => {
    ws = new WebSocket(sdk.url + `/pty/${local.pty.id}/connect?directory=${encodeURIComponent(sdk.directory)}`)
    term = new Term({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "TX-02, monospace",
      allowTransparency: true,
      theme: {
        background: "#191515",
        foreground: "#d4d4d4",
      },
      scrollback: 10_000,
    })
    term.attachCustomKeyEventHandler((event) => {
      // allow for ctrl-` to toggle terminal in parent
      if (event.ctrlKey && event.key.toLowerCase() === "`") {
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

    if (local.pty.buffer) {
      if (local.pty.rows && local.pty.cols) {
        term.resize(local.pty.cols, local.pty.rows)
      }
      term.reset()
      term.write(local.pty.buffer)
      if (local.pty.scrollY) {
        term.scrollToLine(local.pty.scrollY)
      }
    }

    container.focus()

    fitAddon.fit()
    fitAddon.observeResize()
    window.addEventListener("resize", () => fitAddon.fit())
    term.onResize(async (size) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        await sdk.client.pty.update({
          path: { id: local.pty.id },
          body: {
            size: {
              cols: size.cols,
              rows: size.rows,
            },
          },
        })
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
      sdk.client.pty.update({
        path: { id: local.pty.id },
        body: {
          size: {
            cols: term.cols,
            rows: term.rows,
          },
        },
      })
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
      classList={{
        ...(local.classList ?? {}),
        "size-full px-6 py-3 font-mono": true,
        [local.class ?? ""]: !!local.class,
      }}
      {...others}
    />
  )
}
