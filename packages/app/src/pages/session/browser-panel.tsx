import { Show, batch, createEffect, createMemo, on, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { createSizing } from "@/pages/session/helpers"
import { useSessionLayout } from "@/pages/session/session-layout"

export function BrowserPanel() {
  const layout = useLayout()
  const language = useLanguage()
  const { view } = useSessionLayout()

  const opened = createMemo(() => view().browser.opened())
  const size = createSizing()
  const width = createMemo(() => layout.browser.width())
  const url = createMemo(() => layout.browser.url())
  const close = () => view().browser.close()
  let root: HTMLDivElement | undefined
  let iframe: HTMLIFrameElement | undefined

  const [store, setStore] = createStore({
    w: typeof window === "undefined" ? 1000 : window.innerWidth,
    inputUrl: "",
    currentUrl: "",
    loading: false,
  })

  const max = () => store.w * 0.6
  const pane = () => Math.min(width(), max())

  onMount(() => {
    if (typeof window === "undefined") return

    const sync = () => setStore("w", window.innerWidth)
    sync()
    window.addEventListener("resize", sync)
    onCleanup(() => window.removeEventListener("resize", sync))
  })

  createEffect(
    on(opened, (open) => {
      if (!open) return
      if (typeof window === "undefined") return

      const timers = [0, 90, 180, 320].map((ms) =>
        window.setTimeout(() => window.dispatchEvent(new Event("resize")), ms),
      )
      onCleanup(() => timers.forEach((timer) => window.clearTimeout(timer)))
    }),
  )

  createEffect(() => {
    const currentUrl = url()
    if (currentUrl) {
      setStore("inputUrl", currentUrl)
      setStore("currentUrl", currentUrl)
    }
  })

  createEffect(() => {
    if (!opened()) return
    const active = document.activeElement
    if (!(active instanceof HTMLElement)) return
    if (!root?.contains(active)) return
    active.blur()
  })

  const navigate = (targetUrl: string) => {
    let finalUrl = targetUrl.trim()
    if (!finalUrl) return

    if (!finalUrl.match(/^https?:\/\//i)) {
      if (finalUrl.includes(".") && !finalUrl.includes(" ")) {
        finalUrl = "http://" + finalUrl
      } else {
        finalUrl = "http://localhost:" + finalUrl
      }
    }

    setStore("currentUrl", finalUrl)
    setStore("inputUrl", finalUrl)
    setStore("loading", true)
    layout.browser.setUrl(finalUrl)
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      navigate(store.inputUrl)
    }
  }

  const refresh = () => {
    if (iframe) {
      setStore("loading", true)
      iframe.src = store.currentUrl
    }
  }

  const goBack = () => {
    if (iframe?.contentWindow) {
      iframe.contentWindow.history.back()
    }
  }

  const goForward = () => {
    if (iframe?.contentWindow) {
      iframe.contentWindow.history.forward()
    }
  }

  const handleIframeLoad = () => {
    setStore("loading", false)
  }

  return (
    <div
      ref={root}
      id="browser-panel"
      role="region"
      aria-label={language.t("browser.title")}
      aria-hidden={!opened()}
      inert={!opened()}
      class="relative shrink-0 overflow-hidden bg-background-stronger h-full border-l border-border-weak-base"
      classList={{
        "transition-[width] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none":
          !size.active(),
      }}
      style={{
        width: opened() ? `${pane()}px` : "0px",
      }}
    >
      <div
        class="absolute inset-0 flex flex-col"
        classList={{
          "pointer-events-none": !opened(),
        }}
      >
        <div class="hidden md:block" onPointerDown={() => size.start()}>
          <ResizeHandle
            direction="horizontal"
            edge="start"
            size={pane()}
            min={280}
            max={max()}
            collapseThreshold={140}
            onResize={(next) => {
              size.touch()
              layout.browser.resizeWidth(next)
            }}
            onCollapse={close}
          />
        </div>

        <div class="flex flex-col h-full">
          <div class="h-10 flex items-center gap-2 px-2 border-b border-border-weaker-base bg-background-stronger overflow-hidden">
            <IconButton
              icon="arrow-left"
              variant="ghost"
              iconSize="large"
              onClick={goBack}
              aria-label={language.t("browser.back")}
              disabled={!opened()}
            />
            <IconButton
              icon="arrow-right"
              variant="ghost"
              iconSize="large"
              onClick={goForward}
              aria-label={language.t("browser.forward")}
              disabled={!opened()}
            />
            <IconButton
              icon="reset"
              variant="ghost"
              iconSize="large"
              onClick={refresh}
              aria-label={language.t("browser.refresh")}
              disabled={!opened() || !store.currentUrl}
            />
            <div class="flex-1 min-w-0 relative">
              <input
                type="text"
                value={store.inputUrl}
                onInput={(e) => setStore("inputUrl", e.currentTarget.value)}
                onKeyDown={handleKeyDown}
                placeholder={language.t("browser.placeholder")}
                class="w-full h-8 px-2 text-14-regular bg-surface-base border border-border-weak-base rounded-md focus:outline-none focus:border-border-base text-text-base placeholder:text-text-weak"
                disabled={!opened()}
              />
              <Show when={store.loading}>
                <div class="absolute right-2 top-1/2 -translate-y-1/2">
                  <div class="w-4 h-4 border-2 border-text-weak border-t-transparent rounded-full animate-spin" />
                </div>
              </Show>
            </div>
            <div class="h-full flex items-center justify-center">
              <Tooltip value={language.t("browser.openExternal")} class="flex items-center">
                <IconButton
                  icon="square-arrow-top-right"
                  variant="ghost"
                  iconSize="large"
                  onClick={() => {
                    if (store.currentUrl) {
                      window.open(store.currentUrl, "_blank", "noopener,noreferrer")
                    }
                  }}
                  aria-label={language.t("browser.openExternal")}
                  disabled={!store.currentUrl}
                />
              </Tooltip>
            </div>
          </div>

          <div class="flex-1 min-h-0 relative bg-white">
            <Show when={store.currentUrl && opened()}>
              <iframe
                ref={iframe}
                src={store.currentUrl}
                onLoad={handleIframeLoad}
                class="w-full h-full border-0"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
                title={language.t("browser.title")}
              />
            </Show>
            <Show when={!store.currentUrl && opened()}>
              <div class="flex items-center justify-center h-full text-text-weak text-14-regular">
                {language.t("browser.empty")}
              </div>
            </Show>
          </div>
        </div>
      </div>
    </div>
  )
}
