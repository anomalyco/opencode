import { createSignal, Show, For } from "solid-js"
import { Icon } from "@cedric/ui/icon"
import { normalizeBrowserUrl } from "@/components/tabs/browser-tab"

interface NewTabPaletteProps {
  onClose: () => void
  onOpenBrowser: (url?: string) => void
  onOpenFile: () => void
  onOpenTerminal: () => void
  onOpenChat: () => void
}

export function NewTabPalette(props: NewTabPaletteProps) {
  const [browserUrl, setBrowserUrl] = createSignal("")
  const [showUrlInput, setShowUrlInput] = createSignal(false)

  const recentItems = () => {
    // Could be loaded from localStorage or state
    return [
      { type: "browser" as const, title: "google.com", url: "https://google.com" },
      { type: "browser" as const, title: "github.com", url: "https://github.com" },
    ]
  }

  const handleOpenBrowser = () => {
    props.onOpenBrowser()
    props.onClose()
  }

  const handleOpenBrowserWithUrl = () => {
    const url = browserUrl().trim()
    if (url) {
      props.onOpenBrowser(normalizeBrowserUrl(url))
      props.onClose()
    }
  }

  return (
    <div class="absolute top-full left-0 mt-1 w-72 bg-background-raised border border-border-base rounded-lg shadow-lg z-50 p-2">
      <div class="space-y-1">
        <div class="text-11-semibold text-text-weak uppercase tracking-wider px-2 py-1">New Tab</div>

        <button
          class="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-13-regular text-text-base hover:bg-background-base transition-colors"
          onClick={handleOpenBrowser}
        >
          <Icon name="window-cursor" class="w-4 h-4 text-icon-info-active" />
          <span>Browse Web</span>
        </button>

        <Show when={showUrlInput()}>
          <div class="px-2 py-1">
            <input
              type="text"
              class="w-full bg-background-stronger rounded-md px-2 py-1.5 text-13-regular border border-border-weaker-base outline-none focus:border-icon-info-active"
              placeholder="Enter URL..."
              value={browserUrl()}
              onInput={(e) => setBrowserUrl(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleOpenBrowserWithUrl()
                if (e.key === "Escape") {
                  setShowUrlInput(false)
                  setBrowserUrl("")
                }
              }}
              autofocus
            />
          </div>
        </Show>

        <button
          class="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-13-regular text-text-base hover:bg-background-base transition-colors"
          onClick={() => setShowUrlInput(!showUrlInput())}
        >
          <Icon name="link" class="w-4 h-4 text-text-weak" />
          <span>{showUrlInput() ? "Cancel" : "Open URL..."}</span>
        </button>

        <button
          class="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-13-regular text-text-base hover:bg-background-base transition-colors"
          onClick={props.onOpenFile}
        >
          <Icon name="open-file" class="w-4 h-4 text-syntax-string" />
          <span>Open File...</span>
        </button>

        <button
          class="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-13-regular text-text-base hover:bg-background-base transition-colors"
          onClick={props.onOpenTerminal}
        >
          <Icon name="terminal" class="w-4 h-4 text-syntax-function" />
          <span>New Terminal</span>
        </button>

        <button
          class="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-13-regular text-text-base hover:bg-background-base transition-colors"
          onClick={props.onOpenChat}
        >
          <Icon name="comment" class="w-4 h-4 text-syntax-type" />
          <span>New Side Chat</span>
        </button>

        <Show when={recentItems().length > 0}>
          <div class="border-t border-border-weaker-base my-1"></div>
          <div class="text-11-semibold text-text-weak uppercase tracking-wider px-2 py-1">Recent</div>

          <For each={recentItems()}>
            {(item) => (
              <button
                class="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-13-regular text-text-base hover:bg-background-base transition-colors"
                onClick={() => {
                  if (item.type === "browser") {
                    props.onOpenBrowser(item.url)
                  }
                }}
              >
                <Icon name="window-cursor" class="w-4 h-4 text-text-weak" />
                <span class="truncate">{item.title}</span>
              </button>
            )}
          </For>
        </Show>
      </div>

      <button
        class="absolute top-1 right-1 w-6 h-6 flex items-center justify-center rounded-md text-text-weak hover:text-text-base hover:bg-background-base"
        onClick={props.onClose}
      >
        <Icon name="close-small" class="w-4 h-4" />
      </button>
    </div>
  )
}
