import { For, Show } from "solid-js"
import { useBrowser } from "@/context/browser"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { useLanguage } from "@/context/language"

export function BrowserPanel() {
  const browser = useBrowser()
  const language = useLanguage()

  return (
    <div class="flex flex-col h-full bg-background-base border-r border-border-weak-base w-full">
      <div class="p-4 border-bottom border-border-weak-base flex items-center justify-between">
        <h2 class="text-14-bold text-text-strong">{language.t("browser.bookmarks") ?? "Bookmarks"}</h2>
        <IconButton icon="plus" variant="ghost" onClick={() => browser.openBrowser()} />
      </div>
      
      <div class="flex-1 overflow-y-auto p-2">
        <Show when={browser.store.bookmarks.length > 0} fallback={
          <div class="p-4 text-center text-text-weak text-12-regular">
            {language.t("browser.noBookmarks") ?? "No bookmarks yet"}
          </div>
        }>
          <div class="flex flex-col gap-1">
            <For each={browser.store.bookmarks}>
              {(bookmark) => (
                <div class="group flex items-center justify-between p-2 rounded hover:bg-surface-raised-base-hover cursor-pointer"
                     onClick={() => browser.openBrowser(bookmark.url)}>
                  <div class="flex flex-col min-w-0">
                    <span class="text-13-medium text-text-base truncate">{bookmark.title}</span>
                    <span class="text-11-regular text-text-weak truncate">{bookmark.url}</span>
                  </div>
                  <IconButton 
                    icon="close-small" 
                    variant="ghost" 
                    size="small" 
                    class="opacity-0 group-hover:opacity-100"
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
