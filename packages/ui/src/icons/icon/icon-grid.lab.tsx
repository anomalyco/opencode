import { For, Show } from "solid-js"
import { Button } from "../../actions/button/button"
import { Popover } from "../../components/popover"
import { artworkNames } from "../catalog"
import { iconOrigins } from "./icon-audit-data"
import { iconSourceFiles, unusedDesktopIcons } from "./icon-usage-data"
import { Icon } from "./icon"

const names = artworkNames().toSorted()

const groups = [
  { label: "Unused on desktop", names: unusedDesktopIcons },
  { label: "Used on desktop", names: names.filter((name) => iconSourceFiles.has(name)) },
]

export default {
  title: "App/Design review/Icon grid",
  id: "ui-icon-grid",
}

export const Gallery = {
  render: () => (
    <section class="flex w-full max-w-4xl flex-col gap-4">
      <div class="flex flex-col gap-1">
        <h2 class="text-14-medium text-v2-text-text-base">Icon grid · {names.length} icons</h2>
        <p class="text-[13px] leading-[var(--line-height-base)] text-v2-text-text-muted">
          Dates and authors come from Git history. Source files show built-in desktop usage, including aliases.
        </p>
      </div>
      <div data-scrollable class="flex max-h-[70vh] flex-col gap-5 overflow-auto">
        <For each={groups}>
          {(group) => (
            <section class="flex flex-col gap-2">
              <h3 class="text-12-medium text-v2-text-text-base">
                {group.label} · {group.names.length}
              </h3>
              <ul class="grid grid-cols-[repeat(auto-fill,minmax(min(100%,144px),1fr))] gap-2">
                <For each={group.names}>
                  {(name) => (
                    <li class="flex min-w-0 flex-col gap-2 rounded-md border border-v2-border-border-base p-3">
                      <Icon name={name} size="large" class="text-v2-text-text-base" />
                      <bdi class="text-12-mono text-v2-text-text-base [overflow-wrap:anywhere]">{name}</bdi>
                      <Show
                        when={iconOrigins[name]}
                        keyed
                        fallback={<span class="text-12-regular text-v2-text-text-muted">Git history not recorded</span>}
                      >
                        {(origin) => (
                          <div class="flex flex-col text-12-regular text-v2-text-text-muted">
                            <time datetime={origin[0]}>{origin[0]}</time>
                            <bdi class="[overflow-wrap:anywhere]">{origin[1]}</bdi>
                          </div>
                        )}
                      </Show>
                      <Show
                        when={iconSourceFiles.get(name)}
                        keyed
                        fallback={<span class="mt-auto text-12-regular text-v2-text-text-muted">No usage found</span>}
                      >
                        {(files) => {
                          const count = files.length === 1 ? "1 source file" : `${files.length} source files`

                          return (
                            <Popover
                              triggerAs={Button}
                              trigger={count}
                              triggerProps={{
                                size: "small",
                                variant: "ghost",
                                class: "mt-auto self-start",
                                "aria-label": `${count} for ${name}`,
                              }}
                              title={name}
                              description="Built-in desktop source files"
                              class="max-w-[min(32rem,calc(100vw_-_2rem))]"
                            >
                              <ul data-scrollable class="grid max-h-[45vh] gap-2 overflow-auto">
                                <For each={files}>
                                  {(file) => <li class="text-12-mono [overflow-wrap:anywhere]">{file}</li>}
                                </For>
                              </ul>
                            </Popover>
                          )
                        }}
                      </Show>
                    </li>
                  )}
                </For>
              </ul>
            </section>
          )}
        </For>
      </div>
    </section>
  ),
}
