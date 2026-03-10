import path from "path"
import { mkdir } from "node:fs/promises"
import os from "node:os"
import { useKeyboard, useRenderer } from "@opentui/solid"
import { useCommandDialog } from "@tui/component/dialog-command"
import { useKeybind } from "@tui/context/keybind"
import { useRoute, useRouteData } from "@tui/context/route"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { Toast, useToast } from "@tui/ui/toast"
import { useDialog } from "@tui/ui/dialog"
import { Filesystem } from "@/util/filesystem"
import { Global } from "@/global"
import { Flag } from "@/flag/flag"
import { Glob } from "@/util/glob"
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { Editor } from "@tui/util/editor"

type Entry = {
  path: string
  kind: string
  exists: boolean
}

type Group = {
  kind: string
  title: string
  items: Entry[]
}

const FRONTMATTER = ["---", "applyTo: '**'", "---", ""].join("\n")
const RULES = "**/{AGENTS.md,CLAUDE.md,CONTEXT.md}"

async function collect(opts: {
  directory: string
  worktree: string
  instructions?: string[]
  skills: { location: string }[]
}) {
  const result = new Set<string>()

  if (!Flag.OPENCODE_DISABLE_PROJECT_CONFIG) {
    const matches = await Glob.scan(RULES, {
      cwd: opts.worktree,
      absolute: true,
      include: "file",
      dot: true,
    }).catch(() => [])
    matches.forEach((item) => result.add(path.resolve(item)))
  }

  for (const file of [
    ...(Flag.OPENCODE_CONFIG_DIR ? [path.join(Flag.OPENCODE_CONFIG_DIR, "AGENTS.md")] : []),
    path.join(Global.Path.config, "AGENTS.md"),
    ...(!Flag.OPENCODE_DISABLE_CLAUDE_CODE_PROMPT ? [path.join(os.homedir(), ".claude", "CLAUDE.md")] : []),
  ]) {
    if (!(await Filesystem.exists(file))) continue
    result.add(path.resolve(file))
    break
  }

  for (let instruction of opts.instructions ?? []) {
    if (instruction.startsWith("http://") || instruction.startsWith("https://")) continue
    const file = instruction.startsWith("~/") ? path.join(Global.Path.home, instruction.slice(2)) : instruction
    const matches = path.isAbsolute(file)
      ? await Glob.scan(path.basename(file), {
          cwd: path.dirname(file),
          absolute: true,
          include: "file",
          dot: true,
        }).catch(() => [])
      : !Flag.OPENCODE_DISABLE_PROJECT_CONFIG
        ? await Filesystem.globUp(file, opts.directory, opts.worktree).catch(() => [])
        : !Flag.OPENCODE_CONFIG_DIR
          ? []
          : await Filesystem.globUp(file, Flag.OPENCODE_CONFIG_DIR, Flag.OPENCODE_CONFIG_DIR).catch(() => [])
    matches.forEach((item) => result.add(path.resolve(item)))
  }

  for (const skill of opts.skills) {
    result.add(path.resolve(skill.location))
  }

  return Array.from(result).sort((a, b) => a.localeCompare(b))
}

function kind(file: string, opts: { worktree: string }) {
  const full = path.resolve(file).replaceAll("\\", "/")
  const home = Global.Path.home.replaceAll("\\", "/")
  const config = Global.Path.config.replaceAll("\\", "/")
  const worktree = path.resolve(opts.worktree).replaceAll("\\", "/")
  const global_agents = [
    ...(Flag.OPENCODE_CONFIG_DIR
      ? [path.resolve(path.join(Flag.OPENCODE_CONFIG_DIR, "AGENTS.md")).replaceAll("\\", "/")]
      : []),
    path.resolve(path.join(Global.Path.config, "AGENTS.md")).replaceAll("\\", "/"),
  ]
  const global_claude = path.resolve(path.join(home, ".claude", "CLAUDE.md")).replaceAll("\\", "/")
  const root_agents = path.join(worktree, "AGENTS.md").replaceAll("\\", "/")
  const root_claude = path.join(worktree, "CLAUDE.md").replaceAll("\\", "/")
  const root_context = path.join(worktree, "CONTEXT.md").replaceAll("\\", "/")

  if (full.includes("/.opencode/skills/") || full.startsWith(config + "/skills/")) return "opencode_skill"
  if (full.includes("/.claude/skills/") || full.startsWith(home + "/.claude/skills/")) return "claude_skill"
  if (full.includes("/.agents/skills/") || full.startsWith(home + "/.agents/skills/")) return "agents_skill"
  if (file.endsWith("SKILL.md")) return "skill"
  if (global_agents.includes(full)) return "global_agents"
  if (full === root_agents) return "root_agents"
  if (file.endsWith("AGENTS.md")) return "nested_agents"
  if (full === global_claude) return "global_claude"
  if (full === root_claude) return "root_claude"
  if (file.endsWith("CLAUDE.md")) return "nested_claude"
  if (full === root_context) return "root_context"
  if (file.endsWith("CONTEXT.md")) return "nested_context"
  if (file.endsWith("memory.instruction.md")) return "memory"
  return "instruction"
}

