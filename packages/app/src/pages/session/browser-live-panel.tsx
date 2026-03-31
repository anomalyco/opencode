import { createSignal, onCleanup, onMount, Show } from "solid-js"

/**
 * Browser Live View Panel — shows the Patchright-launched Chrome viewport.
 *
 * Connects directly to Chrome's CDP port (launched by Patchright) and uses
 * Page.screencastFrame to stream the browser viewport in real-time.
 * No agent-browser middleman — direct CDP connection to Chrome.
 *
 * Flow:
 * 1. Poll /browser/status API to get CDP port
 * 2. Fetch CDP WebSocket URL from http://localhost:{cdpPort}/json/version
 * 3. Connect to CDP WebSocket
 * 4. Send Page.startScreencast to begin receiving frames
 * 5. Render frames on canvas
 */
export function BrowserLivePanel() {
  const [url, setUrl] = createSignal("")
  const [connected, setConnected] = createSignal(false)
  let canvas: HTMLCanvasElement | undefined
  let ws: WebSocket | undefined
  let pollTimer: ReturnType<typeof setTimeout> | undefined
  let msgId = 1

  const DEFAULT_CDP_PORT = 9222

  /** Get CDP port from server API, fallback to default */
  async function getCdpPort(): Promise<number | undefined> {
    try {
      const res = await fetch("/api/browser/status")
      if (res.ok) {
        const data = await res.json()
        if (data.running && data.cdpPort) return data.cdpPort
      }
    } catch {}
    return undefined
  }

  /** Get the CDP WebSocket debugger URL from Chrome's /json/version endpoint */
  async function getCdpWsUrl(port: number): Promise<string | undefined> {
    try {
      const res = await fetch(`http://localhost:${port}/json/version`)
      if (res.ok) {
        const data = await res.json()
        return data.webSocketDebuggerUrl
      }
    } catch {}
    return undefined
  }

  /** Connect to Chrome via CDP and start screencast */
  async function connectCDP() {
    // Try API first, fallback to default port
    let port = await getCdpPort()
    if (!port) port = DEFAULT_CDP_PORT

    // Get CDP WebSocket URL
    const wsUrl = await getCdpWsUrl(port)
    if (!wsUrl) {
      // Chrome not ready yet — retry
      pollTimer = setTimeout(connectCDP, 2000)
      return
    }

    try {
      ws = new WebSocket(wsUrl)

      ws.onopen = () => {
        setConnected(true)

        // Start screencast — CDP will send Page.screencastFrame events
        ws!.send(
          JSON.stringify({
            id: msgId++,
            method: "Page.startScreencast",
            params: {
              format: "jpeg",
              quality: 80,
              maxWidth: 1280,
              maxHeight: 900,
              everyNthFrame: 1,
            },
          }),
        )

        // Also get current URL
        ws!.send(
          JSON.stringify({
            id: msgId++,
            method: "Runtime.evaluate",
            params: { expression: "location.href" },
          }),
        )

        // Enable page events to track URL changes
        ws!.send(
          JSON.stringify({
            id: msgId++,
            method: "Page.enable",
          }),
        )
      }

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)

          // Screencast frame from CDP
          if (msg.method === "Page.screencastFrame") {
            const { data, metadata, sessionId } = msg.params
            renderBase64Frame(data)

            if (metadata?.pageScaleFactor !== undefined) {
              // Update URL from metadata if available
            }

            // Acknowledge frame so Chrome sends the next one
            ws!.send(
              JSON.stringify({
                id: msgId++,
                method: "Page.screencastFrameAck",
                params: { sessionId },
              }),
            )
          }

          // URL navigation event
          if (msg.method === "Page.frameNavigated") {
            const frameUrl = msg.params?.frame?.url
            if (frameUrl && msg.params?.frame?.parentId === undefined) {
              setUrl(frameUrl)
            }
          }

          // Response to Runtime.evaluate (initial URL)
          if (msg.id && msg.result?.result?.value) {
            const val = msg.result.result.value
            if (typeof val === "string" && val.startsWith("http")) {
              setUrl(val)
            }
          }
        } catch {}
      }

      ws.onclose = () => {
        setConnected(false)
        ws = undefined
        // Reconnect after 2s
        pollTimer = setTimeout(connectCDP, 2000)
      }

      ws.onerror = () => {
        setConnected(false)
      }
    } catch {
      setConnected(false)
      pollTimer = setTimeout(connectCDP, 3000)
    }
  }

  /** Render a base64-encoded JPEG/PNG frame on the canvas */
  function renderBase64Frame(base64Data: string) {
    if (!canvas) return

    const img = new Image()
    img.onload = () => {
      const ctx = canvas!.getContext("2d")
      if (!ctx) return
      canvas!.width = img.width
      canvas!.height = img.height
      ctx.drawImage(img, 0, 0)
    }
    img.src = `data:image/jpeg;base64,${base64Data}`
  }

  onMount(() => {
    connectCDP()
  })

  onCleanup(() => {
    if (pollTimer) clearTimeout(pollTimer)
    if (ws) {
      // Stop screencast before closing
      try {
        ws.send(
          JSON.stringify({
            id: msgId++,
            method: "Page.stopScreencast",
          }),
        )
      } catch {}
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
