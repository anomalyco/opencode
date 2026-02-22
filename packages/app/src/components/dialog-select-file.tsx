import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { Icon } from "@opencode-ai/ui/icon"
import { Keybind } from "@opencode-ai/ui/keybind"
import { List } from "@opencode-ai/ui/list"
import { TextField } from "@opencode-ai/ui/text-field"
import { base64Encode } from "@opencode-ai/util/encode"
import { getDirectory, getFilename } from "@opencode-ai/util/path"
import { useNavigate, useParams } from "@solidjs/router"
import { createMemo, createSignal, Match, onCleanup, Show, Switch, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import fuzzysort from "fuzzysort"
import { formatKeybind, useCommand, type CommandOption } from "@/context/command"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLayout } from "@/context/layout"
import { useFile } from "@/context/file"
import { useLanguage } from "@/context/language"
import { decode64 } from "@/utils/base64"
import { getRelativeTime } from "@/utils/time"

type EntryType = "command" | "file" | "session" | "content" | "chat"

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
  lineNumber?: number
  matchLine?: string
}

type DialogSelectFileMode = "all" | "files"

const ENTRY_LIMIT = 5
const COMMON_COMMAND_IDS = [
  "session.new",
  "workspace.new",
  "session.previous",
  "session.next",
  "terminal.toggle",
  "review.toggle",
] as const

// Cap regex length to mitigate ReDoS (catastrophic backtracking from malicious regex)
const MAX_REGEX_LEN = 300

/** Client-side filter for chat results — the server only does case-insensitive LIKE,
 *  so matchCase / wholeWord / regex must be enforced here. */
function matchesQuery(text: string, query: string, opts: { matchCase?: boolean; wholeWord?: boolean; useRegex?: boolean }): boolean {
  try {
    let pattern: string
    if (opts.useRegex) {
      if (query.length > MAX_REGEX_LEN) {
        console.warn(`[palette] Regex pattern truncated from ${query.length} to ${MAX_REGEX_LEN} chars to mitigate ReDoS`)
        pattern = query.slice(0, MAX_REGEX_LEN)
      } else {
        pattern = query
      }
    } else {
      pattern = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    }
    if (opts.wholeWord) pattern = `\\b${pattern}\\b`
    return new RegExp(pattern, opts.matchCase ? "" : "i").test(text)
  } catch {
    const q = opts.matchCase ? query : query.toLowerCase()
    const t = opts.matchCase ? text : text.toLowerCase()
    if (opts.wholeWord) {
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      return new RegExp(`\\b${escaped}\\b`, opts.matchCase ? "" : "i").test(text)
    }
    return t.includes(q)
  }
}

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

const createContentEntry = (
  match: { path: string; line: string; lineNumber: number },
  category: string,
): Entry => ({
  id: `content:${match.path}:${match.lineNumber}`,
  type: "content",
  title: getFilename(match.path),
  description: getDirectory(match.path),
  category,
  path: match.path,
  lineNumber: match.lineNumber,
  matchLine: match.line.trim(),
})

const createChatEntry = (
  match: { sessionID: string; title: string; directory: string; snippet: string },
  category: string,
): Entry => ({
  id: `chat:${match.sessionID}:${match.snippet.slice(0, 30)}`,
  type: "chat",
  title: match.title,
  description: match.snippet,
  category,
  directory: match.directory,
  sessionID: match.sessionID,
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
  filesOnly: () => boolean
  command: ReturnType<typeof useCommand>
  language: ReturnType<typeof useLanguage>
}) {
  const allowed = createMemo(() => {
    if (props.filesOnly()) return []
    return props.command.options.filter(
      (option) => !option.disabled && !option.id.startsWith("suggested.") && option.id !== "file.open",
    )
  })

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

  return { allowed, list, picks }
}

