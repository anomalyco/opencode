import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { useLanguage } from "@/context/language"
import { Show } from "solid-js"
import { Portal } from "solid-js/web"
import { useTitlebarRightMount } from "@/components/titlebar"
import type { TimelineSearchController } from "./search-controller"

export function TimelineSearchBar(props: { controller: TimelineSearchController }) {
  const language = useLanguage()
  const rightMount = useTitlebarRightMount()
  const c = props.controller

  return (
    <Show when={c.visible() && rightMount()} keyed>
      {(mount) => (
        <Portal mount={mount}>
          <div
            data-component="timeline-search-bar"
            class="flex items-center gap-1 h-7 shrink-0 rounded-[6px] border n-border-border-base pl-2.5 pr-1 bg-v2-background-bg-layer-02/60 text-v2-icon-icon-muted transition-[background-color,box-shadow] duration-[120ms] ease-in-out hover:bg-v2-background-bg-layer-02 focus-within:bg-v2-background-bg-layer-02 w-[200px]"
          >
            <IconV2 name="magnifying-glass" size="small" class="shrink-0 text-v2-icon-icon-muted" />
            <input
              ref={c.element.setInput}
              class="relative z-20 min-w-0 flex-1 border-0 bg-transparent outline-0 text-v2-text-text-base text-[13px] [font-weight:440] placeholder:text-v2-text-text-faint"
              type="text"
              value={c.query.value()}
              placeholder={c.query.placeholder()}
              aria-label={c.query.placeholder()}
              onInput={(event) => c.query.setValue(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault()
                  c.query.close()
                  return
                }
                if (event.altKey || event.metaKey || event.ctrlKey) return
                if (event.key === "Enter" && !event.isComposing) {
                  event.preventDefault()
                  c.result.move(event.shiftKey ? -1 : 1)
                  return
                }
                if (event.key === "ArrowDown" && !event.isComposing) {
                  event.preventDefault()
                  c.result.move(1)
                  return
                }
                if (event.key === "ArrowUp" && !event.isComposing) {
                  event.preventDefault()
                  c.result.move(-1)
                  return
                }
              }}
            />
            <Show when={c.query.value()}>
              <Show
                when={c.result.count() > 0}
                fallback={
                  <span class="shrink-0 text-[12px] text-v2-text-text-muted [font-weight:440] tabular-nums">
                    {c.query.noResults()}
                  </span>
                }
              >
                <span class="shrink-0 text-[12px] text-v2-text-text-muted [font-weight:440] tabular-nums">
                  {c.result.activeIndex() + 1}/{c.result.count()}
                </span>
                <IconButtonV2
                  type="button"
                  variant="ghost-muted"
                  size="small"
                  class="relative z-20 shrink-0 !size-5"
                  aria-label={language.t("command.message.previous")}
                  onClick={() => c.result.move(-1)}
                  icon={<IconV2 name="chevron-down" size="small" class="[transform:rotate(180deg)]" />}
                />
                <IconButtonV2
                  type="button"
                  variant="ghost-muted"
                  size="small"
                  class="relative z-20 shrink-0 !size-5"
                  aria-label={language.t("command.message.next")}
                  onClick={() => c.result.move(1)}
                  icon={<IconV2 name="chevron-down" size="small" />}
                />
              </Show>
              <IconButtonV2
                type="button"
                variant="ghost-muted"
                size="small"
                class="relative z-20 shrink-0 !size-5"
                aria-label={c.query.placeholder()}
                onClick={() => c.query.close()}
                icon={<IconV2 name="close" size="large" class="text-v2-icon-icon-muted" />}
              />
            </Show>
          </div>
        </Portal>
      )}
    </Show>
  )
}
