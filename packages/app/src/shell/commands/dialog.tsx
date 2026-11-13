import { getDirectory, getFilename } from "@opencode/util/path"
import { FileIcon } from "@opencode/ui/file-icon"
import { Button } from "@opencode/ui/button"
import { Dialog, DialogBody } from "@opencode/ui/dialog"
import { Keybind } from "@opencode/ui/keybind"
import { Tooltip } from "@opencode/ui/tooltip"
import { SearchHighlight, SearchList, type SearchListRow } from "@opencode/ui/search-list"
import { createMemo, Match, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { formatKeybindParts } from "@/shell/commands/command"
import { useLanguage } from "@/runtime/i18n/language"
import { useTabs } from "@/shell/tabs/tabs"
import { ActivityRing } from "@opencode/ui/activity-ring"
import { Loader } from "@opencode/ui/loader"
import { SessionTabAvatarView } from "@/shell/layout/session-tab-avatar"
import { useSessionTabAvatarState } from "@/shell/layout/project-avatar-state"
import type { ServerConnection } from "@/runtime/server/registry"
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
  /** The row whose selection is still in progress, such as an archived session being restored. */
  busyEntryID?: string
  unhide?: (entry: CommandPaletteEntry) => (() => void) | undefined
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
          {(item, row) => {
            const entry = () => (
              <PaletteRow
                row={row}
                item={item()}
                language={language}
                sessionOpen={sessionOpen(item())}
                busy={props.busyEntryID === item().id}
              />
            )

            return (
              <Show when={props.unhide?.(item())} fallback={entry()}>
                {(unhide) => (
                  <div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1">
                    {entry()}
                    <Button size="small" variant="ghost-muted" onClick={() => unhide()()}>
                      {language.t("sidebar.recent.unhide")}
                    </Button>
                  </div>
                )}
              </Show>
            )
          }}
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
  busy: boolean
}) {
  const session = () =>
    props.item.server && props.item.directory && props.item.sessionID
      ? { server: props.item.server, directory: props.item.directory, sessionID: props.item.sessionID }
      : undefined

  return (
    <button
      type="button"
      class="command-palette-row group"
      data-size="compact"
      aria-busy={props.busy || undefined}
      {...props.row}
    >
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
        <Match when={props.item.type === "session" && session()}>
          {(session) => (
            <PaletteSessionRow
              item={props.item}
              server={session().server}
              directory={session().directory}
              sessionID={session().sessionID}
              language={props.language}
              sessionOpen={props.sessionOpen}
              busy={props.busy}
            />
          )}
        </Match>
      </Switch>
    </button>
  )
}

function PaletteSessionRow(props: {
  item: CommandPaletteEntry
  server: ServerConnection.Key
  directory: string
  sessionID: string
  language: ReturnType<typeof useLanguage>
  sessionOpen: boolean
  busy: boolean
}) {
  const status = useSessionTabAvatarState(
    () => props.server,
    () => props.sessionID,
    () => true,
  )

  return (
    <>
      <div class="command-palette-row-main">
        <div class="relative shrink-0">
          <Show when={props.sessionOpen}>
            <span
              aria-hidden="true"
              class="pointer-events-none absolute top-1/2 h-3 w-0.5 -translate-y-1/2 rounded-[2px] bg-v2-background-bg-layer-04"
              style={{ "inset-inline-start": "-6px" }}
            />
          </Show>
          {/* A busy session shows its activity ring instead of the unread dot, as session tabs do. */}
          <SessionTabAvatarView
            project={props.item.project}
            directory={props.directory}
            unread={status.unread() && !status.loading()}
          />
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
              <span class="command-palette-description" dir="auto" classList={{ "opacity-70": !!props.item.archived }}>
                <SearchHighlight text={description()} />
              </span>
            )}
          </Show>
        </div>
      </div>
      {/* The project avatar stays put; a working session shows its activity ring where its age would be, and a session
      being restored a loader. */}
      <Switch
        fallback={
          <Show when={props.item.updated}>
            {(updated) => (
              <Tooltip
                class="shrink-0"
                placement="top"
                value={new Intl.DateTimeFormat(props.language.intl(), {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                }).format(updated())}
              >
                <span class="command-palette-meta">
                  {getRelativeTime(new Date(updated()).toISOString(), props.language.t, props.language.intl())}
                </span>
              </Tooltip>
            )}
          </Show>
        }
      >
        <Match when={props.busy}>
          <span class="command-palette-meta">
            <Loader
              class="size-3.5 shrink-0"
              role="img"
              aria-hidden="false"
              aria-label={props.language.t("common.loading")}
            />
          </span>
        </Match>
        <Match when={status.loading()}>
          <span class="command-palette-meta">
            <span class="sr-only">{props.language.t("session.timeline.working")}</span>
            <ActivityRing />
          </span>
        </Match>
      </Switch>
    </>
  )
}
