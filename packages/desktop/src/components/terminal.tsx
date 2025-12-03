import { init, Terminal as Term, FitAddon } from "ghostty-web"
import { ComponentProps, onMount, splitProps } from "solid-js"
import { createReconnectingWS } from "@solid-primitives/websocket"
import { useSDK } from "@/context/sdk"

await init()

export interface TerminalProps extends ComponentProps<"div"> {
  id: string
}

export const Terminal = (props: TerminalProps) => {
  const sdk = useSDK()
  let container!: HTMLDivElement
  const [local, others] = splitProps(props, ["id", "class", "classList"])

  onMount(async () => {
    const ws = createReconnectingWS(sdk.url + `/pty/${local.id}/connect?directory=${encodeURIComponent(sdk.directory)}`)
    const term = new Term({
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

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(container)

    container.focus()

    fitAddon.fit()
    fitAddon.observeResize()
    window.addEventListener("resize", () => fitAddon.fit())
    term.onResize(async (size) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        await sdk.client.pty.update({
          path: { id: local.id },
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
    // term.onScroll((ydisp) => {
    // console.log("Scroll position:", ydisp)
    // })
    ws.addEventListener("open", () => {
      console.log("WebSocket connected")
      sdk.client.pty.update({
        path: { id: local.id },
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
    })
    ws.addEventListener("close", () => {
      console.log("WebSocket disconnected")
    })
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
