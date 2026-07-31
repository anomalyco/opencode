import { createEffect, createMemo, createSignal, For, Match, Show, Switch } from "solid-js"
import { Dynamic } from "solid-js/web"
import { makeEventListener } from "@solid-primitives/event-listener"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { sampledChecksum } from "@opencode-ai/core/util/encode"
import { getFilename } from "@opencode-ai/core/util/path"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useCode } from "@/context/code"
import { useFileComponent } from "@opencode-ai/ui/context/file"
import "./code-panel.css"

export function CodePanel() {
  const language = useLanguage()
  const layout = useLayout()
  const code = useCode()
  const fileComponent = useFileComponent()
  const [resizing, setResizing] = createSignal(false)

  const opened = createMemo(() => layout.codePanel.opened())
  const tabs = createMemo(() => code.tabs())
  const active = createMemo(() => code.active())

  createEffect(() => {
    if (!resizing()) return
    const stop = () => setResizing(false)
    makeEventListener(document, "pointerup", stop)
    makeEventListener(document, "pointercancel", stop)
  })

  const state = createMemo(() => {
    const path = active()
    if (!path) return
    return code.content(path)
  })

  const contents = createMemo(() => state()?.data?.content ?? "")
  const cacheKey = createMemo(() => sampledChecksum(contents()))

  const renderFile = (source: string) => (
    <div class="relative overflow-hidden pb-40">
      <Dynamic
        component={fileComponent}
        mode="text"
        file={{ name: active() ?? "", contents: source, cacheKey: cacheKey() }}
        media={{
          mode: "auto",
          path: active(),
          current: state()?.data,
          readFile: code.readFile,
        }}
        class="select-text"
      />
    </div>
  )

  return (
    <div data-component="code-panel" class="flex h-full min-w-0">
      <Show when={opened() && tabs().length > 0}>
        <aside
          data-slot="code-panel-sidebar"
          class="mr-2 my-2 h-[calc(100%-1rem)] shrink-0 overflow-hidden rounded-[10px] bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]"
          style={{ width: `${layout.codePanel.width()}px` }}
        >
          <div class="flex h-full flex-col overflow-hidden">
            <div data-slot="code-panel-tabs" class="flex shrink-0 items-center gap-0.5 overflow-x-auto no-scrollbar px-1 pt-1">
              <For each={tabs()}>
                {(tab) => (
                  <button
                    type="button"
                    data-active={active() === tab.path ? "" : undefined}
                    class="group/tab relative flex h-7 min-w-0 shrink-0 items-center gap-1.5 rounded-t-[6px] px-2 text-[12px] font-medium text-v2-text-text-muted transition-colors hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base data-[active]:bg-v2-background-bg-layer-01 data-[active]:text-v2-text-text-base"
                    onClick={() => code.setActive(tab.path)}
                    onAuxClick={(event) => {
                      if (event.button !== 1) return
                      code.close(tab.path)
                    }}
                  >
                    <FileIcon node={{ path: tab.path, type: "file" }} class="size-3.5 shrink-0" />
                    <span class="max-w-40 truncate">{getFilename(tab.path)}</span>
                    <span
                      role="button"
                      aria-label={language.t("common.closeTab")}
                      class="flex size-4 shrink-0 items-center justify-center rounded-[4px] opacity-0 transition-opacity hover:bg-v2-overlay-simple-overlay-hover group-hover/tab:opacity-100 group-data-[active]:opacity-100"
                      onClick={(event) => {
                        event.stopPropagation()
                        code.close(tab.path)
                      }}
                    >
                      <Icon name="xmark-small" size="small" />
                    </span>
                  </button>
                )}
              </For>
              <div class="flex-1" />
              <Show when={tabs().length > 0}>
                <TooltipV2 value={language.t("common.close")}>
                  <IconButtonV2
                    variant="ghost-muted"
                    size="small"
                    class="hover-reveal mr-1"
                    icon={<Icon name="xmark-small" />}
                    aria-label={language.t("common.close")}
                    onClick={() => layout.codePanel.close()}
                  />
                </TooltipV2>
              </Show>
            </div>
            <div class="mx-1 h-px shrink-0 bg-v2-border-border-base" />
            <div data-slot="code-panel-content" class="min-h-0 flex-1 overflow-hidden">
              <ScrollView class="h-full" thumbVisibility="scroll">
                <Switch>
                  <Match when={state()?.status === "ready"}>
                    {renderFile(contents())}
                  </Match>
                  <Match when={state()?.status === "loading"}>
                    <div class="px-6 py-4 text-text-weak">
                      {language.t("common.loading")}
                      {language.t("common.loading.ellipsis")}
                    </div>
                  </Match>
                  <Match when={state()?.status === "error"}>
                    <div class="px-6 py-4 text-text-weak">{language.t("common.requestFailed")}</div>
                  </Match>
                  <Match when={true}>
                    <div class="flex min-h-40 items-center justify-center px-6 py-4 text-center text-text-weak">
                      {language.t("session.files.selectToOpen")}
                    </div>
                  </Match>
                </Switch>
              </ScrollView>
            </div>
          </div>
        </aside>
        <div class="my-2 flex shrink-0" onPointerDown={() => setResizing(true)}>
          <ResizeHandle
            direction="horizontal"
            edge="start"
            size={layout.codePanel.width()}
            min={320}
            max={900}
            onResize={(width) => {
              layout.codePanel.resize(width)
            }}
          />
        </div>
      </Show>
    </div>
  )
}
