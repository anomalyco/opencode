import { Icon } from "@opencode-ai/ui/icon"
import "@opencode-ai/ui/text-input.css"
import { Show } from "solid-js"
import type { TimelineSearchController } from "./search-controller"
import "./search-bar.css"

export function TimelineSearchBar(props: { controller: TimelineSearchController }) {
  const c = props.controller

  return (
    <Show when={c.visible()}>
      <div data-component="timeline-search-bar" class="h-7 w-[200px] max-w-[50vw] shrink-0">
        <div data-component="text-input-v2" data-appearance="base" data-leading-icon class="!h-7 !w-full max-w-full">
          <div data-slot="text-input-v2-value">
            <span data-slot="text-input-v2-leading-icon">
              <Icon name="magnifying-glass" size="small" />
            </span>
            <input
              ref={c.element.setInput}
              data-slot="text-input-v2-input"
              type="search"
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
          </div>
          <Show when={c.query.value()}>
            <span class="shrink-0 self-center text-[11px] text-v2-text-text-muted [font-weight:440] tabular-nums">
              {c.result.count() > 0 ? c.result.activeIndex() + 1 : 0}/{c.result.count()}
            </span>
          </Show>
          <button
            type="button"
            class="-me-1 flex size-5 shrink-0 self-center items-center justify-center rounded-[2px] border-0 bg-transparent p-0 text-v2-icon-icon-muted outline outline-1 outline-transparent hover:bg-v2-overlay-simple-overlay-hover active:bg-v2-overlay-simple-overlay-pressed focus-visible:outline-v2-border-border-focus"
            aria-label={c.query.placeholder()}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => c.query.close()}
          >
            <Icon name="xmark-small" />
          </button>
        </div>
      </div>
    </Show>
  )
}
