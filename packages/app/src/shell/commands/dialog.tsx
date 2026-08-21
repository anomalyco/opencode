import { getDirectory, getFilename } from "@opencode-ai/util/path"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { Dialog, DialogBody } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { Keybind } from "@opencode-ai/ui/keybind"
import { TextInput } from "@opencode-ai/ui/text-input"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { createEffect, createMemo, createResource, createSignal, For, Match, Show, Switch } from "solid-js"
import { formatKeybindParts } from "@/shell/commands/command"
import { useLanguage } from "@/runtime/i18n/language"
import { useTabs } from "@/shell/tabs/tabs"
import { SessionTabAvatar } from "@/shell/layout/session-tab-avatar"
import { getRelativeTime } from "@/shell/time"
import {
  createCommandPaletteCommandEntry,
  createCommandPaletteFileEntry,
  createCommandPaletteModel,
  createServerSessionEntries,
  uniqueCommandPaletteEntries,
  type CommandPaletteEntry,
} from "./palette"
import "./dialog.css"

function groups(entries: CommandPaletteEntry[]) {
  const map = new Map<string, CommandPaletteEntry[]>()
  for (const entry of entries) map.set(entry.category, [...(map.get(entry.category) ?? []), entry])
  return Array.from(map.entries()).map(([category, entries]) => ({ category, entries }))
}

export function matchesCommandPaletteEntry(entry: CommandPaletteEntry, query: string) {
  const value = query.toLowerCase()
  return [entry.title, entry.description, entry.category].some((text) => text?.toLowerCase().includes(value))
}

export function DialogCommandPalette(props: { onOpenFile?: (path: string) => void }) {
  const palette = createCommandPaletteModel(props)
  const loadItems = async (text: string) => {
    const q = text.trim()
    if (!q) return [...palette.preferredCommandEntries(), ...palette.recentFileEntries()]

    const [files, nextSessions] = await Promise.all([palette.file.searchFiles(q), Promise.resolve(palette.sessions(q))])
    const category = palette.language.t("palette.group.files")
    return [
      ...palette.commandEntries().filter((entry) => matchesCommandPaletteEntry(entry, q)),
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

export function CommandPaletteView(props: {
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
    <Dialog class="command-palette" size="large">
      <DialogBody class="command-palette-body">
        <div class="command-palette-search">
          <TextInput
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
        <ScrollView class="command-palette-scroll" viewportRef={(el) => (resultsRef = el)}>
          <div class="command-palette-results" role="listbox">
            <Show
              when={visibleEntries().length > 0}
              fallback={
                <div class="command-palette-state">
                  {entries.loading ? language.t("common.loading") : language.t("palette.empty")}
                </div>
              }
            >
              <For each={groupedEntries()}>
                {(group) => (
                  <div class="command-palette-group">
                    <Show when={group.category}>
                      <div class="command-palette-group-title">{group.category}</div>
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
      class="command-palette-row group"
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
          <div class="command-palette-row-main">
            <FileIcon node={{ path: props.item.path ?? "", type: "file" }} class="command-palette-row-icon size-4" />
            <div class="command-palette-file-path">
              <span class="command-palette-file-dir">{getDirectory(props.item.path ?? "")}</span>
              <span class="command-palette-file-name">{getFilename(props.item.path ?? "")}</span>
            </div>
          </div>
        }
      >
        <Match when={props.item.type === "command"}>
          <div class="command-palette-row-main">
            <div class="command-palette-row-text">
              <span class="command-palette-title">{props.item.title}</span>
              <Show when={props.item.description}>
                <span class="command-palette-description">{props.item.description}</span>
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
            <div class="command-palette-row-text">
              <span class="command-palette-title" classList={{ "opacity-70": !!props.item.archived }}>
                {props.item.title}
              </span>
              <Show when={props.item.description}>
                <span class="command-palette-description" classList={{ "opacity-70": !!props.item.archived }}>
                  {props.item.description}
                </span>
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