function title(kind: string) {
  if (kind === "global_agents") return "Global Agents"
  if (kind === "root_agents") return "Project Root Agents"
  if (kind === "nested_agents") return "Nested Agents"
  if (kind === "global_claude") return "Global Claude"
  if (kind === "root_claude") return "Project Root Claude"
  if (kind === "nested_claude") return "Nested Claude"
  if (kind === "root_context") return "Project Root Context"
  if (kind === "nested_context") return "Nested Context"
  if (kind === "opencode_skill") return "OpenCode Skills"
  if (kind === "claude_skill") return "Claude Skills"
  if (kind === "agents_skill") return "Agents Skills"
  if (kind === "skill") return "Skills"
  if (kind === "memory") return "Memory"
  return "Instructions"
}

function rank(kind: string) {
  if (kind === "memory") return 0
  if (kind === "global_agents") return 1
  if (kind === "root_agents") return 2
  if (kind === "nested_agents") return 3
  if (kind === "global_claude") return 4
  if (kind === "root_claude") return 5
  if (kind === "nested_claude") return 6
  if (kind === "root_context") return 7
  if (kind === "nested_context") return 8
  if (kind === "opencode_skill") return 9
  if (kind === "claude_skill") return 10
  if (kind === "agents_skill") return 11
  if (kind === "skill") return 12
  return 13
}

