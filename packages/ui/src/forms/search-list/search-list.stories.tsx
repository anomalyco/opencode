import { createEffect, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { Keybind } from "@opencode/ui/keybind"
import { SearchHighlight, SearchList } from "./search-list"

type Row = { id: string; section: string; title: string; description: string; keybind?: string[] }

const names = ["Sessions", "Commands", "Settings", "Files", "Models", "Projects", "Servers", "Themes"]

const words = ["Desktop", "Palette", "Sticky headers", "Command menu", "Session search", "Model selector", "Theme"]

const args = {
  sections: 4,
  rows: 6,
  sticky: true,
  query: "",
  open: true,
  popover: false,
  grouped: true,
  compactRows: false,
  footer: "",
}

function SearchListStory(props: typeof args) {
  const [store, setStore] = createStore({ query: props.query, selected: "" })

  createEffect(() => setStore("query", props.query))

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
      class="flex w-[640px] max-w-full flex-col rounded-xl bg-v2-background-bg-base shadow-[var(--v2-elevation-floating)]"
      classList={{ "h-[480px] overflow-hidden": props.open && !props.popover }}
      data-static-headers={props.sticky ? undefined : ""}
    >
      <style>{`[data-static-headers] [data-slot="search-list-header"] { position: static; }`}</style>
      <SearchList
        query={store.query}
        onQuery={(query) => setStore("query", query)}
        placeholder="Search files, commands, and sessions"
        items={visible()}
        key={(row) => row.id}
        open={props.open}
        popover={props.popover}
        section={props.grouped ? (row) => row.section : undefined}
        header={props.grouped ? (row) => row.section : undefined}
        footer={[props.footer, store.selected && `Selected: ${store.selected}`].filter(Boolean).join(" · ")}
        empty="No results"
        onSelect={(row) => setStore("selected", row.title)}
      >
        {(row, attrs) => (
          <button type="button" data-size={props.compactRows ? "compact" : undefined} {...attrs}>
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
  args,
  argTypes: {
    sections: { control: { type: "range", min: 1, max: 8, step: 1 } },
    rows: { control: { type: "range", min: 1, max: 200, step: 1 } },
  },
}

export const Palette = {}

export const LongLists = { args: { sections: 6, rows: 120 } }

export const Searching = { args: { query: "desk" } }

export const WithoutStickyHeaders = { args: { sticky: false } }

export const Empty = { args: { query: "no matches" } }
