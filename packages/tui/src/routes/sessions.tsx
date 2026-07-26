import { createMemo, createResource, createSignal, onCleanup } from "solid-js"
import path from "path"
import { existsSync, statSync } from "node:fs"
import type { TextareaRenderable } from "@opentui/core"
import type { GlobalSession } from "@opencode-ai/sdk/v2"
import { DialogSelect, type DialogSelectRef } from "../ui/dialog-select"
import { useRoute } from "../context/route"
import { useSDK } from "../context/sdk"
import { useEvent } from "../context/event"
import { useTheme } from "../context/theme"
import { useLocal } from "../context/local"
import { useTuiPaths } from "../context/runtime"
import { useToast } from "../ui/toast"
import { useTuiConfig } from "../config"
import { useBindings } from "../keymap"
import { Locale } from "../util/locale"
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

export function sessionsSessionOrigin(session: Pick<GlobalSession, "directory" | "project">) {
  const name = session.project?.name
  if (name) return name
  const worktree = path.basename(session.project?.worktree ?? "")
  if (worktree) return worktree
  return session.directory ? path.basename(session.directory) : ""
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
      const label = new Date(session.time.updated).toDateString()
      const origin = sessionsSessionOrigin(session)
      return {
        title: session.title,
        value: session.id,
        category: label === today ? "Today" : label,
        footer: origin ? Locale.truncate(origin, 20) : "",
      }
    })
  })

  function open(sessionID: string) {
    route.navigate({ type: "session", sessionID })
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
      { key: "escape", desc: "Back to the sessions list", group: "Session", cmd: () => selectRef?.focusInput() },
      { key: "tab", desc: "Back to the sessions list", group: "Session", cmd: () => selectRef?.focusInput() },
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
        onSelect={(option) => open(option.value)}
        bindings={[
          { key: "escape", desc: "Back to home", group: "Dialog", cmd: () => route.navigate({ type: "home" }) },
        ]}
        footerHints={[
          { title: "open", label: "→" },
          { title: "new session", label: "ctrl+o" },
          { title: "back", label: "esc" },
        ]}
      />
      <box flexDirection="row" flexShrink={0} paddingLeft={4} paddingRight={4} paddingBottom={1} gap={1}>
        <text fg={theme.textMuted}>new session:</text>
        <textarea
          height={1}
          ref={(val: TextareaRenderable) => {
            textarea = val
            setTextareaTarget(val)
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
