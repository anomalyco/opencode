import { Show, createMemo, createSignal, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { makeEventListener } from "@solid-primitives/event-listener"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useSettings } from "@/context/settings"
import { createSizing } from "@/pages/session/helpers"
import { useSessionLayout } from "@/pages/session/session-layout"

export function PreviewPanel() {
  const layout = useLayout()
  const language = useLanguage()
  const settings = useSettings()
  const { view } = useSessionLayout()

  const opened = createMemo(() => view().preview.opened())
  const size = createSizing()
  const height = createMemo(() => layout.preview.height())
  const close = () => view().preview.close()

  const [reloadKey, setReloadKey] = createSignal(0)

  const [store, setStore] = createStore({
    view: typeof window === "undefined" ? 1000 : (window.visualViewport?.height ?? window.innerHeight),
  })

  const max = () => store.view * 0.6
  const pane = () => Math.min(height(), max())

  onMount(() => {
    if (typeof window === "undefined") return

    const sync = () => setStore("view", window.visualViewport?.height ?? window.innerHeight)
    const port = window.visualViewport

    sync()
    makeEventListener(window, "resize", sync)
    if (port) makeEventListener(port, "resize", sync)
  })

  const url = () => settings.general.previewUrl().trim()
  const refresh = () => setReloadKey((n) => n + 1)
  const openExternal = () => {
    const next = url()
    if (!next) return
    window.open(next, "_blank", "noopener,noreferrer")
  }

  return (
    <div
      id="preview-panel"
      role="region"
      aria-label={language.t("preview.title")}
      aria-hidden={!opened()}
      inert={!opened()}
      class="relative w-full shrink-0 bg-background-stronger"
      classList={{
        "transition-[height] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[height] motion-reduce:transition-none":
          !size.active(),
      }}
      style={{ height: opened() ? `${pane()}px` : "0px" }}
    >
      <div class="hidden md:block" onPointerDown={() => size.start()}>
        <ResizeHandle
          classList={{ "-top-1": settings.general.newLayoutDesigns() }}
          direction="vertical"
          size={pane()}
          min={100}
          max={max()}
          collapseThreshold={50}
          onResize={(next) => {
            size.touch()
            layout.preview.resize(next)
          }}
          onCollapse={close}
        />
      </div>
      <div
        class="absolute inset-x-0 top-0 flex flex-col overflow-hidden"
        classList={{
          "border-t border-border-weak-base": opened(),
          "pointer-events-none": !opened(),
        }}
        style={{ height: `${pane()}px` }}
      >
        <div class="h-10 flex items-center gap-1 px-2 border-b border-border-weaker-base bg-background-stronger">
          <div class="flex-1 min-w-0 text-14-regular text-text-weak truncate px-1">{url() || language.t("preview.empty")}</div>
          <Show when={url()}>
            <Tooltip value={language.t("command.preview.refresh")}>
              <IconButton
                icon="reset"
                variant="ghost"
                iconSize="medium"
                onClick={refresh}
                aria-label={language.t("command.preview.refresh")}
              />
            </Tooltip>
            <Tooltip value={language.t("command.preview.openExternal")}>
              <IconButton
                icon="open-file"
                variant="ghost"
                iconSize="medium"
                onClick={openExternal}
                aria-label={language.t("command.preview.openExternal")}
              />
            </Tooltip>
          </Show>
        </div>
        <div class="flex-1 min-h-0 relative bg-background-base">
          {/* The keyed Show re-mounts the iframe when reloadKey changes so the
              src is re-fetched even when the URL is unchanged. */}
          <Show when={reloadKey()} keyed>
            <Show when={opened() && url()}>
              <iframe
                title={language.t("preview.title")}
                src={url()}
                class="absolute inset-0 w-full h-full border-0 bg-background-base"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
                referrerpolicy="no-referrer"
              />
            </Show>
          </Show>
          <Show when={opened() && !url()}>
            <div class="absolute inset-0 flex items-center justify-center text-14-regular text-text-weak px-4 text-center">
              {language.t("preview.empty")}
            </div>
          </Show>
        </div>
      </div>
    </div>
  )
}