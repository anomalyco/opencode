import { createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { Keybind } from "@opencode/ui/keybind"
import { SearchHighlight, SearchList } from "./search-list"

type Row = { id: string; section: string; title: string; description: string; keybind?: string[] }

const names = ["Sessions", "Commands", "Settings", "Files", "Models", "Projects", "Servers", "Themes"]

const words = ["Desktop", "Palette", "Sticky headers", "Command menu", "Session search", "Model selector", "Theme"]

function SearchListStory(props: { sections: number; rows: number; sticky: boolean; query: string }) {
  const [store, setStore] = createStore({ query: props.query, selected: "" })

  const rows = createMemo(() =>
    names.slice(0, Math.max(1, props.sections)).flatMap((section, s) =>
      Array.from(
        { length: Math.max(1, props.rows) },
        (_, index): Row => ({
          id: `${section}-${index}`,
          section,
          title: `${words[(index + s) % words.length]} ${index + 1}`,
          description: section === "Sessions" ? "opencode" : section,
          keybind: section === "Commands" && index < 3 ? ["⌥", index % 2 ? "↓" : "↑"] : undefined,
        }),
      ),
    ),
  )

  const visible = createMemo(() => {
    const query = store.query.trim().toLowerCase()

    return query ? rows().filter((row) => `${row.title} ${row.description}`.toLowerCase().includes(query)) : rows()
  })

  return (
    <div
      class="flex h-[480px] w-[640px] flex-col overflow-hidden rounded-xl bg-v2-background-bg-base shadow-[var(--v2-elevation-floating)]"
      data-static-headers={props.sticky ? undefined : ""}
    >
      <style>{`[data-static-headers] [data-slot="search-list-header"] { position: static; }`}</style>
      <SearchList
        query={store.query}
        onQuery={(query) => setStore("query", query)}
        placeholder="Search files, commands, and sessions"
        items={visible()}
        key={(row) => row.id}
        section={(row) => row.section}
        header={(row) => row.section}
        empty="No results"
        onSelect={(row) => setStore("selected", row.id)}
      >
        {(row, attrs) => (
          <button type="button" {...attrs}>
            <span class="flex min-w-0 items-center gap-1.5 text-[13px] leading-4 tracking-[-0.04px]">
              <span class="truncate font-[530] text-v2-text-text-base">
                <SearchHighlight text={row().title} />
              </span>
              <span class="truncate text-v2-text-text-muted">
                <SearchHighlight text={row().description} />
              </span>
            </span>
            {row().keybind && <Keybind keys={row().keybind!} variant="neutral" />}
          </button>
        )}
      </SearchList>
    </div>
  )
}

export default {
  title: "UI/Search List",
  id: "ui-search-list",
  component: SearchListStory,
  args: { sections: 4, rows: 6, sticky: true, query: "" },
  argTypes: {
    sections: { control: { type: "range", min: 1, max: 8, step: 1 } },
    rows: { control: { type: "range", min: 1, max: 200, step: 1 } },
  },
}

export const Palette = {}

export const LongLists = { args: { sections: 6, rows: 120 } }

export const Searching = { args: { query: "desk" } }

export const WithoutStickyHeaders = { args: { sticky: false } }
