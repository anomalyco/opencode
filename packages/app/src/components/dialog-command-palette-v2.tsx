import { getDirectory, getFilename } from "@opencode-ai/core/util/path"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { Dialog, DialogBody } from "@opencode-ai/ui/v2/dialog-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { KeybindV2 } from "@opencode-ai/ui/v2/keybind-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { createEffect, createMemo, createResource, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js"
import { commandPaletteOptions, formatKeybindParts, useCommand } from "@/context/command"
import { useGlobal } from "@/context/global"
import { useLanguage } from "@/context/language"
import { ServerConnection } from "@/context/server"
import { useTabs } from "@/context/tabs"
import { SessionTabAvatar } from "@/pages/layout/session-tab-avatar"
import { getRelativeTime } from "@/utils/time"
import {
  createCommandPaletteCommandEntry,
  createCommandPaletteFileEntry,
  createCommandPaletteModel,
  createServerSessionEntries,
  uniqueCommandPaletteEntries,
  type CommandPaletteEntry,
} from "./command-palette"
import "./dialog-command-palette-v2.css"

function groups(entries: CommandPaletteEntry[]) {
  const map = new Map<string, CommandPaletteEntry[]>()
  for (const entry of entries) map.set(entry.category, [...(map.get(entry.category) ?? []), entry])
  return Array.from(map.entries()).map(([category, entries]) => ({ category, entries }))
}

function matchesEntry(entry: CommandPaletteEntry, query: string) {
  const value = query.toLowerCase()
  return [entry.title, entry.description, entry.category].some((text) => text?.toLowerCase().includes(value))
}

export function DialogCommandPaletteV2(props: { onOpenFile?: (path: string) => void }) {
  const palette = createCommandPaletteModel(props)
  const loadItems = async (text: string) => {
    const q = text.trim()
    if (!q) return [...palette.preferredCommandEntries(), ...palette.recentFileEntries()]

    const [files, nextSessions] = await Promise.all([palette.file.searchFiles(q), Promise.resolve(palette.sessions(q))])
    const category = palette.language.t("palette.group.files")
    return [
      ...palette.commandEntries().filter((entry) => matchesEntry(entry, q)),
      ...nextSessions,
      ...files.map((path) => createCommandPaletteFileEntry(path, category)),
    ]
  }

  return (
    <CommandPaletteView
      placeholder={palette.language.t("palette.search.placeholder")}
      loadItems={loadItems}
      highlight={palette.highlight}
      select={palette.select}
      close={palette.close}
    />
  )
}

export function DialogHomeCommandPaletteV2(props: {
  server: ServerConnection.Any
  onSelectSession: (entry: CommandPaletteEntry) => void
}) {
  const command = useCommand()
  const dialog = useDialog()
  const global = useGlobal()
  const language = useLanguage()
  const serverCtx = global.ensureServerCtx(props.server)
  const state = { cleanup: undefined as (() => void) | void, committed: false }
  const commandEntries = createMemo(() => {
    const category = language.t("palette.group.commands")
    return commandPaletteOptions(command.options).map((option) => createCommandPaletteCommandEntry(option, category))
  })
  const sessions = createServerSessionEntries({
    server: ServerConnection.key(props.server),
    opened: serverCtx.projects.list,
    stored: () => serverCtx.sync.data.project,
    load: (search, signal) =>
      serverCtx.sdk.client.experimental.session.list({ roots: true, search, limit: 50 }, { signal }),
    untitled: () => language.t("command.session.new"),
    category: () => language.t("command.category.session"),
  })

  const highlight = (item: CommandPaletteEntry | undefined) => {
    state.cleanup?.()
    state.cleanup = undefined
    if (item?.type !== "command") return
    state.cleanup = item.option?.onHighlight?.()
  }
  const select = (item: CommandPaletteEntry | undefined) => {
    if (!item) return
    state.committed = true
    state.cleanup = undefined
    dialog.close()
    if (item.type === "command") {
      item.option?.onSelect?.("palette")
      return
    }
    if (item.type === "session") props.onSelectSession(item)
  }
  const loadItems = async (text: string) => {
    const query = text.trim()
    if (!query) return commandEntries().slice(0, 5)
    return [...commandEntries().filter((entry) => matchesEntry(entry, query)), ...(await sessions(query))]
  }

  onCleanup(() => {
    if (state.committed) return
    state.cleanup?.()
  })

  return (
    <CommandPaletteView
      placeholder={language.t("palette.search.placeholder.home")}
      loadItems={loadItems}
      highlight={highlight}
      select={select}
      close={() => dialog.close()}
    />
  )
}

function CommandPaletteView(props: {
  placeholder: string
  loadItems: (text: string) => CommandPaletteEntry[] | Promise<CommandPaletteEntry[]>
  highlight: (item: CommandPaletteEntry | undefined) => void
  select: (item: CommandPaletteEntry | undefined) => void
  close: () => void
}) {
  const language = useLanguage()
  const tabs = useTabs()
  const [query, setQuery] = createSignal("")
  const [active, setActive] = createSignal(0)

  const [entries] = createResource(query, props.loadItems, { initialValue: [] as CommandPaletteEntry[] })
  // Render stale results while a new query loads to avoid flashing "Loading" per keystroke.
  const visibleEntries = createMemo(() => uniqueCommandPaletteEntries(entries.latest ?? []))
  const groupedEntries = createMemo(() => groups(visibleEntries()))
  const activeEntry = createMemo(() => visibleEntries()[active()])
  const openSessions = createMemo(
    () => new Set(tabs.store.flatMap((tab) => (tab.type === "session" ? [`${tab.server}\0${tab.sessionId}`] : []))),
  )

  createEffect(() => {
    query()
    visibleEntries()
    setActive(0)
  })

  createEffect(() => {
    props.highlight(activeEntry())
  })

  let resultsRef: HTMLDivElement | undefined

  const move = (delta: -1 | 1) => {
    const count = visibleEntries().length
    if (count === 0) return
    setActive((index) => (index + delta + count) % count)
    requestAnimationFrame(() => {
      resultsRef?.querySelector("[data-active]")?.scrollIntoView({ block: "nearest" })
    })
  }

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      move(1)
      return
    }
    if (event.key === "ArrowUp") {
      event.preventDefault()
      move(-1)
      return
    }
    if (event.key === "Enter") {
      event.preventDefault()
      props.select(activeEntry())
      return
    }
    if (event.key === "Escape") {
      event.preventDefault()
      props.close()
    }
  }

  return (
    <Dialog class="command-palette-v2" size="large">
      <DialogBody class="command-palette-v2-body">
        <div class="command-palette-v2-search">
          <TextInputV2
            value={query()}
            autofocus
            autocomplete="off"
            spellcheck={false}
            appearance="large"
            placeholder={props.placeholder}
            leadingIcon={<Icon name="magnifying-glass" />}
            onInput={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
        <ScrollView class="command-palette-v2-scroll" viewportRef={(el) => (resultsRef = el)}>
          <div class="command-palette-v2-results" role="listbox">
            <Show
              when={visibleEntries().length > 0}
              fallback={
                <div class="command-palette-v2-state">
                  {entries.loading ? language.t("common.loading") : language.t("palette.empty")}
                </div>
              }
            >
              <For each={groupedEntries()}>
                {(group) => (
                  <div class="command-palette-v2-group">
                    <Show when={group.category}>
                      <div class="command-palette-v2-group-title">{group.category}</div>
                    </Show>
                    <For each={group.entries}>
                      {(item) => (
                        <PaletteRow
                          item={item}
                          active={activeEntry()?.id === item.id}
                          language={language}
                          sessionOpen={
                            item.server && item.sessionID
                              ? openSessions().has(`${item.server}\0${item.sessionID}`)
                              : false
                          }
                          onActive={() => setActive(visibleEntries().findIndex((entry) => entry.id === item.id))}
                          onSelect={() => props.select(item)}
                        />
                      )}
                    </For>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </ScrollView>
      </DialogBody>
    </Dialog>
  )
}

function PaletteRow(props: {
  item: CommandPaletteEntry
  active: boolean
  language: ReturnType<typeof useLanguage>
  sessionOpen: boolean
  onActive: () => void
  onSelect: () => void
}) {
  const session = () =>
    props.item.server && props.item.directory && props.item.sessionID
      ? { server: props.item.server, directory: props.item.directory, sessionID: props.item.sessionID }
      : undefined

  return (
    <button
      type="button"
      class="command-palette-v2-row group"
      role="option"
      aria-selected={props.active}
      data-active={props.active ? "" : undefined}
      onMouseMove={(event) => {
        // Ignore hover from a static cursor when keyboard scrolling moves rows underneath it.
        if (event.movementX === 0 && event.movementY === 0) return
        props.onActive()
      }}
      onMouseDown={(event) => event.preventDefault()}
      onClick={props.onSelect}
    >
      <Switch
        fallback={
          <div class="command-palette-v2-row-main">
            <FileIcon node={{ path: props.item.path ?? "", type: "file" }} class="command-palette-v2-row-icon size-4" />
            <div class="command-palette-v2-file-path">
              <span class="command-palette-v2-file-dir">{getDirectory(props.item.path ?? "")}</span>
              <span class="command-palette-v2-file-name">{getFilename(props.item.path ?? "")}</span>
            </div>
          </div>
        }
      >
        <Match when={props.item.type === "command"}>
          <div class="command-palette-v2-row-main">
            <div class="command-palette-v2-row-text">
              <span class="command-palette-v2-title">{props.item.title}</span>
              <Show when={props.item.description}>
                <span class="command-palette-v2-description">{props.item.description}</span>
              </Show>
            </div>
          </div>
          <Show when={props.item.keybind}>
            <KeybindV2 keys={formatKeybindParts(props.item.keybind ?? "", props.language.t)} variant="neutral" />
          </Show>
        </Match>
        <Match when={props.item.type === "session"}>
          <div class="command-palette-v2-row-main">
            <div class="relative shrink-0">
              <Show when={props.sessionOpen}>
                <span
                  aria-hidden="true"
                  class="pointer-events-none absolute top-1/2 h-3 w-0.5 -translate-y-1/2 rounded-[2px] bg-v2-background-bg-layer-04"
                  style={{ right: "calc(100% + 4px)" }}
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
            <div class="command-palette-v2-row-text">
              <span class="command-palette-v2-title" classList={{ "opacity-70": !!props.item.archived }}>
                {props.item.title}
              </span>
              <Show when={props.item.description}>
                <span class="command-palette-v2-description" classList={{ "opacity-70": !!props.item.archived }}>
                  {props.item.description}
                </span>
              </Show>
            </div>
          </div>
          <Show when={props.item.updated}>
            <span class="command-palette-v2-meta">
              {getRelativeTime(new Date(props.item.updated!).toISOString(), props.language.t)}
            </span>
          </Show>
        </Match>
      </Switch>
    </button>
  )
}
