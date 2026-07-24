import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Spinner } from "@opencode-ai/ui/spinner"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { createEffect, onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { usePlatform, type BrowserPaneCommand, type BrowserPanePlatform } from "@/context/platform"
import { useSettings } from "@/context/settings"

export function runBrowserPaneCommand(
  browser: BrowserPanePlatform | undefined,
  command: BrowserPaneCommand,
  onError: (message: string) => void,
) {
  if (!browser) return Promise.resolve()
  return browser.command(command).catch((error) => {
    onError(error instanceof Error ? error.message : String(error))
  })
}

export function SessionBrowserPane(props: { sessionID: string }) {
  const platform = usePlatform()
  const language = useLanguage()
  const settings = useSettings()
  const dialog = useDialog()
  const browser = platform.browserPane
  const [store, setStore] = createStore({
    address: "",
    editing: false,
    visible: typeof document === "undefined" || document.visibilityState === "visible",
    state: {
      url: "",
      title: "",
      loading: false,
      canGoBack: false,
      canGoForward: false,
      error: undefined as string | undefined,
    },
  })
  let panel: HTMLElement | undefined
  let surface: HTMLDivElement | undefined
  let frame: number | undefined
  let until = 0

  const measure = () => {
    frame = undefined
    if (!browser || !surface) return
    const rect = surface.getBoundingClientRect()
    const zoom = platform.webviewZoom?.() ?? 1
    const left = Math.round(rect.left * zoom)
    const top = Math.round(rect.top * zoom)
    const right = Math.round(rect.right * zoom)
    const bottom = Math.round(rect.bottom * zoom)
    browser.setLayout({
      attached: settings.general.experimentalBrowser(),
      visible: settings.general.experimentalBrowser() && store.visible && !dialog.active,
      sessionID: props.sessionID,
      background: panel ? getComputedStyle(panel).backgroundColor : undefined,
      bounds: { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) },
    })
    if (performance.now() < until) frame = requestAnimationFrame(measure)
  }

  const schedule = (duration = 0) => {
    until = Math.max(until, performance.now() + duration)
    if (frame !== undefined) return
    frame = requestAnimationFrame(measure)
  }

  createEffect(() => {
    props.sessionID
    settings.general.experimentalBrowser()
    platform.webviewZoom?.()
    dialog.active
    store.visible
    schedule(300)
  })

  onMount(() => {
    const resize = new ResizeObserver(() => schedule())
    if (surface) resize.observe(surface)
    const theme = new MutationObserver(() => schedule())
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] })
    const onResize = () => schedule(300)
    const onVisibility = () => setStore("visible", document.visibilityState === "visible")
    window.addEventListener("resize", onResize)
    document.addEventListener("visibilitychange", onVisibility)
    const subscription = browser?.subscribe((state) => {
      setStore("state", state)
      if (!store.editing) setStore("address", state.url)
    })
    schedule(300)
    onCleanup(() => {
      resize.disconnect()
      theme.disconnect()
      window.removeEventListener("resize", onResize)
      document.removeEventListener("visibilitychange", onVisibility)
      if (frame !== undefined) cancelAnimationFrame(frame)
      void subscription?.then((dispose) => dispose())
      browser?.setLayout({
        attached: false,
        visible: false,
        sessionID: props.sessionID,
        destroy: !settings.general.experimentalBrowser(),
      })
    })
  })

  const command = (input: BrowserPaneCommand) => {
    setStore("state", "error", undefined)
    void runBrowserPaneCommand(browser, input, (error) => setStore("state", "error", error))
  }

  const navigate = () => command({ type: "navigate", url: store.address })

  return (
    <aside
      ref={panel}
      id="browser-panel"
      aria-label={language.t("session.panel.browser")}
      class="relative size-full min-w-0 flex flex-col overflow-hidden bg-background-base"
      classList={{
        "rounded-[10px] shadow-[var(--v2-elevation-raised)] bg-v2-background-bg-base":
          settings.general.newLayoutDesigns(),
        "border-l border-border-weaker-base": !settings.general.newLayoutDesigns(),
      }}
    >
      <div class="h-10 shrink-0 flex items-center gap-1 px-2 border-b border-border-weaker-base bg-surface-base">
        <Button
          variant="ghost"
          class="size-7 p-0"
          disabled={!store.state.canGoBack}
          aria-label={language.t("browser.back")}
          onClick={() => command({ type: "back" })}
        >
          <Icon name="chevron-left" size="small" />
        </Button>
        <Button
          variant="ghost"
          class="size-7 p-0"
          disabled={!store.state.canGoForward}
          aria-label={language.t("browser.forward")}
          onClick={() => command({ type: "forward" })}
        >
          <Icon name="chevron-right" size="small" />
        </Button>
        <Button
          variant="ghost"
          class="size-7 p-0"
          aria-label={language.t("browser.reload")}
          onClick={() => command(store.state.loading ? { type: "stop" } : { type: "reload" })}
        >
          <Show when={store.state.loading} fallback={<Icon name="refresh" size="small" />}>
            <Spinner class="size-3" />
          </Show>
        </Button>
        <form
          class="min-w-0 flex-1"
          onSubmit={(event) => {
            event.preventDefault()
            navigate()
          }}
        >
          <input
            class="w-full h-7 px-2 rounded-md border border-border-weak-base bg-background-base text-12-regular text-text-strong outline-none focus:border-border-strong-base"
            value={store.address}
            placeholder={language.t("browser.address.placeholder")}
            aria-label={language.t("browser.address.label")}
            onFocus={() => setStore("editing", true)}
            onBlur={() => setStore("editing", false)}
            onInput={(event) => setStore("address", event.currentTarget.value)}
          />
        </form>
      </div>
      <Show when={store.state.error}>
        {(error) => (
          <div class="shrink-0 px-3 py-1.5 text-12-regular text-text-danger border-b border-border-weaker-base">
            {error()}
          </div>
        )}
      </Show>
      <div ref={surface} class="min-h-0 flex-1 bg-background-base" />
    </aside>
  )
}
