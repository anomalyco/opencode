import { getDirectory, getFilename } from "@opencode/util/path"
import { FileIcon } from "@opencode/ui/file-icon"
import { Dialog, DialogBody } from "@opencode/ui/dialog"
import { Keybind } from "@opencode/ui/keybind"
import { SearchHighlight, SearchList, type SearchListRow } from "@opencode/ui/search-list"
import { createMemo, Match, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { formatKeybindParts } from "@/shell/commands/command"
import { useLanguage } from "@/runtime/i18n/language"
import { useTabs } from "@/shell/tabs/tabs"
import { SessionTabAvatar } from "@/shell/layout/session-tab-avatar"
import { getRelativeTime } from "@/shell/time"
import { createCommandPaletteFileEntry, createCommandPaletteModel, type CommandPaletteEntry } from "./palette"
import { createCommandPaletteSearch, matchesCommandPaletteEntry } from "./search"
import "./dialog.css"
import "../palette-menu.css"

export { matchesCommandPaletteEntry }

function groupKey(entry: CommandPaletteEntry) {
  return entry.type === "session" ? "session" : `${entry.type}:${entry.category}`
}

export function DialogCommandPalette(props: { onOpenFile?: (path: string) => void }) {
  const palette = createCommandPaletteModel(props)

  const items = (q: string) => {
    if (!q) return [...palette.preferredCommandEntries(), ...palette.recentFileEntries(), ...palette.sessions.items("")]

    return [
      ...palette.commandEntries().filter((entry) => matchesCommandPaletteEntry(entry, q)),
      ...palette.sessions.items(q),
      ...palette.settings.items(q),
    ]
  }

  return (
    <CommandPaletteView
      placeholder={palette.language.t("palette.search.placeholder")}
      items={items}
      sources={[
        palette.sessions.search,
        async (query, signal) => {
          if (!query) return palette.recentFileEntries()
          const files = await palette.file.searchFiles(query, { signal })
          const category = palette.language.t("palette.group.files")

          return files.map((path) => createCommandPaletteFileEntry(path, category))
        },
      ]}
      highlight={palette.highlight}
      select={palette.select}
      close={palette.close}
    />
  )
}

export function CommandPaletteView(props: {
  placeholder: string
  items: (query: string) => CommandPaletteEntry[]
  sources: ((query: string, signal: AbortSignal) => Promise<CommandPaletteEntry[]>)[]
  highlight: (item: CommandPaletteEntry | undefined) => void
  select: (item: CommandPaletteEntry | undefined) => void
  close: () => void
}) {
  const language = useLanguage()
  const tabs = useTabs()
  const [store, setStore] = createStore({ query: "" })

  const openSessions = createMemo(
    () => new Set(tabs.store.flatMap((tab) => (tab.type === "session" ? [`${tab.server}\0${tab.sessionId}`] : []))),
  )

  const sessionOpen = (entry: CommandPaletteEntry) =>
    !!entry.server && !!entry.sessionID && openSessions().has(`${entry.server}\0${entry.sessionID}`)

  const search = createCommandPaletteSearch({
    query: () => store.query,
    items: props.items,
    sources: props.sources,
    open: sessionOpen,
  })

  return (
    <Dialog class="command-palette command-palette-compact" size="large" fit>
      <DialogBody class="command-palette-body">
        <SearchList
          query={store.query}
          onQuery={(query) => setStore("query", query)}
          placeholder={props.placeholder}
          items={search.items()}
          key={(entry) => entry.id}
          section={groupKey}
          header={(entry) => entry.category || undefined}
          empty={
            search.loading()
              ? language.t("common.loading")
              : search.failed()
                ? language.t("common.requestFailed")
                : language.t("palette.empty")
          }
          onActive={props.highlight}
          onSelect={props.select}
          onClose={props.close}
        >
          {(item, row) => <PaletteRow row={row} item={item()} language={language} sessionOpen={sessionOpen(item())} />}
        </SearchList>
      </DialogBody>
    </Dialog>
  )
}

function PaletteRow(props: {
  row: SearchListRow
  item: CommandPaletteEntry
  language: ReturnType<typeof useLanguage>
  sessionOpen: boolean
}) {
  const session = () =>
    props.item.server && props.item.directory && props.item.sessionID
      ? { server: props.item.server, directory: props.item.directory, sessionID: props.item.sessionID }
      : undefined

  return (
    <button type="button" class="command-palette-row group" data-size="compact" {...props.row}>
      <Switch
        fallback={
          <div class="command-palette-row-main">
            <FileIcon node={{ path: props.item.path ?? "", type: "file" }} class="command-palette-row-icon size-4" />
            <div class="command-palette-file-path" dir="ltr">
              <span class="command-palette-file-dir">
                <SearchHighlight text={getDirectory(props.item.path ?? "")} />
              </span>
              <span class="command-palette-file-name">
                <SearchHighlight text={getFilename(props.item.path ?? "")} />
              </span>
            </div>
          </div>
        }
      >
        <Match when={props.item.type === "command" || props.item.type === "setting"}>
          <div class="command-palette-row-main">
            <div class="command-palette-row-text">
              <span class="command-palette-title palette-menu-title" dir="auto">
                <SearchHighlight text={props.item.title} />
              </span>
              <Show when={props.item.description}>
                {(description) => (
                  <span class="command-palette-description" dir="auto">
                    <SearchHighlight text={description()} />
                  </span>
                )}
              </Show>
            </div>
          </div>
          <Show when={props.item.keybind}>
            <Keybind keys={formatKeybindParts(props.item.keybind ?? "", props.language.t)} variant="neutral" />
          </Show>
        </Match>
        <Match when={props.item.type === "session"}>
          <div class="command-palette-row-main">
            <div class="relative shrink-0">
              <Show when={props.sessionOpen}>
                <span
                  aria-hidden="true"
                  class="pointer-events-none absolute top-1/2 h-3 w-0.5 -translate-y-1/2 rounded-[2px] bg-v2-background-bg-layer-04"
                  style={{ "inset-inline-start": "-6px" }}
                />
              </Show>
              <Show when={session()}>
                {(session) => (
                  <SessionTabAvatar
                    project={props.item.project}
                    directory={session().directory}
                    sessionId={session().sessionID}
                    server={session().server}
                  />
                )}
              </Show>
            </div>
            <div class="command-palette-row-text">
              <span
                class="command-palette-title palette-menu-title"
                dir="auto"
                classList={{ "opacity-70": !!props.item.archived }}
              >
                <SearchHighlight text={props.item.title} />
              </span>
              <Show when={props.item.description}>
                {(description) => (
                  <span
                    class="command-palette-description"
                    dir="auto"
                    classList={{ "opacity-70": !!props.item.archived }}
                  >
                    <SearchHighlight text={description()} />
                  </span>
                )}
              </Show>
            </div>
          </div>
          <Show when={props.item.updated}>
            <span class="command-palette-meta">
              {getRelativeTime(new Date(props.item.updated!).toISOString(), props.language.t)}
            </span>
          </Show>
        </Match>
      </Switch>
    </button>
  )
}
