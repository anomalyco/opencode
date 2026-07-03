import { base64Encode } from "@opencode-ai/core/util/encode"
import { getDirectory, getFilename } from "@opencode-ai/core/util/path"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { Dialog, DialogBody } from "@opencode-ai/ui/v2/dialog-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { KeybindV2 } from "@opencode-ai/ui/v2/keybind-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { useNavigate } from "@solidjs/router"
import { createEffect, createMemo, createResource, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js"
import { formatKeybindParts, useCommand, type CommandOption } from "@/context/command"
import { useFile } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useServerSDK, type ServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { createSessionTabs } from "@/pages/session/helpers"
import { useSessionLayout } from "@/pages/session/session-layout"
import { decode64 } from "@/utils/base64"
import { getRelativeTime } from "@/utils/time"
import "./dialog-command-palette-v2.css"

type EntryType = "command" | "file" | "session"

type Entry = {
  id: string
  type: EntryType
  title: string
  description?: string
  keybind?: string
  category: string
  option?: CommandOption
  path?: string
  directory?: string
  sessionID?: string
  archived?: number
  updated?: number
}

const ENTRY_LIMIT = 5
const COMMON_COMMAND_IDS = [
  "session.new",
  "workspace.new",
  "session.previous",
  "session.next",
  "terminal.toggle",
  "review.toggle",
] as const

const uniqueEntries = (items: Entry[]) => {
  const seen = new Set<string>()
  const out: Entry[] = []
  for (const item of items) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    out.push(item)
  }
  return out
}

const createCommandEntry = (option: CommandOption, category: string): Entry => ({
  id: "command:" + option.id,
  type: "command",
  title: option.title,
  description: option.description,
  keybind: option.keybind,
  category,
  option,
})

const createFileEntry = (path: string, category: string): Entry => ({
  id: "file:" + path,
  type: "file",
  title: path,
  category,
  path,
})

const createSessionEntry = (
  input: {
    directory: string
    id: string
    title: string
    description: string
    archived?: number
    updated?: number
  },
  category: string,
): Entry => ({
  id: `session:${input.directory}:${input.id}`,
  type: "session",
  title: input.title,
  description: input.description,
  category,
  directory: input.directory,
  sessionID: input.id,
  archived: input.archived,
  updated: input.updated,
})

function createCommandEntries(props: {
  command: ReturnType<typeof useCommand>
  language: ReturnType<typeof useLanguage>
}) {
  const allowed = createMemo(() =>
    props.command.options.filter(
      (option) => !option.disabled && !option.hidden && !option.id.startsWith("suggested.") && option.id !== "file.open",
    ),
  )

  const list = createMemo(() => {
    const category = props.language.t("palette.group.commands")
    return allowed().map((option) => createCommandEntry(option, category))
  })

  const picks = createMemo(() => {
    const all = allowed()
    const order = new Map<string, number>(COMMON_COMMAND_IDS.map((id, index) => [id, index]))
    const picked = all.filter((option) => order.has(option.id))
    const base = picked.length ? picked : all.slice(0, ENTRY_LIMIT)
    const sorted = picked.length ? [...base].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)) : base
    const category = props.language.t("palette.group.commands")
    return sorted.map((option) => createCommandEntry(option, category))
  })

  return { list, picks }
}

function createFileEntries(props: {
  file: ReturnType<typeof useFile>
  tabs: () => ReturnType<ReturnType<typeof useLayout>["tabs"]>
  language: ReturnType<typeof useLanguage>
}) {
  const tabState = createSessionTabs({
    tabs: props.tabs,
    pathFromTab: props.file.pathFromTab,
    normalizeTab: (tab) => (tab.startsWith("file://") ? props.file.tab(tab) : tab),
  })

  const recent = createMemo(() => {
    const all = tabState.openedTabs()
    const active = tabState.activeFileTab()
    const order = active ? [active, ...all.filter((item) => item !== active)] : all
    const seen = new Set<string>()
    const category = props.language.t("palette.group.files")
    const items: Entry[] = []

    for (const item of order) {
      const path = props.file.pathFromTab(item)
      if (!path) continue
      if (seen.has(path)) continue
      seen.add(path)
      items.push(createFileEntry(path, category))
    }

    return items.slice(0, ENTRY_LIMIT)
  })

  return { recent }
}

