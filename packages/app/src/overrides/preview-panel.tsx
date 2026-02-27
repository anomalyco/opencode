import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { PREVIEW_URL, PLACEHOLDER_HTML } from "./preview-panel-helpers"

const [previewOpen, setPreviewOpen] = createSignal(false)
const [previewWidth, setPreviewWidth] = createSignal(480)
const [previewLoaded, setPreviewLoaded] = createSignal(false)

export { previewOpen, setPreviewOpen, previewWidth }

const POLL_INTERVAL = 3000
const MAX_POLLS = 20

function RefreshIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" class="size-4 text-icon-base">
      <path
        d="M14.5 3.5C13.2 2.6 11.7 2 10 2C5.6 2 2 5.6 2 10s3.6 8 8 8 8-3.6 8-8"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
      />
      <path d="M18 2v4h-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  )
}

export function PreviewPanel(props: { open: boolean }) {
  let iframeRef: HTMLIFrameElement | undefined
  let pollTimer: ReturnType<typeof setInterval> | undefined
  let pollCount = 0

  const sendStateToIframe = (state: string) => {
    iframeRef?.contentWindow?.postMessage({ state }, "*")
  }

  const stopPolling = () => {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = undefined
    }
  }

  const loadPreview = () => {
    stopPolling()
    if (iframeRef) {
      setPreviewLoaded(true)
      iframeRef.removeAttribute("srcdoc")
      iframeRef.src = PREVIEW_URL
    }
  }

  const checkReady = async () => {
    pollCount++
    if (pollCount > MAX_POLLS) {
      stopPolling()
      sendStateToIframe("timeout")
      return
    }
    try {
      const res = await fetch(PREVIEW_URL + "?_t=" + Date.now(), {
        method: "HEAD",
        credentials: "include",
      })
      if (res.ok) {
        loadPreview()
      }
    } catch {
      // not ready yet
    }
  }

  const startPolling = () => {
    stopPolling()
    pollCount = 0
    sendStateToIframe("loading")
    pollTimer = setInterval(checkReady, POLL_INTERVAL)
  }

  const onMessage = (e: MessageEvent) => {
    if (e.data?.type === "preview-start") {
      window.dispatchEvent(new CustomEvent("preview-run"))
      startPolling()
    } else if (e.data?.type === "preview-retry") {
      startPolling()
    } else if (e.data?.type === "preview-refresh") {
      loadPreview()
    }
  }

  const refresh = () => {
    if (previewLoaded()) {
      if (iframeRef) iframeRef.src = PREVIEW_URL
    } else {
      loadPreview()
    }
  }

  onMount(() => window.addEventListener("message", onMessage))
  onCleanup(() => {
    window.removeEventListener("message", onMessage)
    stopPolling()
  })

  return (
    <Show when={props.open}>
      <aside
        class="relative shrink-0 h-full border-l border-border-weak-base flex flex-col bg-background-stronger"
        style={{ width: `${previewWidth()}px` }}
      >
        <div class="flex items-center justify-between px-3 h-10 shrink-0 border-b border-border-weak-base">
          <span class="text-14-medium text-text-strong">Preview</span>
          <div class="flex items-center gap-1">
            <button
              class="flex items-center justify-center h-6 w-6 rounded-sm hover:bg-surface-base transition-colors"
              onClick={refresh}
              aria-label="Refresh preview"
            >
              <RefreshIcon />
            </button>
            <IconButton
              icon="close-small"
              variant="ghost"
              class="h-6 w-6"
              onClick={() => setPreviewOpen(false)}
              aria-label="Close preview"
            />
          </div>
        </div>
        <iframe
          ref={iframeRef}
          srcdoc={previewLoaded() ? undefined : PLACEHOLDER_HTML}
          src={previewLoaded() ? PREVIEW_URL : undefined}
          class="flex-1 w-full border-0"
          title="App preview"
        />
        <ResizeHandle
          direction="horizontal"
          edge="start"
          size={previewWidth()}
          min={300}
          max={800}
          onResize={setPreviewWidth}
        />
      </aside>
    </Show>
  )
}
