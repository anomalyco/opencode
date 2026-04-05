import { For, Show, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useSessionLayout } from "@/pages/session/session-layout"
import { Persist, persisted } from "@/utils/persist"
import { decode64 } from "@/utils/base64"
import { createSizing } from "@/pages/session/helpers"
import { NativeBrowser } from "@/components/browser/native-browser"

type BrowserTab = {
  id: string
  url: string
  title: string
}

const DEFAULT_URL = "https://duckduckgo.com"

function generateId() {
  return crypto.randomUUID()
}

function getDomain(url: string) {
  try {
    const u = new URL(url)
    return u.hostname
  } catch {
    return url.slice(0, 30)
  }
}

export function BrowserPanel() {
  const layout = useLayout()
  const language = useLanguage()
  const platform = usePlatform()
  const { view, params } = useSessionLayout()

  const dir = createMemo(() => decode64(params.dir) ?? "")

  const opened = createMemo(() => view().browser.opened())
  const size = createSizing()
  const width = createMemo(() => layout.browser.width())
  const closeBrowser = () => view().browser.close()

  const [store, setStore, , ready] = persisted(
    Persist.workspace(dir(), "browser-tabs"),
    createStore({
      tabs: [] as BrowserTab[],
      activeTab: "" as string,
    }),
  )

  const closeAllWebviews = async () => {
    for (const tab of store.tabs) {
      await platform.closeBrowser?.(tab.id)
    }
  }

  createEffect(
    on(
      () => params.dir,
      (next, prev) => {
        if (!prev) return
        if (next === prev) return
        closeAllWebviews()
      },
      { defer: true },
    ),
  )

  const activeTabData = createMemo(() => store.tabs.find((t) => t.id === store.activeTab))

  const addTab = (url: string = DEFAULT_URL) => {
    const id = generateId()
    const title = getDomain(url)
    setStore("tabs", (tabs) => [...tabs, { id, url, title }])
    setStore("activeTab", id)
  }

  const removeTab = (id: string) => {
    setStore(
      produce((s) => {
        const idx = s.tabs.findIndex((t) => t.id === id)
        if (idx === -1) return

        const wasActive = s.activeTab === id
        s.tabs = s.tabs.filter((t) => t.id !== id)

        if (wasActive) {
          if (s.tabs.length > 0) {
            const newIdx = Math.min(idx, s.tabs.length - 1)
            s.activeTab = s.tabs[newIdx].id
          } else {
            s.activeTab = ""
          }
        }
      }),
    )
  }

  const setActiveTab = (id: string) => {
    setStore("activeTab", id)
  }

  const [urlInput, setUrlInput] = createSignal("")

  const handleUrlSubmit = (e: Event) => {
    e.preventDefault()
    let url = urlInput().trim()
    if (!url) return

    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      url = "https://" + url
    }

    if (store.activeTab) {
      setStore("tabs", (tabs) => tabs.map((t) => (t.id === store.activeTab ? { ...t, url, title: getDomain(url) } : t)))
    } else {
      addTab(url)
    }
    setUrlInput("")
  }

  const refreshTab = () => {
    const tab = activeTabData()
    if (tab) {
      void platform.browserReload?.(tab.id)
    }
  }

  const openUrl = (url: string) => {
    const existing = store.tabs.find((t) => t.url === url)
    if (existing) {
      setActiveTab(existing.id)
      return
    }
    addTab(url)
  }

  onCleanup(() => {
    closeAllWebviews()
  })

  return (
    <div
      id="browser-panel"
      role="region"
      aria-label={language.t("browser.title")}
      aria-hidden={!opened()}
      inert={!opened()}
      class="relative min-w-0 h-full shrink-0 overflow-hidden bg-background-base"
      classList={{
        "border-l border-border-weaker-base": opened(),
        "transition-[width] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none":
          !size.active(),
      }}
      style={{ width: opened() ? `${width()}px` : "0px" }}
    >
      <Show when={opened()}>
        <div class="size-full flex flex-col">
          <div class="flex items-center gap-1 px-2 h-10 border-b border-border-weaker-base bg-background-stronger">
            <div class="flex items-center gap-1 overflow-x-auto">
              <For each={store.tabs}>
                {(tab) => (
                  <button
                    class="flex items-center gap-1.5 px-2 py-1 rounded-md text-13-regular max-w-40 truncate transition-colors shrink-0"
                    classList={{
                      "bg-surface-base text-text-strong": store.activeTab === tab.id,
                      "text-text-weak hover:text-text-base hover:bg-surface-hover": store.activeTab !== tab.id,
                    }}
                    onClick={() => setActiveTab(tab.id)}
                    title={tab.url}
                  >
                    <span class="truncate">{tab.title}</span>
                    <IconButton
                      icon="close-small"
                      variant="ghost"
                      class="h-4 w-4 opacity-50 hover:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation()
                        removeTab(tab.id)
                      }}
                      aria-label={language.t("common.closeTab")}
                    />
                  </button>
                )}
              </For>
            </div>

            <div class="flex items-center gap-1 ml-auto shrink-0">
              <IconButton
                icon="plus-small"
                variant="ghost"
                iconSize="large"
                onClick={() => addTab()}
                aria-label={language.t("browser.newTab")}
                title={language.t("browser.newTab")}
              />
            </div>
          </div>

          <div class="px-2 py-1 border-b border-border-weaker-base bg-background-stronger">
            <div class="flex items-center gap-2">
              <IconButton
                icon="reset"
                variant="ghost"
                iconSize="medium"
                onClick={refreshTab}
                title="Refresh"
                class="shrink-0"
              />
              <form onSubmit={handleUrlSubmit} class="flex-1">
                <input
                  type="text"
                  value={urlInput()}
                  onInput={(e) => setUrlInput(e.currentTarget.value)}
                  onFocus={(e) => setUrlInput(activeTabData()?.url ?? "")}
                  placeholder="Enter URL or search..."
                  class="w-full px-3 py-1.5 rounded-md bg-surface-base border border-border-weaker-base text-14-regular text-text-strong focus:outline-none focus:ring-2 focus:ring-accent-base"
                />
              </form>
            </div>
          </div>

          <div class="flex-1 min-h-0 relative">
            <Show
              when={activeTabData()}
              fallback={
                <div class="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-background-stronger">
                  <div class="text-14-regular text-text-weak">{language.t("browser.noTabs")}</div>
                  <button
                    onClick={() => addTab()}
                    class="px-4 py-2 rounded-md bg-accent-base text-white text-14-medium hover:bg-accent-hover transition-colors"
                  >
                    {language.t("browser.openNewTab")}
                  </button>
                </div>
              }
            >
              <For each={store.tabs}>
                {(tab) => (
                  <div
                    class="absolute inset-0"
                    style={{ visibility: tab.id === store.activeTab ? "visible" : "hidden" }}
                  >
                    {tab.url && <NativeBrowser url={tab.url} label={tab.id} />}
                  </div>
                )}
              </For>
            </Show>
          </div>
        </div>

        <div onPointerDown={() => size.start()}>
          <ResizeHandle
            direction="horizontal"
            edge="end"
            size={width()}
            min={300}
            max={typeof window === "undefined" ? 800 : window.innerWidth * 0.5}
            onResize={(next) => {
              size.touch()
              layout.browser.resize(next)
            }}
            onCollapse={closeBrowser}
          />
        </div>
      </Show>
    </div>
  )
}