function createSessionEntries(props: {
  workspaces: () => string[]
  label: (directory: string) => string
  serverSDK: ServerSDK
  language: ReturnType<typeof useLanguage>
}) {
  const state: {
    token: number
    inflight: Promise<Entry[]> | undefined
    cached: Entry[] | undefined
  } = {
    token: 0,
    inflight: undefined,
    cached: undefined,
  }

  const sessions = (text: string) => {
    const query = text.trim()
    if (!query) {
      state.token += 1
      state.inflight = undefined
      state.cached = undefined
      return [] as Entry[]
    }

    if (state.cached) return state.cached
    if (state.inflight) return state.inflight

    const current = state.token
    const dirs = props.workspaces()
    if (dirs.length === 0) return [] as Entry[]

    state.inflight = Promise.all(
      dirs.map((directory) => {
        const description = props.label(directory)
        return props.serverSDK.client.session
          .list({ directory, roots: true })
          .then((x) =>
            (x.data ?? [])
              .filter((s) => !!s?.id)
              .map((s) => ({
                id: s.id,
                title: s.title ?? props.language.t("command.session.new"),
                description,
                directory,
                archived: s.time?.archived,
                updated: s.time?.updated,
              })),
          )
          .catch(
            () =>
              [] as {
                id: string
                title: string
                description: string
                directory: string
                archived?: number
                updated?: number
              }[],
          )
      }),
    )
      .then((results) => {
        if (state.token !== current) return [] as Entry[]
        const seen = new Set<string>()
        const category = props.language.t("command.category.session")
        const next = results
          .flat()
          .filter((item) => {
            const key = `${item.directory}:${item.id}`
            if (seen.has(key)) return false
            seen.add(key)
            return true
          })
          .map((item) => createSessionEntry(item, category))
        state.cached = next
        return next
      })
      .catch(() => [] as Entry[])
      .finally(() => {
        state.inflight = undefined
      })

    return state.inflight
  }

  return { sessions }
}

function groups(entries: Entry[], grouped: boolean) {
  if (!grouped) return [{ category: "", entries }]
  const map = new Map<string, Entry[]>()
  for (const entry of entries) map.set(entry.category, [...(map.get(entry.category) ?? []), entry])
  return Array.from(map.entries()).map(([category, entries]) => ({ category, entries }))
}

function matchesEntry(entry: Entry, query: string) {
  const value = query.toLowerCase()
  return [entry.title, entry.description, entry.category].some((text) => text?.toLowerCase().includes(value))
}

