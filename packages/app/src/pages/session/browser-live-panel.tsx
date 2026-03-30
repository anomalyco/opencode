import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { useLanguage } from "@/context/language"

/**
 * Browser Live View Panel — replaces the code editor / file tree / terminal.
 * Shows the agent-browser viewport stream on the right side of the session.
 *
 * agent-browser automatically starts a WebSocket server for viewport
 * streaming (typically ws://localhost:9223). This component connects
 * to that stream and renders it as a live view of what the browser
 * agent is doing.
 */
export function BrowserLivePanel() {
  const [url, setUrl] = createSignal("")
  const [connected, setConnected] = createSignal(false)
  const [screenshot, setScreenshot] = createSignal<string | undefined>()
  let canvas: HTMLCanvasElement | undefined
  let ws: WebSocket | undefined

  const WS_URL = "ws://localhost:9223"

  const connect = () => {
    try {
      ws = new WebSocket(WS_URL)
      ws.binaryType = "arraybuffer"

      ws.onopen = () => {
        setConnected(true)
      }

      ws.onmessage = (event) => {
        if (typeof event.data === "string") {
          // JSON message — could be URL update or metadata
          try {
            const msg = JSON.parse(event.data)
            if (msg.url) setUrl(msg.url)
          } catch {}
        } else {
          // Binary data — viewport frame (PNG/JPEG)
          renderFrame(event.data)
        }
      }

      ws.onclose = () => {
        setConnected(false)
        // Reconnect after 2s
        setTimeout(connect, 2000)
      }

      ws.onerror = () => {
        setConnected(false)
      }
    } catch {
      setConnected(false)
      setTimeout(connect, 3000)
    }
  }

  const renderFrame = (data: ArrayBuffer) => {
    if (!canvas) return

    const blob = new Blob([data], { type: "image/png" })
    const imgUrl = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      const ctx = canvas!.getContext("2d")
      if (!ctx) return
      canvas!.width = img.width
      canvas!.height = img.height
      ctx.drawImage(img, 0, 0)
      URL.revokeObjectURL(imgUrl)
    }
    img.src = imgUrl
  }

  onMount(() => {
    connect()
  })

  onCleanup(() => {
    if (ws) {
      ws.close()
      ws = undefined
    }
  })

  return (
    <div class="flex-1 flex flex-col min-h-0 bg-background-base border-l border-border-base">
      {/* URL bar */}
      <div class="flex items-center gap-2 px-3 py-1.5 bg-background-stronger border-b border-border-base shrink-0">
        <span
          class="text-12-medium"
          style={{ color: connected() ? "var(--color-accent-base)" : "var(--color-text-weak)" }}
        >
          ◆
        </span>
        <Show
          when={url()}
          fallback={
            <span class="text-12-regular text-text-weak truncate">
              {connected() ? "Browser connected" : "Waiting for browser..."}
            </span>
          }
        >
          <span class="text-12-regular text-text-weak truncate flex-1">{url()}</span>
        </Show>
        <span
          class="w-2 h-2 rounded-full shrink-0"
          style={{ background: connected() ? "var(--color-signal-success)" : "var(--color-text-weak)" }}
        />
      </div>

      {/* Viewport */}
      <div class="flex-1 min-h-0 overflow-hidden bg-black flex items-center justify-center relative">
        <Show
          when={connected()}
          fallback={
            <div class="flex flex-col items-center gap-4 text-center px-8">
              <div class="text-48-medium opacity-20" style={{ color: "var(--color-accent-base)" }}>
                ◆
              </div>
              <div class="text-14-regular text-text-weak">Give a task to start the browser</div>
              <div class="text-12-regular text-text-weak opacity-60">
                "Go to google.com and search for..."
              </div>
            </div>
          }
        >
          <canvas
            ref={(el) => (canvas = el)}
            class="max-w-full max-h-full object-contain"
          />
        </Show>
      </div>
    </div>
  )
}
