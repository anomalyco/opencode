import { createEffect, createMemo, createResource, createSignal, on, onCleanup, onMount, Show, For } from "solid-js"
import path from "path"
import { existsSync, statSync, readdirSync } from "node:fs"
import type { TextareaRenderable } from "@opentui/core"
import { go } from "fuzzysort"
import { DialogSelect, type DialogSelectRef } from "../ui/dialog-select"
import { useRoute } from "../context/route"
import { useSDK } from "../context/sdk"
import { useEvent } from "../context/event"
import { useSync } from "../context/sync"
import { useTheme } from "../context/theme"
import { useLocal } from "../context/local"
import { useTuiPaths } from "../context/runtime"
import { useToast } from "../ui/toast"
import { useTuiConfig } from "../config"
import { useBindings, useCommandShortcut, OPENCODE_BASE_MODE } from "../keymap"
import { createDebouncedSignal } from "../util/signal"
import { errorMessage } from "../util/error"
import { Locale } from "../util/locale"
import { Spinner } from "../component/spinner"
import { resolveStatus, statusDisplay, type PersistedStatus } from "../util/session-status"

export function createSessionsListQuery(input: { search?: string }) {
  const search = input.search?.trim()
  return {
    roots: true,
    limit: search ? 30 : 100,
    ...(search ? { search } : {}),
  }
}

// A leading @path token picks the directory the new session is started in;
// anything after it becomes the first prompt. Mirrors how the home prompt
// creates sessions in the current directory when no @path is given. Paths
// with spaces must be quoted: @"/my dir" do the thing.
export function parseNewSessionInput(input: string, paths: { cwd: string; home: string }) {
  const text = input.trim()
  const match = /^@(?:"([^"]+)"|(\S+))(?:\s+([\s\S]*))?$/.exec(text)
  if (!match) return { directory: undefined, prompt: text }
  const raw = match[1] ?? match[2]
  const resolved = path.isAbsolute(raw)
    ? raw
    : raw.startsWith("~")
      ? path.join(paths.home, raw.slice(1))
      : path.resolve(paths.cwd, raw)
  return { directory: path.normalize(resolved), prompt: (match[3] ?? "").trim() }
}

// Directory completion for the new session input: only fires while the input
// is a single @token (no prompt text yet). A bare name fuzzy-searches the
// tree below the cwd so nested directories surface without descending level
// by level; once the token contains a slash it completes the children of
// that path instead. Results stay relative to the cwd when possible so both
// the list and the completed input read short. `readdir` is injected so
// tests can stub the filesystem.
export function directorySuggestions(
  input: string,
  paths: { cwd: string; home: string },
  readdir: (dir: string) => string[],
) {
  const match = /^@(\S*)$/.exec(input.trim())
  if (!match) return []
  const token = match[1]
  if (token && !token.includes("/") && !token.startsWith("~")) {
    return go(token, walk(paths.cwd, readdir, token.startsWith(".")), { limit: 8 }).map((result) => result.target)
  }
  const expanded = token.startsWith("~") ? path.join(paths.home, token.slice(1)) : token
  const descend = expanded.endsWith("/") || token === "~" || token === ""
  const absolute = path.isAbsolute(expanded) ? expanded : path.resolve(paths.cwd, expanded)
  const base = descend ? absolute : path.dirname(absolute)
  const needle = descend ? "" : path.basename(absolute)
  const names = readdir(base).filter(
    (name) => name !== "node_modules" && (needle.startsWith(".") || !name.startsWith(".")),
  )
  const matched = needle ? go(needle, names, { limit: 8 }).map((result) => result.target) : names.toSorted().slice(0, 8)
  return matched.map((name) => shorten(path.join(base, name), paths.cwd))
}

// Breadth-first, depth-limited walk of the directories under root, returned
// relative to it. node_modules is always skipped, and hidden directories are
// skipped unless the needle asks for a dotfile, so the search stays fast.
function walk(root: string, readdir: (dir: string) => string[], hidden: boolean) {
  const result: string[] = []
  let level = [root]
  for (let depth = 0; depth < 4 && level.length > 0 && result.length < 2000; depth++) {
    const next: string[] = []
    for (const dir of level) {
      for (const name of readdir(dir)) {
        if (name === "node_modules") continue
        if (!hidden && name.startsWith(".")) continue
        result.push(path.join(dir, name))
        next.push(path.join(dir, name))
        if (result.length >= 2000) break
      }
    }
    level = next
  }
  return result.map((dir) => path.relative(root, dir))
}

function shorten(dir: string, cwd: string) {
  const relative = path.relative(cwd, dir)
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return dir
  return relative
}