function createFileEntries(props: {
  file: ReturnType<typeof useFile>
  tabs: () => ReturnType<ReturnType<typeof useLayout>["tabs"]>
  language: ReturnType<typeof useLanguage>
}) {
  const recent = createMemo(() => {
    const all = props.tabs().all()
    const active = props.tabs().active()
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

  const root = createMemo(() => {
    const category = props.language.t("palette.group.files")
    const nodes = props.file.tree.children("")
    const paths = nodes
      .filter((node) => node.type === "file")
      .map((node) => node.path)
      .sort((a, b) => a.localeCompare(b))
    return paths.slice(0, ENTRY_LIMIT).map((path) => createFileEntry(path, category))
  })

  return { recent, root }
}

function createSessionEntries(props: {
  workspaces: () => string[]
  label: (directory: string) => string
  globalSDK: ReturnType<typeof useGlobalSDK>
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
        return props.globalSDK.client.session
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

// --- Search Toggle Icons (inline SVGs matching VSCode codicons) ---

function SearchToggle(props: {
  active: boolean
  title: string
  onClick: () => void
  children: JSX.Element
}) {
  return (
    <div class="relative group">
      <button
        type="button"
        role="checkbox"
        aria-checked={props.active}
        aria-label={props.title}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          props.onClick()
        }}
        class="flex items-center justify-center size-[22px] rounded-[3px] border border-transparent transition-colors duration-100 cursor-pointer"
        classList={{
          "bg-icon-base/20 border-icon-base/40 text-text-strong": props.active,
          "text-text-weak hover:text-text-strong hover:bg-surface-raised-base-hover": !props.active,
        }}
      >
        {props.children}
      </button>
      <div class="absolute left-1/2 -translate-x-1/2 top-full mt-1 px-2 py-1 text-11-regular text-text-strong bg-surface-raised-base rounded shadow-md whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50">
        {props.title}
      </div>
    </div>
  )
}

function CaseSensitiveIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M8.854 11.702h-1l-.816-2.159H3.772l-.768 2.16H2L5.278 4h.882l3.274 7.702h-.58zM6.843 8.768L5.436 5.328a4.17 4.17 0 0 1-.14-.48h-.032a3.62 3.62 0 0 1-.144.48L3.96 8.768h2.883zm6.235 2.934a2.31 2.31 0 0 1-.912.192c-.89 0-1.336-.48-1.336-1.44V6.81h-.576V6.2h.576V4.964l.672-.192V6.2h1.2v.61h-1.2v3.505c0 .608.24.912.72.912.208 0 .416-.064.624-.192l.232.667z"
        fill="currentColor"
      />
    </svg>
  )
}

function WholeWordIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        fill-rule="evenodd"
        clip-rule="evenodd"
        d="M0 11H1V2H0V11ZM15 11H16V2H15V11ZM6.196 11.702h-.98l-.816-2.159H1.172l-.768 2.16H.4L3.678 4h.882l2.636 7.702zM5.243 8.768L3.836 5.328a4.17 4.17 0 0 1-.14-.48h-.032a3.62 3.62 0 0 1-.144.48L2.36 8.768h2.883zm5.435 2.934a2.31 2.31 0 0 1-.912.192c-.89 0-1.336-.48-1.336-1.44V6.81h-.576V6.2h.576V4.964l.672-.192V6.2h1.2v.61h-1.2v3.505c0 .608.24.912.72.912.208 0 .416-.064.624-.192l.232.667zM14 11.5c0 .276-.224.5-.5.5H12v-1h1V3h-1V2h1.5c.276 0 .5.224.5.5v9z"
        fill="currentColor"
      />
    </svg>
  )
}

function RegexIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        fill-rule="evenodd"
        clip-rule="evenodd"
        d="M10.012 2h.976v3.113l2.56-1.557.486.885L11.47 6l2.564 1.559-.486.885-2.56-1.557V10h-.976V6.887l-2.56 1.557-.486-.885L9.53 6 6.966 4.441l.486-.885 2.56 1.557V2zM2 10h4v4H2v-4z"
        fill="currentColor"
      />
    </svg>
  )
}

function ExpandIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M2 8a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0zm4.5 0a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0zM11 8a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0z"
        fill="currentColor"
      />
    </svg>
  )
}

// --- Search Options Store ---

type SearchOptions = {
  matchCase: boolean
  wholeWord: boolean
  useRegex: boolean
  expanded: boolean
  includeGlob: string
  excludeGlob: string
}

const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  matchCase: false,
  wholeWord: false,
  useRegex: false,
  expanded: false,
  includeGlob: "",
  excludeGlob: "",
}

