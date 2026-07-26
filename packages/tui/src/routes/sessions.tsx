import { createMemo, createResource, createSignal, onCleanup, Show, For } from "solid-js"
import path from "path"
import { existsSync, statSync, readdirSync } from "node:fs"
import type { TextareaRenderable } from "@opentui/core"
import { DialogSelect, type DialogSelectRef } from "../ui/dialog-select"
import { useRoute } from "../context/route"
import { useSDK } from "../context/sdk"
import { useEvent } from "../context/event"
import { useTheme } from "../context/theme"
import { useLocal } from "../context/local"
import { useTuiPaths } from "../context/runtime"
import { useToast } from "../ui/toast"
import { useTuiConfig } from "../config"
import { useBindings, useCommandShortcut } from "../keymap"
import { createDebouncedSignal } from "../util/signal"
import { errorMessage } from "../util/error"

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
// creates sessions in the current directory when no @path is given.
export function parseNewSessionInput(input: string, paths: { cwd: string; home: string }) {
  const text = input.trim()
  const match = /^@(\S+)(?:\s+([\s\S]*))?$/.exec(text)
  if (!match) return { directory: undefined, prompt: text }
  const raw = match[1]
  const resolved = path.isAbsolute(raw)
    ? raw
    : raw.startsWith("~")
      ? path.join(paths.home, raw.slice(1))
      : path.resolve(paths.cwd, raw)
  return { directory: path.normalize(resolved), prompt: (match[2] ?? "").trim() }
}

// Directory completion for the new session input: only fires while the input
// is a single @token (no prompt text yet). `readdir` is injected so tests can
// stub the filesystem.
export function directorySuggestions(
  input: string,
  paths: { cwd: string; home: string },
  readdir: (dir: string) => string[],
) {
  const match = /^@(\S*)$/.exec(input.trim())
  if (!match) return []
  const token = match[1]
  const expanded = token.startsWith("~") ? path.join(paths.home, token.slice(1)) : token
  const descend = expanded.endsWith("/") || token === "~"
  const absolute = path.isAbsolute(expanded) ? expanded : path.resolve(paths.cwd, expanded)
  const base = descend ? absolute : expanded.includes("/") ? path.dirname(absolute) : paths.cwd
  const prefix = descend ? "" : expanded.includes("/") ? path.basename(absolute) : expanded
  return readdir(base)
    .filter((name) => name !== "node_modules")
    .filter((name) => prefix.startsWith(".") || !name.startsWith("."))
    .filter((name) => name.startsWith(prefix))
    .toSorted()
    .slice(0, 8)
    .map((name) => path.join(base, name))
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

export function Sessions() {
  const route = useRoute()
  const sdk = useSDK()
  const event = useEvent()
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
  const deleteHint = useCommandShortcut("session.delete")
  let selectRef: DialogSelectRef<string> | undefined
  let textarea: TextareaRenderable

  const [sessions, { refetch }] = createResource(
    () => search(),
    (query) =>
      sdk.globalClient.experimental.session
        .list(createSessionsListQuery({ search: query }))
        .then((result) => result.data ?? []),
  )

  onCleanup(event.on("session.deleted", () => refetch()))

  const options = createMemo(() => {
    const today = new Date().toDateString()
    return (sessions() ?? []).toSorted((a, b) => b.time.updated - a.time.updated).map((session) => {
      const updated = new Date(session.time.updated).toDateString()
      const isDeleting = toDelete() === session.id
      return {
        title: isDeleting ? `Press ${deleteHint()} again to confirm` : session.title,
        bg: isDeleting ? theme.error : undefined,
        value: session.id,
        category: session.directory,
        footer: updated === today ? "Today" : updated.slice(4, 10),
      }
    })
  })

  const suggestions = createMemo(() => {
    if (dismissed()) return []
    return directorySuggestions(inputText(), { cwd: sdk.directory ?? paths.cwd, home: paths.home }, readdirDirectories)
  })

  const highlighted = createMemo(() => {
    if (suggestions().length === 0) return 0
    return suggestionIndex() % suggestions().length
  })

  function open(sessionID: string) {
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
    textarea.setText("@" + picked + "/")
    setSuggestionIndex(0)
  }

  function leaveFooter() {
    setDismissed(true)
    selectRef?.focusInput()
  }

  async function create() {
    const parsed = parseNewSessionInput(textarea.plainText, { cwd: sdk.directory ?? paths.cwd, home: paths.home })
    if (!parsed.directory && !parsed.prompt) return

    if (parsed.directory && !(existsSync(parsed.directory) && statSync(parsed.directory).isDirectory())) {
      toast.show({ message: `Directory not found: ${parsed.directory}`, variant: "error" })
      return
    }

    const agent = local.agent.current()
    if (!agent) {
      toast.show({ message: "No agent selected.", variant: "error" })
      return
    }
    const model = local.model.current()
    const variant = local.model.variant.current()
    const res = await sdk.client.session.create({
      directory: parsed.directory,
      agent: agent.name,
      ...(model ? { model: { providerID: model.providerID, id: model.modelID, variant } } : {}),
    })
    if (res.error || !res.data) {
      toast.show({ message: "Creating a session failed. Open console for more details.", variant: "error" })
      return
    }

    const sessionID = res.data.id
    if (parsed.prompt && model) {
      sdk.client.session
        .prompt({
          sessionID,
          model: { providerID: model.providerID, modelID: model.modelID },
          agent: agent.name,
          variant,
          parts: [{ type: "text", text: parsed.prompt }],
        })
        .catch((error) => {
          toast.show({ title: "Failed to send prompt", message: errorMessage(error), variant: "error" })
        })
    }
    // Give the prompt request a head start, mirroring the home submit flow
    setTimeout(() => route.navigate({ type: "session", sessionID }), 50)
  }

  useBindings(() => ({
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
      { key: "tab", desc: "Focus new session input", group: "Session", cmd: () => textarea.focus() },
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
    ],
  }))

  return (
    <box flexDirection="column" flexGrow={1}>
      <DialogSelect
        title="All Sessions"
        placeholder="Search sessions across all projects"
        options={options()}
        skipFilter={true}
        preserveSelection={true}
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