export function Memory() {
  const nav = useRoute()
  const route = useRouteData("memory")
  const sdk = useSDK()
  const sync = useSync()
  const keybind = useKeybind()
  const command = useCommandDialog()
  const dialog = useDialog()
  const renderer = useRenderer()
  const toast = useToast()
  const { theme } = useTheme()
  const [list, setList] = createSignal<Entry[]>([])
  const [index, setIndex] = createSignal(0)
  const [state, setState] = createSignal<"loading" | "ready" | "error">("loading")
  const [error, setError] = createSignal("")

  const root = createMemo(() => sync.data.path.worktree || sync.data.path.directory || process.cwd())
  const worktree = createMemo(() => sync.data.path.worktree || root())
  const total = createMemo(() => list().length)
  const current = createMemo(() => list()[index()])
  const groups = createMemo<Group[]>(() => {
    const map = new Map<string, Entry[]>()
    for (const item of list()) {
      const arr = map.get(item.kind) ?? []
      arr.push(item)
      map.set(item.kind, arr)
    }
    return Array.from(map.entries())
      .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
      .map(([kind, items]) => ({
        kind,
        title: title(kind),
        items,
      }))
  })
  async function reload() {
    setState("loading")
    setError("")
    try {
      const result = await sdk.client.app.skills().catch(() => undefined)
      const files = await collect({
        directory: root(),
        worktree: worktree(),
        instructions: sync.data.config.instructions,
        skills: result?.data ?? [],
      })
      const next = await Promise.all(
        files.map(async (file) => ({
          path: file,
          kind: kind(file, { worktree: worktree() }),
          exists: await Filesystem.exists(file),
        })),
      )
      setList(next)
      setIndex((value) => Math.min(value, Math.max(0, next.length - 1)))
      setState("ready")
    } catch (err) {
      console.error("memory reload failed", err)
      setState("error")
      const message = err instanceof Error ? err.message : "Failed to load memory files"
      setError(message)
      toast.show({
        variant: "error",
        message,
      })
    }
  }

  async function ensure(file: string) {
    if (!file.endsWith("memory.instruction.md")) return
    if (await Filesystem.exists(file)) {
      const text = await Filesystem.readText(file).catch(() => "")
      if (text.trim()) return
    }
    await Filesystem.write(file, FRONTMATTER)
  }

  async function open(kind: "file" | "dir") {
    const item = current()
    if (!item) return
    try {
      if (kind === "file") {
        await ensure(item.path)
        await Editor.file({ path: item.path, renderer })
      } else {
        await mkdir(path.dirname(item.path), { recursive: true })
        await Editor.dir(path.dirname(item.path))
      }
      await reload()
    } catch (err) {
      toast.show({
        variant: "error",
        message: err instanceof Error ? err.message : "Failed to open memory entry",
      })
    }
  }

  function move(dir: number) {
    if (total() === 0) return
    const next = index() + dir
    if (next < 0) {
      setIndex(total() - 1)
      return
    }
    if (next >= total()) {
      setIndex(0)
      return
    }
    setIndex(next)
  }

  function back() {
    nav.navigate(route.back)
  }

  createEffect(() => {
    root()
    void reload()
  })

  onMount(() => {
    keybind.captureLeader(false)
  })

  onCleanup(() => {
    keybind.captureLeader(true)
  })

  useKeyboard((evt) => {
    if (dialog.stack.length > 0) return
    if (evt.defaultPrevented) return

    if (evt.name === "escape") {
      evt.preventDefault()
      evt.stopPropagation()
      back()
      return
    }

    if (evt.name === "up") {
      evt.preventDefault()
      move(-1)
      return
    }

    if (evt.name === "down") {
      evt.preventDefault()
      move(1)
    }
  })

  command.register(() => [
    {
      title: "Open selected memory file",
      value: "memory.open",
      keybind: "memory_open_file",
      category: "Memory",
      enabled: !!current(),
      onSelect: (dialog) => {
        dialog.clear()
        void open("file")
      },
    },
    {
      title: "Open selected memory directory",
      value: "memory.dir",
      keybind: "memory_open_directory",
      category: "Memory",
      enabled: !!current(),
      onSelect: (dialog) => {
        dialog.clear()
        void open("dir")
      },
    },
    {
      title: "Refresh memory files",
      value: "memory.refresh",
      category: "Memory",
      onSelect: (dialog) => {
        dialog.clear()
        void reload()
      },
    },
  ])

  return (
    <>
      <box flexGrow={1} alignItems="center" paddingLeft={2} paddingRight={2}>
        <box flexGrow={1} minHeight={0} />
        <box width="100%" maxWidth={100} flexDirection="column" backgroundColor={theme.backgroundPanel}>
          <box flexDirection="row" justifyContent="space-between" paddingLeft={2} paddingRight={2} paddingTop={1}>
            <text fg={theme.text}>Memory</text>
            <text fg={theme.textMuted}>esc back</text>
          </box>
          <box flexDirection="column" gap={1} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
            <Show when={state() === "ready"} fallback={<text fg={theme.textMuted}>Loading memory files...</text>}>
              <text fg={theme.textMuted}>There are {total()} memory file(s) in use:</text>
            </Show>
            <box flexDirection="row" gap={2}>
              <text fg={theme.text}>
                {keybind.print("memory_open_file")} <span style={{ fg: theme.textMuted }}>open file</span>
              </text>
              <text fg={theme.text}>
                {keybind.print("memory_open_directory")} <span style={{ fg: theme.textMuted }}>open directory</span>
              </text>
            </box>
            <Show when={state() === "error"}>
              <text fg={theme.error}>{error() || "Failed to load memory files."}</text>
            </Show>
          </box>
          <box height={1} backgroundColor={theme.backgroundElement} />
          <scrollbox
            flexGrow={1}
            height="100%"
            paddingLeft={2}
            paddingRight={2}
            paddingTop={1}
            paddingBottom={1}
            verticalScrollbarOptions={{
              trackOptions: {
                backgroundColor: theme.backgroundPanel,
                foregroundColor: theme.borderActive,
              },
            }}
          >
            <Show when={list().length > 0} fallback={<text fg={theme.textMuted}>No active memory files found.</text>}>
              <box flexDirection="column">
                <For each={groups()}>
                  {(group) => (
                    <box flexDirection="column" marginBottom={1}>
                      <text fg={theme.text}>
                        {group.title}
                        <span style={{ fg: theme.textMuted }}>{` (${group.items.length})`}</span>
                      </text>
                      <For each={group.items}>
                        {(item) => {
                          const active = createMemo(() => current()?.path === item.path)
                          return (
                            <box
                              backgroundColor={active() ? theme.backgroundElement : undefined}
                              paddingLeft={2}
                              paddingRight={1}
                            >
                              <text fg={active() ? theme.text : theme.textMuted}>
                                {item.path}
                                <span style={{ fg: active() ? theme.textMuted : theme.borderSubtle }}>
                                  {item.exists ? "" : " [missing]"}
                                </span>
                              </text>
                            </box>
                          )
                        }}
                      </For>
                    </box>
                  )}
                </For>
              </box>
            </Show>
          </scrollbox>
        </box>
        <box flexGrow={1} minHeight={0} />
        <Toast />
      </box>
      <box paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2} flexDirection="row" flexShrink={0} gap={2}>
        <text fg={theme.textMuted}>{root()}</text>
        <box flexGrow={1} />
        <Show when={current()}>
          {(item) => (
            <text fg={theme.textMuted}>
              {keybind.print("memory_open_file")} {item().path}
            </text>
          )}
        </Show>
      </box>
    </>
  )
}