export function DialogCommandPaletteV2(props: { onOpenFile?: (path: string) => void }) {
  const command = useCommand()
  const language = useLanguage()
  const layout = useLayout()
  const file = useFile()
  const dialog = useDialog()
  const navigate = useNavigate()
  const serverSDK = useServerSDK()
  const serverSync = useServerSync()
  const { params, tabs, view } = useSessionLayout()
  const state = { cleanup: undefined as (() => void) | void, committed: false }
  const [query, setQuery] = createSignal("")
  const [active, setActive] = createSignal(0)
  const commandEntries = createCommandEntries({ command, language })
  const fileEntries = createFileEntries({ file, tabs, language })

  const projectDirectory = createMemo(() => decode64(params.dir) ?? "")
  const project = createMemo(() => {
    const directory = projectDirectory()
    if (!directory) return
    return layout.projects.list().find((p) => p.worktree === directory || p.sandboxes?.includes(directory))
  })
  const workspaces = createMemo(() => {
    const directory = projectDirectory()
    const current = project()
    if (!current) return directory ? [directory] : []

    const dirs = [current.worktree, ...(current.sandboxes ?? [])]
    if (directory && !dirs.includes(directory)) return [...dirs, directory]
    return dirs
  })
  const homedir = createMemo(() => serverSync().data.path.home)
  const label = (directory: string) => {
    const current = project()
    const kind =
      current && directory === current.worktree ? language.t("workspace.type.local") : language.t("workspace.type.sandbox")
    const [child] = serverSync().child(directory, { bootstrap: false })
    const home = homedir()
    const path = home ? directory.replace(home, "~") : directory
    const name = child.vcs?.branch ?? getFilename(directory)
    return `${kind} : ${name || path}`
  }

  const { sessions } = createSessionEntries({ workspaces, label, serverSDK: serverSDK(), language })

  const loadItems = async (text: string) => {
    const q = text.trim()
    if (!q) return [...commandEntries.picks(), ...fileEntries.recent()]

    const [files, nextSessions] = await Promise.all([file.searchFiles(q), Promise.resolve(sessions(q))])
    const category = language.t("palette.group.files")
    return [
      ...commandEntries.list().filter((entry) => matchesEntry(entry, q)),
      ...nextSessions.filter((entry) => matchesEntry(entry, q)),
      ...files.map((path) => createFileEntry(path, category)),
    ]
  }

  const [entries] = createResource(query, loadItems, { initialValue: [] as Entry[] })
  const visibleEntries = createMemo(() => uniqueEntries(entries() ?? []))
  const groupedEntries = createMemo(() => groups(visibleEntries(), query().trim().length > 0))
  const activeEntry = createMemo(() => visibleEntries()[active()])

  createEffect(() => {
    query()
    visibleEntries()
    setActive(0)
  })

  createEffect(() => {
    state.cleanup?.()
    state.cleanup = undefined
    const item = activeEntry()
    if (item?.type !== "command") return
    state.cleanup = item.option?.onHighlight?.()
  })

  const open = (path: string) => {
    const value = file.tab(path)
    void tabs().open(value)
    void file.load(path)
    if (!view().reviewPanel.opened()) view().reviewPanel.open()
    layout.fileTree.setTab("all")
    props.onOpenFile?.(path)
    tabs().setActive(value)
  }

  const select = (item: Entry | undefined) => {
    if (!item) return
    state.committed = true
    state.cleanup = undefined
    dialog.close()

    if (item.type === "command") {
      item.option?.onSelect?.("palette")
      return
    }

    if (item.type === "session") {
      if (!item.directory || !item.sessionID) return
      navigate(`/${base64Encode(item.directory)}/session/${item.sessionID}`)
      return
    }

    if (!item.path) return
    open(item.path)
  }

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
      select(activeEntry())
      return
    }
    if (event.key === "Escape") {
      event.preventDefault()
      dialog.close()
    }
  }

  onCleanup(() => {
    if (state.committed) return
    state.cleanup?.()
  })

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
            placeholder={language.t("palette.search.placeholder")}
            leadingIcon={<Icon name="magnifying-glass" />}
            onInput={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
        <ScrollView class="command-palette-v2-scroll" viewportRef={(el) => (resultsRef = el)}>
          <div class="command-palette-v2-results" role="listbox">
            <Show
              when={!entries.loading}
              fallback={<div class="command-palette-v2-state">{language.t("common.loading")}</div>}
            >
              <Show
                when={visibleEntries().length > 0}
                fallback={<div class="command-palette-v2-state">{language.t("palette.empty")}</div>}
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
                            onActive={() => setActive(visibleEntries().findIndex((entry) => entry.id === item.id))}
                            onSelect={() => select(item)}
                          />
                        )}
                      </For>
                    </div>
                  )}
                </For>
              </Show>
            </Show>
          </div>
        </ScrollView>
      </DialogBody>
    </Dialog>
  )
}

function PaletteRow(props: {
  item: Entry
  active: boolean
  language: ReturnType<typeof useLanguage>
  onActive: () => void
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      class="command-palette-v2-row"
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
          <>
            <div class="command-palette-v2-row-main">
              <FileIcon node={{ path: props.item.path ?? "", type: "file" }} class="command-palette-v2-row-icon size-4" />
              <div class="command-palette-v2-file-path">
                <span class="command-palette-v2-file-dir">{getDirectory(props.item.path ?? "")}</span>
                <span class="command-palette-v2-file-name">{getFilename(props.item.path ?? "")}</span>
              </div>
            </div>
          </>
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
            <Icon name="status" class="command-palette-v2-row-icon" />
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
