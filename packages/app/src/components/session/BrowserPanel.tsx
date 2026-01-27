import { Component, createSignal, Show, For } from "solid-js"
import { useSDK } from "@/context/sdk"
import { Icon } from "@opencode-ai/ui/icon"
import { Button } from "@opencode-ai/ui/button"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tabs } from "@opencode-ai/ui/tabs"
import { useLanguage } from "@/context/language"

// Helper function to call browser API
async function callBrowserAPI(
  sdk: ReturnType<typeof useSDK>,
  endpoint: string,
  options?: {
    method?: "GET" | "POST" | "DELETE"
    body?: any
  }
) {
  const url = `${sdk.url}/browser${endpoint}`
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  }

  if (sdk.directory) {
    headers["x-opencode-directory"] = sdk.directory
  }

  console.log("[Browser API] Calling:", url, options)

  // Add timeout
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 60000) // 60 second timeout

  try {
    const response = await fetch(url, {
      method: options?.method ?? "GET",
      headers,
      body: options?.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    console.log("[Browser API] Response status:", response.status, response.statusText)

    if (!response.ok) {
      const text = await response.text()
      console.error("[Browser API] Error response:", text)
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const json = await response.json()
    console.log("[Browser API] Response:", json)
    return json
  } catch (err) {
    clearTimeout(timeoutId)
    if (err instanceof Error && err.name === 'AbortError') {
      console.error("[Browser API] Request timeout")
      throw new Error("Request timeout - browser operation took too long")
    }
    throw err
  }
}

interface BrowserAction {
  type: 'navigate' | 'click' | 'type' | 'scroll' | 'screenshot' | 'extract' | 'execute'
  url?: string
  selector?: string
  text?: string
  x?: number
  y?: number
  code?: string
  script?: string
}

interface BrowserResult {
  success: boolean
  data?: any
  error?: string
  screenshot?: string
  content?: string
}

export const BrowserPanel: Component = () => {
  const sdk = useSDK()
  const language = useLanguage()

  const [url, setUrl] = createSignal("")
  const [currentUrl, setCurrentUrl] = createSignal("")
  const [pageTitle, setPageTitle] = createSignal("")
  const [pageContent, setPageContent] = createSignal("")
  const [screenshot, setScreenshot] = createSignal("")
  const [isLoading, setIsLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [actionHistory, setActionHistory] = createSignal<BrowserAction[]>([])
  const [viewMode, setViewMode] = createSignal<"preview" | "content" | "screenshot">("preview")

  // Navigate to URL
  const navigate = async () => {
    if (!url()) return

    setIsLoading(true)
    setError(null)

    // Add https:// if no protocol is specified
    let targetUrl = url()
    if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
      targetUrl = `https://${targetUrl}`
    }

    try {
      const response = await callBrowserAPI(sdk, "/navigate", {
        method: "POST",
        body: { url: targetUrl },
      })

      if (response.success) {
        setCurrentUrl(targetUrl)
        setPageTitle(response.data?.title ?? "")

        // Add to history
        setActionHistory((prev) => [...prev, { type: "navigate", url: targetUrl }])

        // Load page info
        await loadPageInfo()
      } else {
        setError(response.error ?? "Navigation failed")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsLoading(false)
    }
  }

  // Load page information
  const loadPageInfo = async () => {
    try {
      const [titleResponse, urlResponse, contentResponse] = await Promise.all([
        callBrowserAPI(sdk, "/title"),
        callBrowserAPI(sdk, "/url"),
        callBrowserAPI(sdk, "/content"),
      ])

      if (titleResponse.success) {
        setPageTitle(titleResponse.data ?? "")
      }

      if (urlResponse.success) {
        setCurrentUrl(urlResponse.data ?? "")
      }

      if (contentResponse.success) {
        setPageContent(contentResponse.data ?? "")
      }
    } catch (err) {
      console.error("Failed to load page info:", err)
    }
  }

  // Take screenshot
  const takeScreenshot = async () => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await callBrowserAPI(sdk, "/screenshot", {
        method: "POST",
        body: { fullPage: false },
      })

      if (response.success) {
        setScreenshot(response.screenshot ?? "")

        // Add to history
        setActionHistory((prev) => [...prev, { type: "screenshot" }])
      } else {
        setError(response.error ?? "Screenshot failed")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsLoading(false)
    }
  }

  // Click element
  const clickElement = async (selector: string) => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await callBrowserAPI(sdk, "/click", {
        method: "POST",
        body: { selector },
      })

      if (response.success) {
        // Add to history
        setActionHistory((prev) => [...prev, { type: "click", selector }])

        // Refresh page info
        await loadPageInfo()
      } else {
        setError(response.error ?? "Click failed")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsLoading(false)
    }
  }

  // Type text
  const typeText = async (selector: string, text: string) => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await callBrowserAPI(sdk, "/type", {
        method: "POST",
        body: { selector, text },
      })

      if (response.success) {
        // Add to history
        setActionHistory((prev) => [...prev, { type: "type", selector, text }])

        // Refresh page info
        await loadPageInfo()
      } else {
        setError(response.error ?? "Type failed")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsLoading(false)
    }
  }

  // Execute JavaScript
  const executeScript = async (script: string) => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await callBrowserAPI(sdk, "/execute", {
        method: "POST",
        body: { script },
      })

      if (response.success) {
        // Add to history
        setActionHistory((prev) => [...prev, { type: "execute", script }])

        // Refresh page info
        await loadPageInfo()
      } else {
        setError(response.error ?? "Script execution failed")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div class="flex flex-col h-full bg-background-base">
      {/* Control Bar */}
      <div class="flex items-center gap-2 px-3 py-2 border-b border-border-weak-base bg-surface-raised-base">
        {/* URL Input */}
        <div class="flex-1 flex items-center gap-2">
          <input
            type="text"
            value={url()}
            onInput={(e) => setUrl(e.currentTarget.value)}
            onKeyPress={(e) => {
              if (e.key === "Enter") {
                navigate()
              }
            }}
            placeholder="Enter URL..."
            class="flex-1 px-3 py-1.5 text-13-regular bg-background-base border border-border-base rounded focus:outline-none focus:border-border-strong-base"
          />
          <Button
            size="small"
            variant="primary"
            onClick={navigate}
            disabled={isLoading() || !url()}
          >
            <div class="flex items-center gap-1.5">
              <Icon name="chevron-right" size="small" />
              <span>Go</span>
            </div>
          </Button>
        </div>

        {/* Actions */}
        <div class="flex items-center gap-1">
          <Button
            size="small"
            variant="ghost"
            onClick={takeScreenshot}
            disabled={isLoading() || !currentUrl()}
          >
            <div class="flex items-center gap-1.5">
              <Icon name="photo" size="small" />
              <span>Screenshot</span>
            </div>
          </Button>
        </div>
      </div>

      {/* View Mode Toggle */}
      <div class="flex items-center gap-2 px-3 py-2 border-b border-border-weak-base">
        <Tabs value={viewMode()} onChange={(value) => setViewMode(value as any)}>
          <Tabs.List>
            <Tabs.Trigger value="preview" size="small">
              <div class="flex items-center gap-1.5">
                <Icon name="eye" size="small" />
                <span>Preview</span>
              </div>
            </Tabs.Trigger>
            <Tabs.Trigger value="content" size="small">
              <div class="flex items-center gap-1.5">
                <Icon name="code" size="small" />
                <span>Content</span>
              </div>
            </Tabs.Trigger>
            <Tabs.Trigger value="screenshot" size="small">
              <div class="flex items-center gap-1.5">
                <Icon name="photo" size="small" />
                <span>Screenshot</span>
              </div>
            </Tabs.Trigger>
          </Tabs.List>
        </Tabs>
      </div>

      {/* Error State */}
      <Show when={error()}>
        {(errorMsg) => (
          <div class="flex items-center gap-2 px-4 py-2 bg-background-warning-subtle text-text-warning text-13-regular">
            <Icon name="help" class="w-4 h-4 shrink-0" />
            <span class="flex-1">{errorMsg()}</span>
            <IconButton
              icon="close"
              size="small"
              variant="ghost"
              onClick={() => setError(null)}
            />
          </div>
        )}
      </Show>

      {/* Content Area */}
      <div class="flex-1 overflow-auto">
        <Show
          when={currentUrl()}
          fallback={
            <div class="flex items-center justify-center h-full text-text-weak text-13-regular">
              <div class="text-center">
                <Icon name="server" size="large" class="mx-auto mb-2 text-text-weaker" />
                <p>Enter a URL to navigate</p>
              </div>
            </div>
          }
        >
          <div class="p-4">
            {/* Page Info */}
            <div class="mb-4">
              <div class="text-12-regular text-text-weak">Current URL</div>
              <div class="text-14-medium text-text-strong">{currentUrl()}</div>
              <Show when={pageTitle()}>
                <div class="text-12-regular text-text-weak mt-2">Page Title</div>
                <div class="text-14-medium text-text-strong">{pageTitle()}</div>
              </Show>
            </div>

            {/* Preview Mode */}
            <Show when={viewMode() === "preview"}>
              <div class="border border-border-base rounded-md p-4 bg-surface-base">
                <div class="text-12-regular text-text-weak mb-2">Browser Preview</div>
                <div class="text-13-regular text-text-base">
                  Browser preview will be displayed here. Implement with iframe or actual browser view.
                </div>
              </div>
            </Show>

            {/* Content Mode */}
            <Show when={viewMode() === "content"}>
              <div class="border border-border-base rounded-md p-4 bg-surface-base">
                <div class="text-12-regular text-text-weak mb-2">Page Content</div>
                <Show
                  when={pageContent()}
                  fallback={
                    <div class="text-13-regular text-text-base">
                      No content loaded. Click a button to load page content.
                    </div>
                  }
                >
                  <pre class="text-12-regular text-text-base overflow-auto max-h-96 whitespace-pre-wrap">
                    {pageContent()}
                  </pre>
                </Show>
              </div>
            </Show>

            {/* Screenshot Mode */}
            <Show when={viewMode() === "screenshot"}>
              <div class="border border-border-base rounded-md p-4 bg-surface-base">
                <div class="text-12-regular text-text-weak mb-2">Screenshot</div>
                <Show
                  when={screenshot()}
                  fallback={
                    <div class="text-13-regular text-text-base">
                      No screenshot taken. Click "Screenshot" button to capture the page.
                    </div>
                  }
                >
                  <img
                    src={`data:image/png;base64,${screenshot()}`}
                    alt="Page Screenshot"
                    class="max-w-full border border-border-base rounded"
                  />
                </Show>
              </div>
            </Show>
          </div>
        </Show>
      </div>

      {/* Action History */}
      <Show when={actionHistory().length > 0}>
        <div class="border-t border-border-weak-base bg-surface-raised-base">
          <div class="px-3 py-2 text-12-regular text-text-weak">
            Action History ({actionHistory().length})
          </div>
          <div class="max-h-32 overflow-auto">
            <For each={actionHistory().slice().reverse()}>
              {(action) => (
                <div class="px-3 py-1.5 text-12-regular text-text-base border-t border-border-weak-subtle">
                  <span class="text-text-weak">{action.type}</span>
                  <Show when={action.url}>
                    <span class="ml-2 text-text-strong">{action.url}</span>
                  </Show>
                  <Show when={action.selector}>
                    <span class="ml-2 text-text-strong">{action.selector}</span>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
  )
}
