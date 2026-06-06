import { For, Show } from "solid-js"
import { useBrowser } from "@/context/browser"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { useLanguage } from "@/context/language"

export function BrowserPanel() {
  const browser = useBrowser()
  const language = useLanguage()

  return (
    <div class="flex flex-col h-full bg-v2-background-bg-layer-01 border-r border-v2-border-border-layer-01 w-full">
      <div class="p-3 border-b border-v2-border-border-layer-01 flex items-center justify-between">
        <h2 class="text-12-bold text-v2-text-text-base uppercase tracking-wider">{language.t("browser.bookmarks") ?? "Bookmarks"}</h2>
        <IconButton icon="plus" variant="ghost" size="small" onClick={() => browser.openBrowser()} />
      </div>
      
      <div class="flex-1 overflow-y-auto p-1">
        <Show when={browser.store.bookmarks.length > 0} fallback={
          <div class="p-4 text-center text-v2-text-text-muted text-11-regular">
            {language.t("browser.noBookmarks") ?? "No bookmarks yet"}
          </div>
        }>
          <div class="flex flex-col gap-0.5">
            <For each={browser.store.bookmarks}>
              {(bookmark) => (
                <div class="group flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-v2-background-bg-layer-02 cursor-pointer transition-colors"
                     onClick={() => browser.openBrowser(bookmark.url)}>
                  <div class="flex flex-col min-w-0">
                    <span class="text-12-medium text-v2-text-text-base truncate">{bookmark.title}</span>
                    <span class="text-10-regular text-v2-text-text-muted truncate">{bookmark.url}</span>
                  </div>
                  <IconButton 
                    icon="close-small" 
                    variant="ghost" 
                    size="small" 
                    class="opacity-0 group-hover:opacity-100 ml-1"
                    onClick={(e) => {
                      e.stopPropagation()
                      browser.removeBookmark(bookmark.id)
                    }} 
                  />
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  )
}
