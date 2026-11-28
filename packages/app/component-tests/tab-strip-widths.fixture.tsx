import { For, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { render } from "solid-js/web"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Tabs } from "@opencode/ui/tabs"
import { createTabStripScroll } from "../src/runtime/plugin/tab-strip-scroll"
import { createTabStripWidths } from "../src/runtime/plugin/tab-strip-widths"

const [state, setState] = createStore<{ titles: string[]; width: number }>({ titles: [], width: 0 })

const host = document.createElement("div")

/** A side pane tab strip built as `PaneTabs` builds it, with the host's tab styles, close buttons and sticky "+". */
export function mountTabStrip(input: { titles: string[]; width: number; dir: "ltr" | "rtl" }) {
  setState({ titles: input.titles, width: input.width })
  host.dataset.testid = "tab-strip-fixture"
  host.dir = input.dir
  // Above the story, at a fixed place in the viewport, so pointer positions stay put.
  host.style.cssText = "position: fixed; top: 200px; left: 20px; z-index: 1000"
  document.body.appendChild(host)
  render(() => {
    const close = (title: string) => setState("titles", (titles) => titles.filter((item) => item !== title))

    return (
      <aside id="review-panel" class="relative flex" style={{ width: `${state.width}px` }}>
        <Tabs value={state.titles[0] ?? ""}>
          <div class="session-review-v2-tabs-bar sticky top-0 shrink-0 flex items-center">
            <Tabs.List
              ref={(el: HTMLDivElement) => {
                onCleanup(createTabStripScroll({ el, lead: () => false }))
                onCleanup(createTabStripWidths(el))
              }}
            >
              <For each={state.titles}>
                {(title) => (
                  <div data-pane-tab={title} class="h-full flex items-center">
                    <div class="relative min-w-0">
                      <Tabs.Trigger
                        value={title}
                        onMiddleClick={title.startsWith("pinned") ? undefined : () => close(title)}
                        closeButton={
                          <IconButton
                            size="small"
                            variant="ghost-muted"
                            onPointerDown={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                            }}
                            onClick={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                              close(title)
                            }}
                            icon={<Icon name="close" />}
                            aria-label={`Close ${title}`}
                          />
                        }
                        hideCloseButton
                      >
                        <span class="truncate">{title}</span>
                      </Tabs.Trigger>
                    </div>
                  </div>
                )}
              </For>
              <div class="h-full shrink-0 sticky end-0 z-10 flex items-center justify-center bg-v2-background-bg-base">
                <IconButton icon={<Icon name="plus" />} variant="ghost-muted" size="large" aria-label="Add tab" />
              </div>
            </Tabs.List>
          </div>
        </Tabs>
      </aside>
    )
  }, host)
}

export const setTabStripWidth = (width: number) => setState("width", width)