const SEARCH_TOGGLES: Array<{
  key: keyof Pick<SearchOptions, "matchCase" | "wholeWord" | "useRegex" | "expanded">
  title: string
  Icon: () => JSX.Element
}> = [
  { key: "matchCase", title: "Match Case", Icon: CaseSensitiveIcon },
  { key: "wholeWord", title: "Match Whole Word", Icon: WholeWordIcon },
  { key: "useRegex", title: "Use Regular Expression", Icon: RegexIcon },
  { key: "expanded", title: "include/exclude files", Icon: ExpandIcon },
]

function parseGlobList(s: string): string[] {
  return s.split(",").map((x) => x.trim()).filter(Boolean)
}

export function DialogSelectFile(props: { mode?: DialogSelectFileMode; onOpenFile?: (path: string) => void }) {
  const command = useCommand()
  const language = useLanguage()
  const layout = useLayout()
  const file = useFile()
  const dialog = useDialog()
  const params = useParams()
  const navigate = useNavigate()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const filesOnly = () => props.mode === "files"
  const sessionKey = createMemo(() => `${params.dir}${params.id ? "/" + params.id : ""}`)
  const tabs = createMemo(() => layout.tabs(sessionKey))
  const view = createMemo(() => layout.view(sessionKey))
  const state = { cleanup: undefined as (() => void) | void, committed: false }
  const [grouped, setGrouped] = createSignal(false)
  const commandEntries = createCommandEntries({ filesOnly, command, language })
  const fileEntries = createFileEntries({ file, tabs, language })

  // Search options store
  const [searchOpts, setSearchOpts] = createStore<SearchOptions>({ ...DEFAULT_SEARCH_OPTIONS })
  // Version counter to force re-search when options change.
  // searchOpts reads inside async items() may not be tracked by createResource's source function.
  const [searchVersion, setSearchVersion] = createSignal(0)
  const bumpSearch = () => setSearchVersion((v) => v + 1)

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
  const homedir = createMemo(() => globalSync.data.path.home)
  const label = (directory: string) => {
    const current = project()
    const kind =
      current && directory === current.worktree
        ? language.t("workspace.type.local")
        : language.t("workspace.type.sandbox")
    const [store] = globalSync.child(directory, { bootstrap: false })
    const home = homedir()
    const path = home ? directory.replace(home, "~") : directory
    const name = store.vcs?.branch ?? getFilename(directory)
    return `${kind} : ${name || path}`
  }

  const { sessions } = createSessionEntries({ workspaces, label, globalSDK, language })

  const items = async (text: string) => {
    // Read version signal synchronously so createResource tracks it
    void searchVersion()
    const query = text.trim()
    setGrouped(query.length > 0)

    if (!query && filesOnly()) {
      const loaded = file.tree.state("")?.loaded
      const pending = loaded ? Promise.resolve() : file.tree.list("")
      const next = uniqueEntries([...fileEntries.recent(), ...fileEntries.root()])

      if (loaded || next.length > 0) {
        void pending
        return next
      }

      await pending
      return uniqueEntries([...fileEntries.recent(), ...fileEntries.root()])
    }

    if (!query) return [...commandEntries.picks(), ...fileEntries.recent()]

    const include = parseGlobList(searchOpts.includeGlob)
    const exclude = parseGlobList(searchOpts.excludeGlob)

    const [fileMatches, contentMatches, chatMatches] = await Promise.all([
      file.searchFiles(query),
      file.searchContent(query, {
        caseSensitive: searchOpts.matchCase,
        wholeWord: searchOpts.wholeWord,
        regex: searchOpts.useRegex,
        include: include.length > 0 ? include : undefined,
        exclude: exclude.length > 0 ? exclude : undefined,
      }),
      globalSDK.client.session.search({ query, regex: searchOpts.useRegex ? "true" : "false" }).then(
        (x) => x.data ?? [],
        () => [],
      ),
    ])

    const fileCategory = language.t("palette.group.files")
    const fileEntryList = fileMatches.map((path) => createFileEntry(path, fileCategory))
    const contentEntryList = contentMatches.map((m) => createContentEntry(m, language.t("palette.group.content")))
    const chatOpts = { matchCase: searchOpts.matchCase, wholeWord: searchOpts.wholeWord, useRegex: searchOpts.useRegex }
    const chatEntryList = chatMatches
      .filter((m) => matchesQuery(m.snippet, query, chatOpts))
      .map((m) => createChatEntry(m, language.t("palette.group.chat")))

    const searchEntries = [...fileEntryList, ...contentEntryList, ...chatEntryList]
    if (filesOnly()) return searchEntries

    const nextSessions = await Promise.resolve(sessions(query))
    const fuzzyCommands = fuzzysort.go(query, commandEntries.list(), { key: "title" }).map((r) => r.obj)
    const fuzzySessions = Array.isArray(nextSessions)
      ? fuzzysort.go(query, nextSessions, { key: "title" }).map((r) => r.obj)
      : []
    return [...fuzzyCommands, ...fuzzySessions, ...searchEntries]
  }

  const handleMove = (item: Entry | undefined) => {
    state.cleanup?.()
    if (!item) return
    if (item.type !== "command") return
    state.cleanup = item.option?.onHighlight?.()
  }

  const open = (path: string) => {
    const value = file.tab(path)
    tabs().open(value)
    file.load(path)
    if (!view().reviewPanel.opened()) view().reviewPanel.open()
    layout.fileTree.setTab("all")
    props.onOpenFile?.(path)
    tabs().setActive(value)
  }

  const handleSelect = (item: Entry | undefined) => {
    if (!item) return
    state.committed = true
    state.cleanup = undefined
    dialog.close()

    if (item.type === "command") {
      item.option?.onSelect?.("palette")
      return
    }

    if (item.type === "session" || item.type === "chat") {
      if (!item.directory || !item.sessionID) return
      navigate(`/${base64Encode(item.directory)}/session/${item.sessionID}`)
      return
    }

    // Both "file" and "content" entries open files
    if (!item.path) return
    open(item.path)
  }

  onCleanup(() => {
    if (state.committed) return
    state.cleanup?.()
  })

  const searchAction = (
    <>
      <div class="flex items-center gap-0.5 shrink-0">
        {SEARCH_TOGGLES.slice(0, 3).map((t) => (
          <SearchToggle
            active={searchOpts[t.key]}
            title={t.title}
            onClick={() => {
              setSearchOpts(t.key, (v) => !v)
              bumpSearch()
            }}
          >
            <t.Icon />
          </SearchToggle>
        ))}
        <div class="w-px h-3.5 bg-border-weak-base mx-1" />
        {SEARCH_TOGGLES.slice(3).map((t) => (
          <SearchToggle
            active={searchOpts[t.key]}
            title={t.title}
            onClick={() => setSearchOpts(t.key, (v) => !v)}
          >
            <t.Icon />
          </SearchToggle>
        ))}
      </div>
      <Show when={searchOpts.expanded}>
        <div class="flex flex-col gap-1.5 pt-1.5 w-full min-w-full basis-full">
          <div class="flex items-center gap-2">
            <span class="text-12-regular text-text-weak whitespace-nowrap w-14 shrink-0">Include</span>
            <TextField
              variant="ghost"
              class="flex-1 text-12-regular bg-surface-base rounded-md px-2 py-0.5 min-w-0"
              type="text"
              value={searchOpts.includeGlob}
              onChange={(value) => { setSearchOpts("includeGlob", value); bumpSearch() }}
              placeholder="e.g. *.ts, src/**"
              spellcheck={false}
              autocorrect="off"
              autocomplete="off"
            />
          </div>
          <div class="flex items-center gap-2">
            <span class="text-12-regular text-text-weak whitespace-nowrap w-14 shrink-0">Exclude</span>
            <TextField
              variant="ghost"
              class="flex-1 text-12-regular bg-surface-base rounded-md px-2 py-0.5 min-w-0"
              type="text"
              value={searchOpts.excludeGlob}
              onChange={(value) => { setSearchOpts("excludeGlob", value); bumpSearch() }}
              placeholder="e.g. node_modules, *.test.*"
              spellcheck={false}
              autocorrect="off"
              autocomplete="off"
            />
          </div>
        </div>
      </Show>
    </>
  )

  return (
    <Dialog size="large" class="pt-3 pb-0 !max-h-[960px]" transition>
      <List
        search={{
          placeholder: filesOnly()
            ? language.t("session.header.searchFiles")
            : language.t("palette.search.placeholder"),
          autofocus: true,
          hideIcon: true,
          action: searchAction,
        }}
        emptyMessage={language.t("palette.empty")}
        loadingMessage={language.t("common.loading")}
        items={items}
        key={(item) => item.id}
        disableFuzzy
        groupBy={grouped() ? (item) => item.category : () => ""}
        onMove={handleMove}
        onSelect={handleSelect}
      >
        {(item) => (
          <Switch
            fallback={
              <div class="w-full flex items-center justify-between rounded-md pl-1">
                <div class="flex items-center gap-x-3 grow min-w-0">
                  <FileIcon node={{ path: item.path ?? "", type: "file" }} class="shrink-0 size-4" />
                  <div class="flex items-center text-14-regular">
                    <span class="text-text-weak whitespace-nowrap overflow-hidden overflow-ellipsis truncate min-w-0">
                      {getDirectory(item.path ?? "")}
                    </span>
                    <span class="text-text-strong whitespace-nowrap">{getFilename(item.path ?? "")}</span>
                  </div>
                </div>
              </div>
            }
          >
            <Match when={item.type === "command"}>
              <div class="w-full flex items-center justify-between gap-4">
                <div class="flex items-center gap-2 min-w-0">
                  <span class="text-14-regular text-text-strong whitespace-nowrap">{item.title}</span>
                  <Show when={item.description}>
                    <span class="text-14-regular text-text-weak truncate">{item.description}</span>
                  </Show>
                </div>
                <Show when={item.keybind}>
                  <Keybind class="rounded-[4px]">{formatKeybind(item.keybind ?? "")}</Keybind>
                </Show>
              </div>
            </Match>
            <Match when={item.type === "content"}>
              <div class="w-full flex flex-col gap-0.5 rounded-md pl-1">
                <div class="flex items-center gap-x-3 grow min-w-0">
                  <FileIcon node={{ path: item.path ?? "", type: "file" }} class="shrink-0 size-4" />
                  <div class="flex items-center text-14-regular min-w-0">
                    <span class="text-text-weak whitespace-nowrap overflow-hidden overflow-ellipsis truncate min-w-0">
                      {getDirectory(item.path ?? "")}
                    </span>
                    <span class="text-text-strong whitespace-nowrap">{getFilename(item.path ?? "")}</span>
                    <span class="text-text-weak ml-1 whitespace-nowrap">:{item.lineNumber}</span>
                  </div>
                </div>
                <Show when={item.matchLine}>
                  <div class="pl-7 text-12-regular text-text-weak truncate font-mono">{item.matchLine}</div>
                </Show>
              </div>
            </Match>
            <Match when={item.type === "session"}>
              <div class="w-full flex items-center justify-between rounded-md pl-1">
                <div class="flex items-center gap-x-3 grow min-w-0">
                  <Icon name="bubble-5" size="small" class="shrink-0 text-icon-weak" />
                  <div class="flex items-center gap-2 min-w-0">
                    <span
                      class="text-14-regular text-text-strong truncate"
                      classList={{ "opacity-70": !!item.archived }}
                    >
                      {item.title}
                    </span>
                    <Show when={item.description}>
                      <span
                        class="text-14-regular text-text-weak truncate"
                        classList={{ "opacity-70": !!item.archived }}
                      >
                        {item.description}
                      </span>
                    </Show>
                  </div>
                </div>
                <Show when={item.updated}>
                  <span class="text-12-regular text-text-weak whitespace-nowrap ml-2">
                    {getRelativeTime(new Date(item.updated!).toISOString())}
                  </span>
                </Show>
              </div>
            </Match>
            <Match when={item.type === "chat"}>
              <div class="w-full flex items-center justify-between rounded-md pl-1">
                <div class="flex items-center gap-x-3 grow min-w-0">
                  <Icon name="bubble-5" size="small" class="shrink-0 text-icon-weak" />
                  <div class="flex flex-col gap-0.5 min-w-0">
                    <span class="text-14-regular text-text-strong truncate">{item.title}</span>
                    <Show when={item.description}>
                      <span class="text-12-regular text-text-weak truncate font-mono">{item.description}</span>
                    </Show>
                  </div>
                </div>
              </div>
            </Match>
          </Switch>
        )}
      </List>
    </Dialog>
  )
}
