import { createSignal, createEffect, Show, For, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { IconButton } from "@cedric/ui/icon-button"
import { Tooltip } from "@cedric/ui/tooltip"

interface Annotation {
  id: string
  type: "highlight" | "note"
  url: string
  text?: string
  note?: string
  timestamp: number
}

type BrowserWebview = HTMLElement & {
  canGoBack: () => boolean
  canGoForward: () => boolean
  getWebContentsId: () => number
  goBack: () => void
  goForward: () => void
  loadURL: (url: string) => Promise<void>
  reload: () => void
}

type BrowserNavigationEvent = Event & { url: string }
type BrowserPageTitleEvent = Event & { title: string }
type BrowserFailLoadEvent = Event & { errorCode: number; errorDescription: string }
type BrowserNewWindowEvent = Event & { url: string }

declare global {
  interface HTMLElementTagNameMap {
    webview: HTMLElement
  }
}

export function BrowserPanel() {
  const [url, setUrl] = createSignal("https://www.google.com")
  const [currentUrl, setCurrentUrl] = createSignal("https://www.google.com")
  const [canGoBack, setCanGoBack] = createSignal(false)
  const [canGoForward, setCanGoForward] = createSignal(false)
  const [isLoading, setIsLoading] = createSignal(false)
  const [annotationsOpen, setAnnotationsOpen] = createSignal(false)
  const [annotations, setAnnotations] = createStore<Annotation[]>([])
  const [title, setTitle] = createSignal("")
  const [automationMode, setAutomationMode] = createSignal(false)

  let webviewRef!: BrowserWebview

  const navigate = (targetUrl: string) => {
    if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
      targetUrl = "https://" + targetUrl
    }
    setCurrentUrl(targetUrl)
    if (webviewRef) {
      webviewRef.loadURL(targetUrl)
    }
  }

  const goBack = () => {
    if (webviewRef && webviewRef.canGoBack()) {
      webviewRef.goBack()
    }
  }

  const goForward = () => {
    if (webviewRef && webviewRef.canGoForward()) {
      webviewRef.goForward()
    }
  }

  const reload = () => {
    if (webviewRef) {
      webviewRef.reload()
    }
  }

  const addAnnotation = (type: "highlight" | "note", text: string, note?: string) => {
    const annotation: Annotation = {
      id: Date.now().toString(),
      type,
      url: currentUrl(),
      text,
      note,
      timestamp: Date.now(),
    }
    setAnnotations(annotations.length, annotation)
  }

  const runAutomation = async (action: string, params?: Record<string, unknown>) => {
    try {
      return await window.api?.browserAutomation?.(action, params)
    } catch (e) {
      console.error("Automation error:", e)
      return null
    }
  }

  const getPageInfo = async () => {
    await runAutomation("getPageInfo")
  }

  createEffect(() => {
    if (!webviewRef) return

    // Register this webview for automation with retry
    const tryRegister = () => {
      if (window.api?.setActiveWebview && webviewRef.getWebContentsId) {
        try {
          const id = webviewRef.getWebContentsId()
          void window.api.setActiveWebview(id)
          return true
        } catch (e) {
          console.error("[BrowserPanel] Failed to register webview:", e)
          return false
        }
      }
      return false
    }

    // Try immediately
    if (!tryRegister()) {
      // Retry after a short delay if not ready
      setTimeout(tryRegister, 500)
      setTimeout(tryRegister, 1500)
    }

    const handleDidNavigate = (event: BrowserNavigationEvent) => {
      setCurrentUrl(event.url)
      setCanGoBack(webviewRef.canGoBack())
      setCanGoForward(webviewRef.canGoForward())
    }

    const handleDidStartLoading = () => {
      setIsLoading(true)
    }

    const handleDidStopLoading = () => {
      setIsLoading(false)
      setCanGoBack(webviewRef.canGoBack())
      setCanGoForward(webviewRef.canGoForward())
    }

    const handlePageTitleUpdated = (event: BrowserPageTitleEvent) => {
      setTitle(event.title)
    }

    const handleDidFailLoad = (event: BrowserFailLoadEvent) => {
      if (event.errorCode !== -3) { // Ignore aborted loads
        console.error("Browser failed to load:", event.errorDescription)
      }
      setIsLoading(false)
    }

    const handleNewWindow = (event: BrowserNewWindowEvent) => {
      event.preventDefault()
      navigate(event.url)
    }

    webviewRef.addEventListener("did-navigate", handleDidNavigate as EventListener)
    webviewRef.addEventListener("did-start-loading", handleDidStartLoading)
    webviewRef.addEventListener("did-stop-loading", handleDidStopLoading)
    webviewRef.addEventListener("page-title-updated", handlePageTitleUpdated as EventListener)
    webviewRef.addEventListener("did-fail-load", handleDidFailLoad as EventListener)
    webviewRef.addEventListener("new-window", handleNewWindow as EventListener)

    onCleanup(() => {
      try {
        void window.api?.clearActiveWebview?.(webviewRef.getWebContentsId())
      } catch {
        // Ignore stale webview ids during teardown.
      }
      webviewRef.removeEventListener("did-navigate", handleDidNavigate as EventListener)
      webviewRef.removeEventListener("did-start-loading", handleDidStartLoading)
      webviewRef.removeEventListener("did-stop-loading", handleDidStopLoading)
      webviewRef.removeEventListener("page-title-updated", handlePageTitleUpdated as EventListener)
      webviewRef.removeEventListener("did-fail-load", handleDidFailLoad as EventListener)
      webviewRef.removeEventListener("new-window", handleNewWindow as EventListener)
    })
  })

  return (
    <div class="flex flex-col h-full bg-background-base">
      {/* Toolbar */}
      <div class="flex items-center gap-1.5 px-2 py-1.5 border-b border-border-weaker-base shrink-0">
        <Tooltip value="Back">
          <IconButton
            icon="chevron-left"
            variant="ghost"
            size="small"
            class="size-6"
            onClick={goBack}
            disabled={!canGoBack()}
          />
        </Tooltip>
        <Tooltip value="Forward">
          <IconButton
            icon="chevron-right"
            variant="ghost"
            size="small"
            class="size-6"
            onClick={goForward}
            disabled={!canGoForward()}
          />
        </Tooltip>
        <Tooltip value="Reload">
          <IconButton
            icon="reset"
            variant="ghost"
            size="small"
            class="size-6"
            onClick={reload}
          />
        </Tooltip>
        <div class="flex-1 flex items-center">
          <input
            type="text"
            value={currentUrl()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                navigate(e.currentTarget.value)
              }
            }}
            onChange={(e) => setCurrentUrl(e.currentTarget.value)}
            class="w-full px-2 py-1 text-13-regular bg-background-stronger rounded-md border border-border-weaker-base focus:outline-none focus:border-border-base text-text-base"
            placeholder="Enter URL..."
          />
        </div>
        <Show when={isLoading()}>
          <div class="text-12-regular text-text-weak shrink-0 animate-pulse">Loading...</div>
        </Show>
        <Tooltip value="Annotations">
          <IconButton
            icon="comment"
            variant="ghost"
            size="small"
            class="size-6"
            classList={{ "text-icon-info-active": annotationsOpen() }}
            onClick={() => setAnnotationsOpen(!annotationsOpen())}
          />
        </Tooltip>
        <Tooltip value="AI Automation">
          <IconButton
            icon="brain"
            variant="ghost"
            size="small"
            class="size-6"
            classList={{ "text-icon-info-active": automationMode() }}
            onClick={() => {
              setAutomationMode(!automationMode())
              if (!automationMode()) {
                getPageInfo()
              }
            }}
          />
        </Tooltip>
      </div>

      <div class="flex flex-1 min-h-0">
        {/* Main content */}
        <div class="flex-1 min-w-0 relative">
          <webview
            ref={webviewRef}
            src={url()}
            class="w-full h-full"
            useragent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            allowpopups={false}
          ></webview>
        </div>

        {/* Annotations panel */}
        <Show when={annotationsOpen()}>
          <div class="w-64 border-l border-border-weaker-base bg-background-stronger flex flex-col shrink-0">
            <div class="px-3 py-2 border-b border-border-weaker-base shrink-0">
              <div class="text-14-semibold text-text-base">Annotations</div>
              <div class="text-12-regular text-text-weak">{annotations.length} saved</div>
            </div>
            <div class="flex-1 overflow-y-auto p-2 space-y-2">
              <For each={annotations}>
                {(annotation) => (
                  <div class="p-2 rounded-md bg-background-base border border-border-weaker-base">
                    <div class="flex items-center gap-1.5 mb-1">
                      <span class="text-11-regular">
                        {annotation.type === "highlight" ? "🖍️" : "📝"}
                      </span>
                      <span class="text-11-regular text-text-weak">
                        {new Date(annotation.timestamp).toLocaleDateString()}
                      </span>
                    </div>
                    <div class="text-12-regular text-text-base line-clamp-3">{annotation.text}</div>
                    <Show when={annotation.note}>
                      <div class="text-12-regular text-text-weak mt-1 italic">{annotation.note}</div>
                    </Show>
                  </div>
                )}
              </For>
              <Show when={annotations.length === 0}>
                <div class="text-12-regular text-text-weak text-center py-8">
                  No annotations yet
                </div>
              </Show>
            </div>
            <div class="p-2 border-t border-border-weaker-base shrink-0 flex gap-1">
              <button
                class="flex-1 px-2 py-1.5 text-12-regular bg-background-base border border-border-weaker-base rounded-md hover:bg-background-stronger transition-colors"
                onClick={() => {
                  const data = JSON.stringify(annotations, null, 2)
                  const blob = new Blob([data], { type: "application/json" })
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement("a")
                  a.href = url
                  a.download = `annotations-${Date.now()}.json`
                  a.click()
                  URL.revokeObjectURL(url)
                }}
              >
                Export
              </button>
              <button
                class="flex-1 px-2 py-1.5 text-12-regular bg-background-base border border-border-weaker-base rounded-md hover:bg-background-stronger transition-colors"
                onClick={() => {
                  const input = document.createElement("input")
                  input.type = "file"
                  input.accept = ".json"
                  input.onchange = (e) => {
                    const file = (e.target as HTMLInputElement).files?.[0]
                    if (file) {
                      const reader = new FileReader()
                      reader.onload = (event) => {
                        try {
                          const data = JSON.parse(event.target?.result as string)
                          if (Array.isArray(data)) {
                            setAnnotations(data)
                          }
                        } catch (e) {
                          console.error("Failed to load annotations", e)
                        }
                      }
                      reader.readAsText(file)
                    }
                  }
                  input.click()
                }}
              >
                Import
              </button>
            </div>
          </div>
        </Show>
      </div>

      <Show when={title()}>
        <div class="px-3 py-1 border-t border-border-weaker-base text-11-regular text-text-weak truncate shrink-0">
          {title()}
        </div>
      </Show>
    </div>
  )
}
