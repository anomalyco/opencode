import { For, Show, createEffect, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { DockTray } from "@opencode-ai/ui/dock-surface"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { useLanguage } from "@/context/language"
import { useSettings } from "@/context/settings"

export function SessionRevertDock(props: {
  items: { id: string; text: string }[]
  restoring?: string
  disabled?: boolean
  onRestore: (id: string) => void
}) {
  const language = useLanguage()
  const settings = useSettings()
  const [store, setStore] = createStore({
    collapsed: true,
  })

  createEffect(() => {
    props.items.length
    props.items[0]?.id
    setStore("collapsed", true)
  })

  const toggle = () => setStore("collapsed", (value) => !value)
  const total = createMemo(() => props.items.length)
  const label = createMemo(() =>
    language.t(total() === 1 ? "session.revertDock.summary.one" : "session.revertDock.summary.other", {
      count: total(),
    }),
  )
  const preview = createMemo(() => props.items[0]?.text ?? "")

  const onHeaderKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return
    event.preventDefault()
    toggle()
  }

  return (
    <Show
      when={settings.general.newLayoutDesigns()}
      fallback={
        <DockTray data-component="session-revert-dock">
          <div
            class="pl-3 pr-2 py-2 flex items-center gap-2"
            role="button"
            tabIndex={0}
            onClick={toggle}
            onKeyDown={onHeaderKeyDown}
          >
            <span class="shrink-0 text-14-regular text-text-strong cursor-default">{label()}</span>
            <Show when={store.collapsed && preview()}>
              <span class="min-w-0 flex-1 truncate text-14-regular text-text-base cursor-default">{preview()}</span>
            </Show>
            <div class="ml-auto shrink-0">
              <IconButton
                icon="chevron-down"
                size="normal"
                variant="ghost"
                style={{ transform: `rotate(${store.collapsed ? 180 : 0}deg)` }}
                onMouseDown={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                }}
                onClick={(event) => {
                  event.stopPropagation()
                  toggle()
                }}
                aria-label={
                  store.collapsed ? language.t("session.revertDock.expand") : language.t("session.revertDock.collapse")
                }
              />
            </div>
          </div>

          <Show when={store.collapsed}>
            <div class="h-5" aria-hidden="true" />
          </Show>

          <Show when={!store.collapsed}>
            <div class="px-3 pb-7 flex flex-col gap-1.5 max-h-42 overflow-y-auto no-scrollbar">
              <For each={props.items}>
                {(item) => (
                  <div class="flex items-center gap-2 min-w-0 py-1">
                    <span class="min-w-0 flex-1 truncate text-13-regular text-text-strong">{item.text}</span>
                    <Button
                      size="small"
                      variant="secondary"
                      class="shrink-0"
                      disabled={props.disabled || !!props.restoring}
                      onClick={() => props.onRestore(item.id)}
                    >
                      {language.t("session.revertDock.restore")}
                    </Button>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </DockTray>
      }
    >
      <div
        data-component="session-revert-dock"
        class="w-full overflow-hidden rounded-xl border-[0.5px] border-v2-border-border-base bg-v2-background-bg-layer-01"
      >
        <div
          class="flex h-[42px] items-center gap-2 pl-4 pr-2"
          role="button"
          tabIndex={0}
          onClick={toggle}
          onKeyDown={onHeaderKeyDown}
        >
          <IconV2 name="outline-reset" size="normal" class="text-v2-icon-icon-muted" />
          <span
            classList={{
              "font-[440] shrink-0 cursor-default text-[13px] leading-5 tracking-[-0.04px]": true,
              "text-v2-text-text-base": !store.collapsed,
              "text-v2-text-text-muted": store.collapsed,
            }}
          >
            {label()}
          </span>
          <Show when={store.collapsed && preview()}>
            <span class="min-w-0 flex-1 truncate cursor-default text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-faint">
              {preview()}
            </span>
          </Show>
          <div class="ml-auto shrink-0">
            <IconButtonV2
              icon={<IconV2 name="outline-chevron-down" size="small" />}
              size="large"
              variant="ghost-muted"
              style={{ transform: `rotate(${store.collapsed ? 180 : 0}deg)` }}
              onMouseDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
              }}
              onClick={(event) => {
                event.stopPropagation()
                toggle()
              }}
              aria-label={
                store.collapsed ? language.t("session.revertDock.expand") : language.t("session.revertDock.collapse")
              }
            />
          </div>
        </div>

        {/* Sacrificial space the composer overlaps via its negative lift (18px), so the header stays fully visible */}
        <Show when={store.collapsed}>
          <div class="h-[18px]" aria-hidden="true" />
        </Show>

        <Show when={!store.collapsed}>
          {/* Scroll viewport ends above the composer; the 18px sacrificial below is what the composer overlaps */}
          <div class="flex max-h-42 flex-col gap-2 overflow-y-auto px-4 pt-px pb-3 no-scrollbar">
            <For each={props.items}>
              {(item) => (
                <div class="flex h-6 min-w-0 items-center gap-2">
                  <span class="min-w-0 flex-1 truncate text-[13px] font-[400] leading-5 tracking-[-0.04px] text-v2-text-text-muted">
                    {item.text}
                  </span>
                  <ButtonV2
                    size="small"
                    variant="neutral"
                    class="shrink-0"
                    disabled={props.disabled || !!props.restoring}
                    onClick={() => props.onRestore(item.id)}
                  >
                    {language.t("session.revertDock.restore")}
                  </ButtonV2>
                </div>
              )}
            </For>
          </div>
          <div class="h-[18px]" aria-hidden="true" />
        </Show>
      </div>
    </Show>
  )
}
