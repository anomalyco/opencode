import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Loader } from "@opencode-ai/ui/loader"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { createEventListener } from "@solid-primitives/event-listener"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { createEffect, For, on, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import type { BrowserPaneRegistration } from "@/runtime/platform/browser-pane"
import { usePlatform } from "@/runtime/platform/platform"
import type { createSessionBrowser } from "./model"

export function SessionBrowserPane(props: {
  registration: BrowserPaneRegistration
  browser: ReturnType<typeof createSessionBrowser>
  visible: boolean
}) {
  const platform = usePlatform()
  const language = useLanguage()
  const dialog = useDialog()
  const state = props.browser.active
  const button = { variant: "ghost", size: "large" } as const
  const [store, setStore] = createStore({
    address: "",
    editing: false,
    visible: typeof document === "undefined" || document.visibilityState === "visible",
  })
  let surface: HTMLDivElement | undefined
  let frame: number | undefined
  let layout: string | undefined
  let until = 0
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = 1
  const paint = canvas.getContext("2d", { willReadFrequently: true })

  // The native page always paints above the DOM, so hide it while a floating
  // menu, select, or popover overlaps it. Tooltips are excluded.
  const covered = (rect: DOMRect) =>
    Array.from(document.querySelectorAll('[data-popper-positioner]:not(:has([role="tooltip"]))')).some((el) => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.left < rect.right && r.right > rect.left && r.top < rect.bottom && r.bottom > rect.top
    })
  const measure = () => {
    frame = undefined
    if (!surface) return
    const tab = state()
    if (!tab) {
      props.registration.setLayout()
      return
    }
    const rect = surface.getBoundingClientRect()
    const zoom = platform.webviewZoom?.() ?? 1
    const left = Math.round(rect.left * zoom)
    const top = Math.round(rect.top * zoom)
    const right = Math.round(rect.right * zoom)
    const bottom = Math.round(rect.bottom * zoom)
    const visible = props.visible && store.visible && !dialog.active && !covered(rect)
    // The cutout exposes the app backdrop outside the rounded Review card,
    // not the browser surface inside it.
    const color = getComputedStyle(
      surface.closest(".bg-v2-background-bg-deep") ?? document.documentElement,
    ).backgroundColor
    const next = `${tab.id}:${visible}:${left}:${top}:${right}:${bottom}:${color}:${window.devicePixelRatio}`
    if (next !== layout) {
      layout = next
      // Let the browser resolve the semantic backdrop color, including custom
      // themes using color formats that Electron's color parser cannot read.
      if (paint) {
        paint.clearRect(0, 0, 1, 1)
        paint.fillStyle = color
        paint.fillRect(0, 0, 1, 1)
      }
      const rgba = paint?.getImageData(0, 0, 1, 1).data
      props.registration.setLayout({
        tabID: tab.id,
        visible,
        bounds: { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) },
        background: rgba ? [rgba[0], rgba[1], rgba[2], rgba[3]] : undefined,
        radius: Math.round(10 * zoom),
      })
    }
    if (performance.now() < until) frame = requestAnimationFrame(measure)
  }
  const schedule = (duration = 0) => {
    until = Math.max(until, performance.now() + duration)
    if (frame === undefined) frame = requestAnimationFrame(measure)
  }

  createEffect(() => !store.editing && setStore("address", state()?.url ?? ""))
  createEffect(
    on(
      [
        () => platform.webviewZoom?.(),
        () => dialog.active,
        () => store.visible,
        () => props.visible,
        () => state()?.id,
      ],
      () => schedule(300),
    ),
  )
  createResizeObserver(() => surface, schedule.bind(null, 0))
  createEventListener(window, "resize", () => schedule(300))
  // Floating content portals directly into <body>; keep measuring briefly so
  // the positioner has settled before the overlap check runs.
  const portals = new MutationObserver(() => schedule(300))
  portals.observe(document.body, { childList: true })
  onCleanup(() => portals.disconnect())
  const appearance = new MutationObserver(() => schedule(300))
  appearance.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "data-theme"] })
  onCleanup(() => appearance.disconnect())
  createEventListener(window.matchMedia("(prefers-color-scheme: dark)"), "change", () => schedule(300))
  createEventListener(document, "visibilitychange", () => setStore("visible", document.visibilityState === "visible"))
  onCleanup(() => {
    if (frame !== undefined) cancelAnimationFrame(frame)
    props.registration.setLayout()
  })

  return (
    <aside id="browser-panel" class="relative size-full min-w-0 overflow-hidden bg-v2-background-bg-base flex flex-col">
      <div class="h-10 shrink-0 flex items-center gap-1 px-2 border-b border-v2-border-border-muted bg-v2-background-bg-layer-02">
        <For each={["back", "forward"] as const}>
          {(direction) => (
            <IconButton
              {...button}
              disabled={!state()?.[direction === "back" ? "canGoBack" : "canGoForward"]}
              aria-label={language.t(direction === "back" ? "common.goBack" : "common.goForward")}
              onClick={() => {
                const tab = state()
                if (tab) props.browser.command({ type: direction, tabID: tab.id })
              }}
              icon={<Icon name={direction === "back" ? "chevron-left" : "chevron-right"} size="small" />}
            />
          )}
        </For>
        <IconButton
          {...button}
          disabled={!state()}
          aria-label={language.t(state()?.loading ? "prompt.action.stop" : "error.page.action.reload")}
          onClick={() => {
            const tab = state()
            if (tab) props.browser.command({ type: tab.loading ? "stop" : "reload", tabID: tab.id })
          }}
          icon={
            <Show when={state()?.loading} fallback={<Icon name="reset" size="small" />}>
              <Loader />
            </Show>
          }
        />
        <form
          class="min-w-0 flex-1"
          onSubmit={(event) => {
            event.preventDefault()
            const tab = state()
            if (tab && store.address.trim())
              props.browser.command({ type: "navigate", tabID: tab.id, url: store.address })
          }}
        >
          <input
            class="w-full h-7 px-2 rounded-md border border-v2-border-border-muted bg-v2-background-bg-base text-12-regular text-v2-text-text-base outline-none focus:border-v2-border-border-focus"
            value={store.address}
            disabled={!state()}
            placeholder={language.t("session.browser.address.placeholder")}
            aria-label={language.t("session.browser.address")}
            onFocus={() => setStore("editing", true)}
            onBlur={() => setStore({ editing: false, address: state()?.url ?? "" })}
            onInput={(event) => setStore("address", event.currentTarget.value)}
          />
        </form>
      </div>
      <Show when={props.browser.error()}>
        <div class="shrink-0 px-3 py-1.5 text-12-regular text-text-danger-base border-b border-v2-border-border-muted">
          {props.browser.error()}
        </div>
      </Show>
      <div ref={surface} class="min-h-0 flex-1 bg-v2-background-bg-base" />
    </aside>
  )
}
