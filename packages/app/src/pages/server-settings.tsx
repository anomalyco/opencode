import { createSignal, For, Show } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { showToast } from "@opencode-ai/ui/toast"

const STORAGE_KEY = "opencode-server-url"
const HISTORY_KEY = "opencode-server-url-history"
const MAX_HISTORY = 5

function loadHistory(): string[] {
  try {
    const stored = localStorage.getItem(HISTORY_KEY)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

function saveHistory(url: string) {
  const history = loadHistory().filter((u) => u !== url)
  history.unshift(url)
  if (history.length > MAX_HISTORY) history.pop()
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history))
}

export default function ServerSettings() {
  const [inputUrl, setInputUrl] = createSignal("")
  const [history, setHistory] = createSignal(loadHistory())
  const currentUrl = () => localStorage.getItem(STORAGE_KEY) || ""

  function setServerUrl(url: string) {
    if (!url) return
    localStorage.setItem(STORAGE_KEY, url)
    saveHistory(url)
    setHistory(loadHistory())
    showToast({
      title: "Server URL updated",
      description: "Reloading to apply changes...",
    })
    setTimeout(() => window.location.reload(), 1000)
  }

  function clearUrl() {
    localStorage.removeItem(STORAGE_KEY)
    showToast({
      title: "Server URL cleared",
      description: "Reloading to apply changes...",
    })
    setTimeout(() => window.location.reload(), 1000)
  }

  return (
    <div class="mx-auto mt-55 max-w-lg w-full">
      <div class="text-14-medium text-text-strong mb-6">Server Settings</div>

      <div class="bg-background-stronger rounded-lg p-4 mb-4">
        <div class="text-12-regular text-text-weak mb-2">Current server URL</div>
        <div class="flex items-center gap-2">
          <div class="text-14-mono text-text-strong flex-1">{currentUrl() || "Not set"}</div>
          <Show when={currentUrl()}>
            <Button variant="ghost" icon="close" size="normal" onClick={clearUrl}>
              Clear
            </Button>
          </Show>
        </div>
      </div>

      <div class="bg-background-stronger rounded-lg p-4 mb-4">
        <div class="text-12-regular text-text-weak mb-2">Set server URL</div>
        <div class="flex gap-2 items-center">
          <input
            type="text"
            placeholder="https://your-server.com"
            value={inputUrl()}
            onInput={(e) => setInputUrl(e.currentTarget.value)}
            class="flex-1 bg-background-base border border-border-weak-base rounded-md px-3 py-2 text-14-regular text-text-strong focus:outline-none focus:border-border-strong-base"
          />
          <Button onClick={() => setServerUrl(inputUrl())}>Set</Button>
        </div>
      </div>

      <Show when={history().length > 0}>
        <div class="bg-background-stronger rounded-lg p-4">
          <div class="text-12-regular text-text-weak mb-3">Recent URLs</div>
          <div class="flex flex-col gap-2">
            <For each={history()}>
              {(url) => (
                <Button
                  variant="ghost"
                  size="large"
                  class="text-left justify-start text-14-mono"
                  onClick={() => setServerUrl(url)}
                >
                  {url}
                </Button>
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
  )
}
