import { Icon } from "@opencode/ui/icon"
import "@opencode/ui/text-input.css"
import { For, Show } from "solid-js"
import type { TimelineSearchController } from "./search-controller"
import "./search-bar.css"

export function TimelineSearchBar(props: { controller: TimelineSearchController }) {
  const c = props.controller

  return (
    <Show when={c.visible()}>
      <div data-component="timeline-search-bar" class="h-7 w-[240px] max-w-[50vw] shrink-0">
        <div data-component="text-input-v2" data-appearance="base" data-leading-icon class="!h-7 !w-full max-w-full">
          <div data-slot="text-input-v2-value">
            <span data-slot="text-input-v2-leading-icon">
              <Icon name="magnifying-glass" />
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
          <Show when={c.result.showCount()}>
            <span
              data-slot="timeline-search-count"
              class="shrink-0 self-center text-[11px] text-v2-text-text-muted [font-weight:440] tabular-nums"
            >
              {c.result.activeDisplay()}/{c.result.count()}
            </span>
          </Show>
          <For each={[-1, 1]}>
            {(delta) => (
              <button
                type="button"
                class="flex size-5 shrink-0 self-center items-center justify-center rounded-[4px] border-0 bg-transparent p-0 text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover active:bg-v2-overlay-simple-overlay-pressed focus-visible:-outline-offset-2 disabled:pointer-events-none disabled:opacity-40"
                disabled={c.result.count() === 0}
                aria-label={delta < 0 ? c.result.previousLabel() : c.result.nextLabel()}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => c.result.move(delta)}
              >
                <Icon name="chevron-down" classList={{ "rotate-180": delta < 0 }} />
              </button>
            )}
          </For>
          <button
            type="button"
            class="-me-1 flex size-5 shrink-0 self-center items-center justify-center rounded-[4px] border-0 bg-transparent p-0 text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover active:bg-v2-overlay-simple-overlay-pressed focus-visible:-outline-offset-2"
            aria-label={c.query.placeholder()}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => c.query.close()}
          >
            <Icon name="close" />
          </button>
        </div>
      </div>
    </Show>
  )
}