function readdirDirectories(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

// The completion walks the tree on every keystroke; caching the raw readdir
// for a few seconds keeps each keystroke to in-memory work while still
// picking up directories created moments ago.
function cachedReaddir() {
  const cache = new Map<string, { at: number; names: string[] }>()
  return (dir: string) => {
    const hit = cache.get(dir)
    if (hit && Date.now() - hit.at < 10_000) return hit.names
    const names = readdirDirectories(dir)
    cache.set(dir, { at: Date.now(), names })
    return names
  }
}

// Survives the route remount when coming back from a session, so the list can
// put the cursor back on the session the user just left.
let lastOpenedSessionID: string | undefined
const SESSION_DIRECTORY_COLLATOR = new Intl.Collator("en", { numeric: true, sensitivity: "base" })

export function compareSessionDirectories(a: string, b: string) {
  const result = SESSION_DIRECTORY_COLLATOR.compare(a, b)
  if (result !== 0) return result
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

export function Sessions() {
  const route = useRoute()
  const sdk = useSDK()
  const event = useEvent()
  const sync = useSync()
  const local = useLocal()
  const paths = useTuiPaths()
  const toast = useToast()
  const tuiConfig = useTuiConfig()
  const { theme } = useTheme()
  const [search, setSearch] = createDebouncedSignal("", 150)
  const [textareaTarget, setTextareaTarget] = createSignal<TextareaRenderable>()
  const [inputText, setInputText] = createSignal("")
  const [dismissed, setDismissed] = createSignal(false)
  const [suggestionIndex, setSuggestionIndex] = createSignal(0)
  const [toDelete, setToDelete] = createSignal<string>()
  const [completionAnchor, setCompletionAnchor] = createSignal<string>()
  const [persisted, setPersisted] = createSignal(new Map<string, PersistedStatus>())
  const [now, setNow] = createSignal(Date.now())
  const deleteHint = useCommandShortcut("session.delete")
  let selectRef: DialogSelectRef<string> | undefined
  let textarea: TextareaRenderable
  let statusTimer: ReturnType<typeof setTimeout> | undefined
  let navigateTimer: ReturnType<typeof setTimeout> | undefined
  let disposed = false

  const [sessions, { refetch }] = createResource(
    () => search(),
    (query) =>
      sdk.globalClient.experimental.session
        .list(createSessionsListQuery({ search: query }))
        .then((result) => result.data ?? []),
  )

  // Status rows only change server-side on transitions, so any lifecycle event
  // is a hint to pull them again; debounced because transitions come in bursts.
  async function refetchStatuses() {
    const result = await sdk.globalClient.experimental.session.status.list()
    if (disposed || !result.data) return
    setPersisted(
      new Map(
        result.data.map((row) => [
          row.sessionID,
          {
            status: row.status,
            detail: row.detail,
            time: { created: Number(row.time.created), updated: Number(row.time.updated) },
          },
        ]),
      ),
    )
  }

  function scheduleStatusRefetch() {
    clearTimeout(statusTimer)
    statusTimer = setTimeout(() => void refetchStatuses(), 400)
  }

  onMount(() => {
    void refetchStatuses()
    const ticker = setInterval(() => setNow(Date.now()), 30_000)
    onCleanup(() => {
      disposed = true
      clearInterval(ticker)
      clearTimeout(statusTimer)
      clearTimeout(navigateTimer)
    })
  })

  onCleanup(event.on("session.deleted", () => refetch()))
  onCleanup(event.on("session.status", scheduleStatusRefetch))
  onCleanup(event.on("question.asked", scheduleStatusRefetch))
  onCleanup(event.on("question.replied", scheduleStatusRefetch))
  onCleanup(event.on("question.rejected", scheduleStatusRefetch))
  onCleanup(event.on("permission.asked", scheduleStatusRefetch))
  onCleanup(event.on("permission.replied", scheduleStatusRefetch))

  const options = createMemo(() => {
    const today = new Date().toDateString()
    const at = now()
    return (sessions() ?? [])
      .toSorted((a, b) => b.time.updated - a.time.updated)
      .map((session) => {
        const updated = new Date(session.time.updated).toDateString()
        const isDeleting = toDelete() === session.id
        const row = persisted().get(session.id)
        const status = resolveStatus({
          persisted: row,
          runtime: sync.data.session_status[session.id]?.type,
          pendingInput:
            (sync.data.permission[session.id]?.length ?? 0) > 0 || (sync.data.question[session.id]?.length ?? 0) > 0,
        })
        const display = status ? statusDisplay(status, row?.time.updated ?? at, at, theme) : undefined
        const detail = status === "interrupted" ? "stopped while running" : display ? row?.detail : undefined
        const dateLabel = updated === today ? "Today" : updated.slice(4, 10)
        return {
          title: isDeleting ? `Press ${deleteHint()} again to confirm` : session.title,
          bg: isDeleting ? theme.error : undefined,
          description: detail ? Locale.truncate(detail, 48) : undefined,
          footer: display ? (
            <>
              <span style={{ fg: display.color }}>{display.label}</span>
              <span>{` · ${dateLabel}`}</span>
            </>
          ) : (
            dateLabel
          ),
          gutter: display
            ? () => (display.icon ? <text fg={display.color}>{display.icon}</text> : <Spinner />)
            : undefined,
          value: session.id,
          category: session.directory,
        }
      })
  })

  // The footer operates in the context of the selected session row: directory
  // completion anchors at the selected session's directory and sessions
  // created without an explicit @path are created there, falling back to the
  // launch cwd. The selection is frozen while the footer textarea has focus,
  // so reading it lazily at compute time is enough.
  const anchor = () => selectRef?.selected()?.category ?? paths.cwd

  const readdir = cachedReaddir()
  const suggestions = createMemo(() => {
    if (dismissed()) return []
    return directorySuggestions(inputText(), { cwd: anchor(), home: paths.home }, readdir)
  })

  const highlighted = createMemo(() => {
    if (suggestions().length === 0) return 0
    return suggestionIndex() % suggestions().length
  })

  // The list can shrink between keystrokes; keep the highlight inside it.
  createEffect(
    on(suggestions, (list) => {
      if (suggestionIndex() >= list.length) setSuggestionIndex(Math.max(0, list.length - 1))
    }),
  )

  // Coming back from a session remounts this route; once the list first
  // loads, put the cursor back on the session the user just left.
  const [restored, setRestored] = createSignal(false)
  createEffect(() => {
    if (restored()) return
    if (!lastOpenedSessionID) return
    if (!sessions()?.length) return
    selectRef?.moveTo(lastOpenedSessionID)
    setRestored(true)
  })

  function open(sessionID: string) {
    lastOpenedSessionID = sessionID
    route.navigate({ type: "session", sessionID })
  }

  // Same two-step pattern as the project session dialog: the first press arms
  // the row, the second deletes. Server-side removal is keyed by session ID
  // only, so sessions from other directories delete through the same call.
  async function remove(sessionID: string) {
    if (toDelete() !== sessionID) {
      setToDelete(sessionID)
      return
    }
    setToDelete(undefined)
    const result = await sdk.client.session.delete({ sessionID })
    if (result.error) {
      toast.show({ title: "Failed to delete session", message: errorMessage(result.error), variant: "error" })
      return
    }
    await refetch()
  }

  function acceptSuggestion() {
    const picked = suggestions()[highlighted()]
    if (!picked) return
    // Relative completions must resolve against the same anchor at submit
    // time, even if the list selection changes before Enter.
    setCompletionAnchor(anchor())
    // Quoted paths cannot be completed further (the single-token completion
    // no longer matches), so a spaced pick is final and gets no trailing /.
    if (picked.includes(" ")) {
      textarea.setText(`@"${picked}" `)
    } else {
      textarea.setText("@" + picked + "/")
    }
    textarea.gotoBufferEnd()
    setSuggestionIndex(0)
  }

  function leaveFooter() {
    setDismissed(true)
    selectRef?.focusInput()
  }

  async function create() {
    const parsed = parseNewSessionInput(textarea.plainText, {
      cwd: completionAnchor() ?? anchor(),
      home: paths.home,
    })
    if (!parsed.directory && !parsed.prompt) return

    const directory = parsed.directory ?? anchor()
    if (!(existsSync(directory) && statSync(directory).isDirectory())) {
      toast.show({ message: `Directory not found: ${directory}`, variant: "error" })
      return
    }

    // Agents belong to the project, so a session created in another
    // directory falls back to that project's default agent. Providers and
    // models are global: the last-used model/variant always carries over.
    const current = directory === path.normalize(paths.cwd)
    const agent = local.agent.current()
    if (current && !agent) {
      toast.show({ message: "No agent selected.", variant: "error" })
      return
    }
    const model = local.model.current()
    const variant = local.model.variant.current()
    const res = await sdk.client.session.create({
      directory,
      ...(current && agent ? { agent: agent.name } : {}),
      ...(model ? { model: { providerID: model.providerID, id: model.modelID, variant } } : {}),
    })
    if (res.error || !res.data) {
      toast.show({ message: "Creating a session failed. Open console for more details.", variant: "error" })
      return
    }

    const sessionID = res.data.id
    lastOpenedSessionID = sessionID
    if (parsed.prompt) {
      sdk.client.session
        .prompt({
          sessionID,
          ...(model ? { model: { providerID: model.providerID, modelID: model.modelID }, variant } : {}),
          ...(current && agent ? { agent: agent.name } : {}),
          parts: [{ type: "text", text: parsed.prompt }],
        })
        .catch((error) => {
          toast.show({ title: "Failed to send prompt", message: errorMessage(error), variant: "error" })
        })
    }
    // Give the prompt request a head start, mirroring the home submit flow
    navigateTimer = setTimeout(() => route.navigate({ type: "session", sessionID }), 50)
  }

  useBindings(() => ({
    mode: OPENCODE_BASE_MODE,
    commands: [
      {
        name: "sessions.open",
        title: "Open session",
        category: "Session",
        run: () => {
          const sessionID = selectRef?.selected()?.value
          if (sessionID) open(sessionID)
        },
      },
      {
        name: "sessions.new",
        title: "Focus the new session input",
        category: "Session",
        run: () => {
          if (textarea.isDestroyed) return
          textarea.focus()
        },
      },
    ],
    bindings: [
      ...tuiConfig.keybinds.gather("sessions.open", ["sessions.open"]),
      ...tuiConfig.keybinds.gather("sessions.new", ["sessions.new"]),
      {
        key: "tab",
        desc: "Focus new session input",
        group: "Session",
        cmd: () => {
          if (textarea.isDestroyed) return
          textarea.focus()
        },
      },
    ],
  }))

  useBindings(() => ({
    target: textareaTarget,
    enabled: textareaTarget() !== undefined,
    // The footer textarea must win over the list bindings while focused
    priority: 1,
    commands: [
      {
        name: "sessions.create",
        title: "Create session",
        category: "Session",
        run: () => void create(),
      },
    ],
    bindings: [
      ...tuiConfig.keybinds.gather("sessions.create", ["sessions.create"]),
      {
        key: "escape",
        desc: "Back to the sessions list",
        group: "Session",
        cmd: () => {
          if (suggestions().length > 0) {
            setDismissed(true)
            return
          }
          leaveFooter()
        },
      },
      {
        key: "tab",
        desc: "Complete directory",
        group: "Session",
        cmd: () => {
          if (suggestions().length > 0) {
            acceptSuggestion()
            return
          }
          leaveFooter()
        },
      },
    ],
  }))

  useBindings(() => ({
    target: textareaTarget,
    enabled: () => textareaTarget() !== undefined && suggestions().length > 0,
    // Above the base textarea bindings while directory suggestions are open
    priority: 2,
    bindings: [
      {
        key: "up",
        desc: "Previous directory",
        group: "Session",
        cmd: () => setSuggestionIndex((index) => index - 1 + suggestions().length),
      },
      {
        key: "down",
        desc: "Next directory",
        group: "Session",
        cmd: () => setSuggestionIndex((index) => index + 1),
      },
      {
        key: "return",
        desc: "Complete directory",
        group: "Session",
        cmd: () => acceptSuggestion(),
      },
    ],
  }))

  return (
    <box flexDirection="column" flexGrow={1}>
      <DialogSelect
        title="All Sessions"
        placeholder="Search sessions across all projects"
        options={options()}
        categorySort={compareSessionDirectories}
        skipFilter={true}
        preserveSelection={true}
        fullHeight={true}
        scrollbarVisible={true}
        ref={(ref) => (selectRef = ref)}
        onFilter={setSearch}
        onMove={() => setToDelete(undefined)}
        onSelect={(option) => open(option.value)}
        actions={[
          {
            command: "session.delete",
            title: "delete",
            onTrigger: (option: { value: string }) => void remove(option.value),
          },
        ]}
        bindings={[
          { key: "escape", desc: "Back to home", group: "Dialog", cmd: () => route.navigate({ type: "home" }) },
        ]}
        footerHints={[
          { title: "open", label: "→" },
          { title: "new session", label: "ctrl+o" },
          { title: "back", label: "esc" },
        ]}
      />
      <Show when={suggestions().length > 0}>
        <box flexDirection="column" flexShrink={0} paddingLeft={4} paddingRight={4}>
          <For each={suggestions()}>
            {(suggestion, index) => (
              <text fg={index() === highlighted() ? theme.primary : theme.textMuted}>
                {index() === highlighted() ? "❯ " : "  "}
                {suggestion}
              </text>
            )}
          </For>
        </box>
      </Show>
      <box flexDirection="row" flexShrink={0} paddingLeft={4} paddingRight={4} paddingBottom={1} gap={1}>
        <text fg={theme.textMuted}>new session:</text>
        <textarea
          height={1}
          ref={(val: TextareaRenderable) => {
            textarea = val
            setTextareaTarget(val)
          }}
          onContentChange={() => {
            setInputText(textarea.plainText)
            if (!textarea.plainText.trimStart().startsWith("@")) setCompletionAnchor(undefined)
            setDismissed(false)
            setSuggestionIndex(0)
          }}
          placeholder="@path optional prompt"
          placeholderColor={theme.textMuted}
          textColor={theme.text}
          focusedTextColor={theme.text}
          cursorColor={theme.primary}
          flexGrow={1}
        />
      </box>
    </box>
  )
}
