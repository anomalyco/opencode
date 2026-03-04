import { useSync } from "@tui/context/sync"
import { createEffect, createMemo, createSignal, For, onMount, Show, Switch, Match } from "solid-js"
import { createStore } from "solid-js/store"
import { useTheme } from "../../context/theme"
import path from "path"
import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import { Installation } from "@/installation"
import { useDirectory } from "../../context/directory"
import { useKV } from "../../context/kv"
import { TodoItem } from "../../component/todo-item"
import { DialogSelect } from "../../ui/dialog-select"
import { useDialog } from "../../ui/dialog"
import { InputRenderable, MouseButton, type MouseEvent } from "@opentui/core"
import { useLocal } from "../../context/local"
import { useSDK } from "../../context/sdk"
import { Identifier } from "@/id/id"
import { useToast } from "../../ui/toast"
import { Filesystem } from "@/util/filesystem"
import { Glob } from "@/util/glob"
import open from "open"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { Clipboard } from "../../util/clipboard"
import { rm } from "fs/promises"

type PromptDoc = {
  version?: string
  category?: string
  categoryIcon?: string
  prompts?: {
    id: string
    name: string
    description?: string
    template: string
    tags?: string[]
  }[]
}

type PromptItem = {
  id: string
  name: string
  description?: string
  category: string
  icon?: string
  template: string
  tags: string[]
  file: string
}

const STARTER_PROMPTS: PromptDoc = {
  version: "1.0",
  category: "starter",
  categoryIcon: "🧰",
  prompts: [
    {
      id: "quick-code-review",
      name: "Quick Code Review",
      description: "Catch obvious bugs and style issues",
      template:
        "Review this code for obvious bugs and style issues. Keep it concise and actionable.\n\n```\n{{selection}}\n```",
      tags: ["review", "quality"],
    },
    {
      id: "deep-code-review",
      name: "Deep Code Review",
      description: "Architecture, correctness, and maintainability",
      template:
        "Do a deep code review focused on correctness, maintainability, and architecture. Provide prioritized findings.\n\n```\n{{selection}}\n```",
      tags: ["review", "architecture"],
    },
    {
      id: "security-audit",
      name: "Security Audit",
      description: "Find security risks and mitigations",
      template:
        "Audit this code for security vulnerabilities and risky assumptions. Suggest concrete fixes.\n\n```\n{{selection}}\n```",
      tags: ["security", "review"],
    },
    {
      id: "performance-review",
      name: "Performance Review",
      description: "Spot bottlenecks and improvements",
      template:
        "Review this code for performance bottlenecks and optimization opportunities. Include tradeoffs.\n\n```\n{{selection}}\n```",
      tags: ["performance", "review"],
    },
    {
      id: "accessibility-review",
      name: "Accessibility Review",
      description: "Check UI for accessibility issues",
      template:
        "Review this UI code for accessibility issues (keyboard navigation, semantics, contrast, ARIA).\n\n```\n{{selection}}\n```",
      tags: ["a11y", "review"],
    },
    {
      id: "commit-message",
      name: "Generate Commit Message",
      description: "Write a concise commit message",
      template: "Write a concise commit message (title + 1 short body paragraph) for the current git changes.",
      tags: ["git", "commit"],
    },
    {
      id: "pr-summary",
      name: "Generate PR Summary",
      description: "Draft pull request summary",
      template: "Draft a PR summary with context, what changed, and key risks for the current branch.",
      tags: ["git", "pr"],
    },
    {
      id: "lint-fix",
      name: "Lint and Fix",
      description: "Run lint and fix issues",
      template: "Run lint, fix all safe issues, and summarize anything that must be fixed manually.",
      tags: ["lint", "quality"],
    },
    {
      id: "format-code",
      name: "Format Code",
      description: "Apply formatting standards",
      template: "Apply formatting for changed files and report what was reformatted.",
      tags: ["format"],
    },
    {
      id: "generate-tests",
      name: "Generate Unit Tests",
      description: "Create focused tests",
      template:
        "Generate high-value unit tests for this code. Focus on edge cases and behavior, not implementation details.\n\n```\n{{selection}}\n```",
      tags: ["test", "quality"],
    },
    {
      id: "debug-error",
      name: "Debug Error",
      description: "Root cause analysis",
      template:
        "Debug this issue. Provide root cause, reproduction steps, and a fix plan.\n\nError/context:\n{{clipboard}}",
      tags: ["debug"],
    },
    {
      id: "refactor-plan",
      name: "Refactor Plan",
      description: "Propose a safe refactor",
      template:
        "Create a step-by-step refactor plan for this code with minimal risk and clear checkpoints.\n\n```\n{{selection}}\n```",
      tags: ["refactor"],
    },
    {
      id: "typescript-types",
      name: "Improve TypeScript Types",
      description: "Strengthen typing",
      template:
        "Improve the TypeScript types in this code. Avoid any, add precise return types, and simplify inference where possible.\n\n```\n{{selection}}\n```",
      tags: ["typescript"],
    },
    {
      id: "update-version",
      name: "Update Project Version",
      description: "Bump version safely",
      template: "Update the project version safely and summarize impacted files and release notes.",
      tags: ["release", "version"],
    },
    {
      id: "changelog",
      name: "Generate Changelog",
      description: "Draft changelog from changes",
      template: "Generate a changelog entry from recent commits and changed files.",
      tags: ["release", "docs"],
    },
    {
      id: "dependency-audit",
      name: "Dependency Audit",
      description: "Review dependency risks",
      template: "Audit dependencies for outdated or vulnerable packages and propose update order.",
      tags: ["dependencies", "security"],
    },
    {
      id: "readme-update",
      name: "Update README",
      description: "Refresh docs for current behavior",
      template: "Update README based on the current project behavior and setup instructions.",
      tags: ["docs"],
    },
    {
      id: "explain-code",
      name: "Explain Code",
      description: "Explain in plain language",
      template: "Explain this code in plain language with a short example.\n\n```\n{{selection}}\n```",
      tags: ["learning"],
    },
    {
      id: "breakdown-task",
      name: "Break Down Task",
      description: "Turn goal into implementation plan",
      template: "Break this task into implementation steps with risks and validation checks:\n{{clipboard}}",
      tags: ["planning"],
    },
    {
      id: "ship-checklist",
      name: "Ship Checklist",
      description: "Final pre-merge checks",
      template:
        "Create a pre-merge checklist for this change including tests, lint, build, docs, and rollout considerations.",
      tags: ["release", "quality"],
    },
  ],
}

function normalizeCategory(text?: string) {
  if (!text) return "General"
  return text
    .split(/[-_]/g)
    .filter(Boolean)
    .map((item) => item.slice(0, 1).toUpperCase() + item.slice(1))
    .join(" ")
}

function clampRatio(value: number) {
  return Math.max(0.3, Math.min(0.7, value))
}

function slug(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function matchPrompt(item: PromptItem, query: string) {
  if (!query) return true
  const q = query.toLowerCase()
  if (item.name.toLowerCase().includes(q)) return true
  if (item.description?.toLowerCase().includes(q)) return true
  if (item.category.toLowerCase().includes(q)) return true
  if (item.tags.some((tag) => tag.toLowerCase().includes(q))) return true
  return item.template.toLowerCase().includes(q)
}

async function ensurePromptFolder(directory: string) {
  const root = path.join(directory, ".opencode", "prompts")
  const custom = path.join(root, "custom")
  const starter = path.join(root, "starter-pack.json")
  const gitignore = path.join(directory, ".opencode", ".gitignore")
  await Filesystem.write(path.join(custom, ".keep"), "")
  const existing = await Filesystem.readText(starter).catch(() => "")
  if (!existing) {
    await Filesystem.writeJson(starter, STARTER_PROMPTS)
  }
  const ignored = await Filesystem.readText(gitignore).catch(() => "")
  if (!ignored.includes("prompts/custom/")) {
    const next = ignored.trim() ? `${ignored.trim()}\nprompts/custom/\n` : "prompts/custom/\n"
    await Filesystem.write(gitignore, next)
  }
  return root
}

async function readPromptFolder(directory: string) {
  const root = await ensurePromptFolder(directory)
  const files = await Glob.scan("**/*.json", { cwd: root, absolute: true, dot: true })
  const result = (
    await Promise.all(
      files.map(async (file) => {
        const parsed = await Filesystem.readJson<PromptDoc>(file).catch(() => undefined)
        if (!parsed?.prompts?.length) return [] as PromptItem[]
        return parsed.prompts
          .filter((item) => item.id && item.name && item.template)
          .map((item) => ({
            id: item.id,
            name: item.name,
            description: item.description,
            category: normalizeCategory(parsed.category),
            icon: parsed.categoryIcon,
            template: item.template,
            tags: item.tags ?? [],
            file,
          }))
      }),
    )
  ).flat()
  return result
}

function renderTemplate(template: string, input: { selection: string; clipboard: string }) {
  return template
    .replaceAll("{{selection}}", input.selection || "")
    .replaceAll("{{clipboard}}", input.clipboard || "")
}

export function Sidebar(props: { sessionID: string; overlay?: boolean }) {
  const sync = useSync()
  const { theme } = useTheme()
  const session = createMemo(() => sync.session.get(props.sessionID)!)
  const diff = createMemo(() => sync.data.session_diff[props.sessionID] ?? [])
  const todo = createMemo(() => sync.data.todo[props.sessionID] ?? [])
  const messages = createMemo(() => sync.data.message[props.sessionID] ?? [])

  const [expanded, setExpanded] = createStore({
    mcp: true,
    diff: true,
    todo: true,
    lsp: true,
  })

  // Sort MCP servers alphabetically for consistent display order
  const mcpEntries = createMemo(() => Object.entries(sync.data.mcp).sort(([a], [b]) => a.localeCompare(b)))

  // Count connected and error MCP servers for collapsed header display
  const connectedMcpCount = createMemo(() => mcpEntries().filter(([_, item]) => item.status === "connected").length)
  const errorMcpCount = createMemo(
    () =>
      mcpEntries().filter(
        ([_, item]) =>
          item.status === "failed" || item.status === "needs_auth" || item.status === "needs_client_registration",
      ).length,
  )

  const cost = createMemo(() => {
    const total = messages().reduce((sum, x) => sum + (x.role === "assistant" ? x.cost : 0), 0)
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(total)
  })

  const context = createMemo(() => {
    const last = messages().findLast((x) => x.role === "assistant" && x.tokens.output > 0) as AssistantMessage
    if (!last) return
    const total =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    const model = sync.data.provider.find((x) => x.id === last.providerID)?.models[last.modelID]
    return {
      tokens: total.toLocaleString(),
      percentage: model?.limit.context ? Math.round((total / model.limit.context) * 100) : null,
    }
  })

  const directory = useDirectory()
  const kv = useKV()
  const dialog = useDialog()
  const local = useLocal()
  const sdk = useSDK()
  const toast = useToast()
  const renderer = useRenderer()
  const terminal = useTerminalDimensions()

  const [split, setSplit] = kv.signal("sidebar_prompt_split", 0.6)
  const [dragging, setDragging] = createSignal(false)
  const [dragY, setDragY] = createSignal<number>()
  const [dragTop, setDragTop] = createSignal<number>()
  const [query, setQuery] = createSignal("")
  const [active, setActive] = createSignal(false)
  const [selected, setSelected] = createSignal(0)
  const [prompts, setPrompts] = createSignal<PromptItem[]>([])
  const [fav, setFav] = kv.signal<string[]>("prompt_favorite", [])
  const [recent, setRecent] = kv.signal<string[]>("prompt_recent", [])
  const [usage, setUsage] = kv.signal<Record<string, number>>("prompt_usage", {})
  const [expandedPrompt, setExpandedPrompt] = kv.signal<Record<string, boolean>>("prompt_category_expanded", {})
  let search: InputRenderable | undefined

  const root = createMemo(() => sync.data.path.directory || process.cwd())

  async function reloadPrompts() {
    const list = await readPromptFolder(root()).catch(() => [] as PromptItem[])
    setPrompts(list)
  }

  onMount(() => {
    reloadPrompts().catch(() => {})
  })

  const filtered = createMemo(() => prompts().filter((item) => matchPrompt(item, query())))
  const grouped = createMemo(() => {
    const map = new Map<string, PromptItem[]>()
    for (const item of filtered()) {
      const arr = map.get(item.category) ?? []
      arr.push(item)
      map.set(item.category, arr)
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  })
  const ordered = createMemo(() => {
    return [...filtered()].sort((a, b) => {
      const category = a.category.localeCompare(b.category)
      if (category !== 0) return category
      return a.name.localeCompare(b.name)
    })
  })

  const selectedPrompt = createMemo(() => ordered()[selected()])

  createEffect(() => {
    const max = ordered().length - 1
    if (max < 0) {
      setSelected(0)
      return
    }
    if (selected() > max) setSelected(max)
  })

  const favoriteItems = createMemo(() => {
    const ids = new Set(fav())
    return filtered().filter((item) => ids.has(item.id))
  })

  const recentItems = createMemo(() => {
    const items = new Map(prompts().map((item) => [item.id, item]))
    return recent()
      .map((id: string) => items.get(id))
      .filter((item: PromptItem | undefined): item is PromptItem => !!item)
      .filter((item: PromptItem) => matchPrompt(item, query()))
      .slice(0, 5)
  })

  const panelHeight = createMemo(() => Math.max(12, terminal().height - 10))
  const topHeight = createMemo(() => {
    const height = Math.round(panelHeight() * split())
    return Math.max(5, Math.min(panelHeight() - 6, height))
  })
  const bottomHeight = createMemo(() => panelHeight() - topHeight() - 1)

  function setSplitByMouse(evt: MouseEvent) {
    if (!dragging()) return
    const y = dragY()
    const top = dragTop()
    if (y === undefined || top === undefined) return
    const delta = evt.y - y
    const next = Math.max(5, Math.min(panelHeight() - 6, top + delta))
    setSplit(() => clampRatio(next / panelHeight()))
  }

  async function openPromptFolder() {
    const folder = await ensurePromptFolder(root()).catch(() => undefined)
    if (!folder) {
      toast.show({ message: "Failed to open prompt folder", variant: "error" })
      return
    }
    await open(folder).catch(() => {
      toast.show({ message: "Failed to open prompt folder", variant: "error" })
    })
  }

  async function createPromptFromQuery() {
    const name = query().trim()
    if (!name) return
    const folder = await ensurePromptFolder(root()).catch(() => undefined)
    if (!folder) {
      toast.show({ message: "Failed to create prompt", variant: "error" })
      return
    }
    const id = slug(name) || `prompt-${Date.now()}`
    const file = path.join(folder, "custom", `${id}.json`)
    await Filesystem.writeJson(file, {
      version: "1.0",
      category: "custom",
      categoryIcon: "✨",
      prompts: [
        {
          id,
          name,
          description: "Custom prompt",
          template: `You are helping with: ${name}.\n\nContext:\n{{selection}}`,
          tags: ["custom"],
        },
      ],
    }).catch(() => undefined)
    setQuery("")
    toast.show({ message: "Prompt created in prompts/custom", variant: "success" })
    reloadPrompts().catch(() => {})
  }

  function isExpanded(category: string) {
    if (query()) return true
    return expandedPrompt()[category] ?? true
  }

  function toggleCategory(category: string) {
    const map = expandedPrompt()
    const next = {
      ...map,
      [category]: !(map[category] ?? true),
    }
    setExpandedPrompt(() => next)
  }

  function updateRecent(id: string) {
    const next = [id, ...recent().filter((item: string) => item !== id)].slice(0, 10)
    setRecent(() => next)
  }

  function updateUsage(id: string) {
    const map = usage()
    setUsage(() => ({
      ...map,
      [id]: (map[id] ?? 0) + 1,
    }))
  }

  function toggleFavorite(id: string) {
    const ids = new Set(fav())
    if (ids.has(id)) ids.delete(id)
    else ids.add(id)
    const next = Array.from(ids) as string[]
    setFav(() => next)
  }

  async function duplicatePrompt(item: PromptItem) {
    const folder = await ensurePromptFolder(root()).catch(() => undefined)
    if (!folder) return
    const file = path.join(folder, "custom", `${item.id}-copy.json`)
    const next = {
      version: "1.0",
      category: item.category.toLowerCase().replaceAll(" ", "-"),
      categoryIcon: item.icon ?? "✨",
      prompts: [
        {
          id: `${item.id}-copy`,
          name: `${item.name} (Copy)`,
          description: item.description,
          template: item.template,
          tags: item.tags,
        },
      ],
    }
    await Filesystem.writeJson(file, next)
    toast.show({ message: "Prompt duplicated", variant: "success" })
    reloadPrompts().catch(() => {})
  }

  async function removePrompt(item: PromptItem) {
    const parsed = await Filesystem.readJson<PromptDoc>(item.file).catch(() => undefined)
    if (!parsed?.prompts?.length) return
    const next = parsed.prompts.filter((entry) => entry.id !== item.id)
    if (next.length === 0) {
      await rm(item.file, { force: true }).catch(() => {})
    } else {
      await Filesystem.writeJson(item.file, {
        ...parsed,
        prompts: next,
      })
    }
    toast.show({ message: "Prompt deleted", variant: "success" })
    reloadPrompts().catch(() => {})
  }

  async function executePrompt(item: PromptItem) {
    const model = local.model.current()
    if (!model) {
      toast.show({ message: "Connect a provider to run prompts", variant: "warning" })
      return
    }
    const selection = renderer.getSelection()?.getSelectedText() ?? ""
    const clipboard = (await Clipboard.read().catch(() => undefined))?.data ?? ""
    const text = renderTemplate(item.template, { selection, clipboard })

    await sdk.client.session
      .prompt({
        sessionID: props.sessionID,
        agent: local.agent.current().name,
        model,
        variant: local.model.variant.current(),
        messageID: Identifier.ascending("message"),
        parts: [
          {
            id: Identifier.ascending("part"),
            type: "text",
            text,
          },
        ],
      })
      .then(() => {
        updateRecent(item.id)
        updateUsage(item.id)
      })
      .catch(() => {
        toast.show({ message: "Failed to run prompt", variant: "error" })
      })
  }

  function promptMenu(item: PromptItem) {
    const favorite = fav().includes(item.id)
    dialog.replace(() => (
      <DialogSelect
        title={item.name}
        options={[
          {
            value: "run",
            title: "Execute",
            onSelect: () => executePrompt(item),
          },
          {
            value: "favorite",
            title: favorite ? "Remove Favorite" : "Add Favorite",
            onSelect: () => toggleFavorite(item.id),
          },
          {
            value: "copy",
            title: "Copy Template",
            onSelect: () => Clipboard.copy(item.template).catch(() => {}),
          },
          {
            value: "duplicate",
            title: "Duplicate",
            onSelect: () => duplicatePrompt(item),
          },
          {
            value: "delete",
            title: "Delete",
            onSelect: () => removePrompt(item),
            description: "Deletes from JSON file",
          },
        ]}
      />
    ))
  }

  useKeyboard((evt) => {
    if (!active()) return
    if (dialog.stack.length > 0) return
    if (evt.name === "/") {
      evt.preventDefault()
      search?.focus()
      return
    }
    if (evt.name === "escape") {
      if (!query()) return
      evt.preventDefault()
      setQuery("")
      return
    }
    if (evt.name === "up" || (evt.ctrl && evt.name === "p")) {
      evt.preventDefault()
      setSelected((value) => Math.max(0, value - 1))
      return
    }
    if (evt.name === "down" || (evt.ctrl && evt.name === "n")) {
      evt.preventDefault()
      setSelected((value) => Math.min(Math.max(ordered().length - 1, 0), value + 1))
      return
    }
    if (evt.name === "return") {
      const item = selectedPrompt()
      if (!item) return
      evt.preventDefault()
      executePrompt(item)
      return
    }
  })

  const hasProviders = createMemo(() =>
    sync.data.provider.some((x) => x.id !== "opencode" || Object.values(x.models).some((y) => y.cost?.input !== 0)),
  )
  const gettingStartedDismissed = createMemo(() => kv.get("dismissed_getting_started", false))

  return (
    <Show when={session()}>
      <box
        backgroundColor={theme.backgroundPanel}
        width={42}
        height="100%"
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
        position={props.overlay ? "absolute" : "relative"}
        onMouseMove={(evt: MouseEvent) => setSplitByMouse(evt)}
        onMouseUp={() => {
          setDragging(false)
          setDragY(undefined)
          setDragTop(undefined)
        }}
      >
        <scrollbox
          height={topHeight()}
          verticalScrollbarOptions={{
            trackOptions: {
              backgroundColor: theme.background,
              foregroundColor: theme.borderActive,
            },
          }}
        >
          <box flexShrink={0} gap={1} paddingRight={1}>
            <box paddingRight={1}>
              <text fg={theme.text}>
                <b>{session().title}</b>
              </text>
              <Show when={session().share?.url}>
                <text fg={theme.textMuted}>{session().share!.url}</text>
              </Show>
            </box>
            <box>
              <text fg={theme.text}>
                <b>Context</b>
              </text>
              <text fg={theme.textMuted}>{context()?.tokens ?? 0} tokens</text>
              <text fg={theme.textMuted}>{context()?.percentage ?? 0}% used</text>
              <text fg={theme.textMuted}>{cost()} spent</text>
            </box>
            <Show when={mcpEntries().length > 0}>
              <box>
                <box
                  flexDirection="row"
                  gap={1}
                  onMouseDown={() => mcpEntries().length > 2 && setExpanded("mcp", !expanded.mcp)}
                >
                  <Show when={mcpEntries().length > 2}>
                    <text fg={theme.text}>{expanded.mcp ? "▼" : "▶"}</text>
                  </Show>
                  <text fg={theme.text}>
                    <b>MCP</b>
                    <Show when={!expanded.mcp}>
                      <span style={{ fg: theme.textMuted }}>
                        {" "}
                        ({connectedMcpCount()} active
                        {errorMcpCount() > 0 ? `, ${errorMcpCount()} error${errorMcpCount() > 1 ? "s" : ""}` : ""})
                      </span>
                    </Show>
                  </text>
                </box>
                <Show when={mcpEntries().length <= 2 || expanded.mcp}>
                  <For each={mcpEntries()}>
                    {([key, item]) => (
                      <box flexDirection="row" gap={1}>
                        <text
                          flexShrink={0}
                          style={{
                            fg: (
                              {
                                connected: theme.success,
                                failed: theme.error,
                                disabled: theme.textMuted,
                                needs_auth: theme.warning,
                                needs_client_registration: theme.error,
                              } as Record<string, typeof theme.success>
                            )[item.status],
                          }}
                        >
                          •
                        </text>
                        <text fg={theme.text} wrapMode="word">
                          {key}{" "}
                          <span style={{ fg: theme.textMuted }}>
                            <Switch fallback={item.status}>
                              <Match when={item.status === "connected"}>Connected</Match>
                              <Match when={item.status === "failed" && item}>{(val) => <i>{val().error}</i>}</Match>
                              <Match when={item.status === "disabled"}>Disabled</Match>
                              <Match when={(item.status as string) === "needs_auth"}>Needs auth</Match>
                              <Match when={(item.status as string) === "needs_client_registration"}>
                                Needs client ID
                              </Match>
                            </Switch>
                          </span>
                        </text>
                      </box>
                    )}
                  </For>
                </Show>
              </box>
            </Show>
            <box>
              <box
                flexDirection="row"
                gap={1}
                onMouseDown={() => sync.data.lsp.length > 2 && setExpanded("lsp", !expanded.lsp)}
              >
                <Show when={sync.data.lsp.length > 2}>
                  <text fg={theme.text}>{expanded.lsp ? "▼" : "▶"}</text>
                </Show>
                <text fg={theme.text}>
                  <b>LSP</b>
                </text>
              </box>
              <Show when={sync.data.lsp.length <= 2 || expanded.lsp}>
                <Show when={sync.data.lsp.length === 0}>
                  <text fg={theme.textMuted}>
                    {sync.data.config.lsp === false
                      ? "LSPs have been disabled in settings"
                      : "LSPs will activate as files are read"}
                  </text>
                </Show>
                <For each={sync.data.lsp}>
                  {(item) => (
                    <box flexDirection="row" gap={1}>
                      <text
                        flexShrink={0}
                        style={{
                          fg: {
                            connected: theme.success,
                            error: theme.error,
                          }[item.status],
                        }}
                      >
                        •
                      </text>
                      <text fg={theme.textMuted}>
                        {item.id} {item.root}
                      </text>
                    </box>
                  )}
                </For>
              </Show>
            </box>
            <Show when={todo().length > 0 && todo().some((t) => t.status !== "completed")}>
              <box>
                <box
                  flexDirection="row"
                  gap={1}
                  onMouseDown={() => todo().length > 2 && setExpanded("todo", !expanded.todo)}
                >
                  <Show when={todo().length > 2}>
                    <text fg={theme.text}>{expanded.todo ? "▼" : "▶"}</text>
                  </Show>
                  <text fg={theme.text}>
                    <b>Todo</b>
                  </text>
                </box>
                <Show when={todo().length <= 2 || expanded.todo}>
                  <For each={todo()}>{(todo) => <TodoItem status={todo.status} content={todo.content} />}</For>
                </Show>
              </box>
            </Show>
            <Show when={diff().length > 0}>
              <box>
                <box
                  flexDirection="row"
                  gap={1}
                  onMouseDown={() => diff().length > 2 && setExpanded("diff", !expanded.diff)}
                >
                  <Show when={diff().length > 2}>
                    <text fg={theme.text}>{expanded.diff ? "▼" : "▶"}</text>
                  </Show>
                  <text fg={theme.text}>
                    <b>Modified Files</b>
                  </text>
                </box>
                <Show when={diff().length <= 2 || expanded.diff}>
                  <For each={diff() || []}>
                    {(item) => {
                      return (
                        <box flexDirection="row" gap={1} justifyContent="space-between">
                          <text fg={theme.textMuted} wrapMode="none">
                            {item.file}
                          </text>
                          <box flexDirection="row" gap={1} flexShrink={0}>
                            <Show when={item.additions}>
                              <text fg={theme.diffAdded}>+{item.additions}</text>
                            </Show>
                            <Show when={item.deletions}>
                              <text fg={theme.diffRemoved}>-{item.deletions}</text>
                            </Show>
                          </box>
                        </box>
                      )
                    }}
                  </For>
                </Show>
              </box>
            </Show>
          </box>
        </scrollbox>

        <box
          flexShrink={0}
          height={1}
          alignItems="center"
          justifyContent="center"
          backgroundColor={dragging() ? theme.primary : theme.border}
          onMouseDown={(evt: MouseEvent) => {
            setDragging(true)
            setDragY(evt.y)
            setDragTop(topHeight())
          }}
          onMouseUp={() => {
            setDragging(false)
            setDragY(undefined)
            setDragTop(undefined)
          }}
        >
          <text fg={dragging() ? theme.background : theme.textMuted}>{dragging() ? "════════════════════════════" : "────────────────────────────"}</text>
        </box>

        <box
          height={bottomHeight()}
          flexDirection="column"
          onMouseOver={() => setActive(true)}
          onMouseOut={() => setActive(false)}
        >
          <box flexShrink={0} paddingTop={1} paddingBottom={1} flexDirection="row" gap={1}>
            <input
              onInput={(value) => setQuery(value)}
              placeholder="Search prompts"
              focusedBackgroundColor={theme.backgroundElement}
              cursorColor={theme.primary}
              ref={(r: InputRenderable) => {
                search = r
              }}
            />
            <box
              backgroundColor={theme.backgroundElement}
              paddingLeft={1}
              paddingRight={1}
              onMouseUp={() => {
                createPromptFromQuery().catch(() => {})
              }}
            >
              <text fg={theme.text}>+</text>
            </box>
          </box>
          <scrollbox
            flexGrow={1}
            verticalScrollbarOptions={{
              trackOptions: {
                backgroundColor: theme.background,
                foregroundColor: theme.borderActive,
              },
            }}
          >
            <box gap={1} paddingRight={1}>
              <Show when={query() && filtered().length === 0}>
                <box
                  backgroundColor={theme.backgroundElement}
                  paddingLeft={1}
                  paddingRight={1}
                  paddingTop={1}
                  paddingBottom={1}
                  onMouseUp={() => {
                    createPromptFromQuery().catch(() => {})
                  }}
                >
                  <text fg={theme.textMuted}>No prompts found. Click to create "{query()}".</text>
                </box>
              </Show>

              <Show when={favoriteItems().length > 0}>
                <box>
                  <text fg={theme.text}>
                    <b>Favorites</b>
                  </text>
                  <For each={favoriteItems()}>
                    {(item) => (
                      <box
                        flexDirection="row"
                        backgroundColor={selectedPrompt()?.id === item.id ? theme.backgroundElement : undefined}
                        justifyContent="space-between"
                        onMouseUp={(evt: MouseEvent) => {
                          if (evt.button === MouseButton.RIGHT) return
                          const index = ordered().findIndex((entry) => entry.id === item.id)
                          if (index >= 0) setSelected(index)
                          executePrompt(item)
                        }}
                        onMouseDown={(evt: MouseEvent) => {
                          if (evt.button !== MouseButton.RIGHT) return
                          evt.preventDefault()
                          promptMenu(item)
                        }}
                      >
                        <text fg={theme.text}>★ {item.name}</text>
                        <Show when={(usage()[item.id] ?? 0) > 0}>
                          <text fg={theme.textMuted}>{usage()[item.id]}</text>
                        </Show>
                      </box>
                    )}
                  </For>
                </box>
              </Show>

              <Show when={recentItems().length > 0}>
                <box>
                  <text fg={theme.text}>
                    <b>Recent</b>
                  </text>
                  <For each={recentItems()}>
                    {(item) => (
                      <box
                        flexDirection="row"
                        backgroundColor={selectedPrompt()?.id === item.id ? theme.backgroundElement : undefined}
                        justifyContent="space-between"
                        onMouseUp={(evt: MouseEvent) => {
                          if (evt.button === MouseButton.RIGHT) return
                          const index = ordered().findIndex((entry) => entry.id === item.id)
                          if (index >= 0) setSelected(index)
                          executePrompt(item)
                        }}
                        onMouseDown={(evt: MouseEvent) => {
                          if (evt.button !== MouseButton.RIGHT) return
                          evt.preventDefault()
                          promptMenu(item)
                        }}
                      >
                        <text fg={theme.textMuted}>{item.name}</text>
                        <Show when={(usage()[item.id] ?? 0) > 0}>
                          <text fg={theme.textMuted}>{usage()[item.id]}</text>
                        </Show>
                      </box>
                    )}
                  </For>
                </box>
              </Show>

              <For each={grouped()}>
                {([name, items]) => (
                  <box>
                    <box
                      flexDirection="row"
                      gap={1}
                      onMouseUp={() => {
                        toggleCategory(name)
                      }}
                    >
                      <text fg={theme.text}>{isExpanded(name) ? "▼" : "▶"}</text>
                      <text fg={theme.text}>
                        <b>{items[0]?.icon ? `${items[0].icon} ` : ""}{name}</b>
                      </text>
                      <text fg={theme.textMuted}>({items.length})</text>
                    </box>
                    <Show when={isExpanded(name)}>
                      <For each={items}>
                        {(item) => (
                          <box
                            flexDirection="row"
                            backgroundColor={selectedPrompt()?.id === item.id ? theme.backgroundElement : undefined}
                            justifyContent="space-between"
                            onMouseUp={(evt: MouseEvent) => {
                              if (evt.button === MouseButton.RIGHT) return
                              const index = ordered().findIndex((entry) => entry.id === item.id)
                              if (index >= 0) setSelected(index)
                              executePrompt(item)
                            }}
                            onMouseDown={(evt: MouseEvent) => {
                              if (evt.button !== MouseButton.RIGHT) return
                              evt.preventDefault()
                              promptMenu(item)
                            }}
                          >
                            <text fg={theme.text}>• {item.name}</text>
                            <Show when={(usage()[item.id] ?? 0) > 0}>
                              <text fg={theme.textMuted}>{usage()[item.id]}</text>
                            </Show>
                          </box>
                        )}
                      </For>
                    </Show>
                  </box>
                )}
              </For>
            </box>
          </scrollbox>
          <box flexShrink={0} paddingTop={1}>
            <box
              backgroundColor={theme.backgroundElement}
              paddingLeft={1}
              paddingRight={1}
              onMouseUp={() => {
                openPromptFolder().catch(() => {})
              }}
            >
              <text fg={theme.text}>Customize prompts (open folder)</text>
            </box>
          </box>
        </box>

        <box flexShrink={0} gap={1} paddingTop={1}>
          <Show when={!hasProviders() && !gettingStartedDismissed()}>
            <box
              backgroundColor={theme.backgroundElement}
              paddingTop={1}
              paddingBottom={1}
              paddingLeft={2}
              paddingRight={2}
              flexDirection="row"
              gap={1}
            >
              <text flexShrink={0} fg={theme.text}>
                ⬖
              </text>
              <box flexGrow={1} gap={1}>
                <box flexDirection="row" justifyContent="space-between">
                  <text fg={theme.text}>
                    <b>Getting started</b>
                  </text>
                  <text fg={theme.textMuted} onMouseDown={() => kv.set("dismissed_getting_started", true)}>
                    ✕
                  </text>
                </box>
                <text fg={theme.textMuted}>OpenCode includes free models so you can start immediately.</text>
                <text fg={theme.textMuted}>
                  Connect from 75+ providers to use other models, including Claude, GPT, Gemini etc
                </text>
                <box flexDirection="row" gap={1} justifyContent="space-between">
                  <text fg={theme.text}>Connect provider</text>
                  <text fg={theme.textMuted}>/connect</text>
                </box>
              </box>
            </box>
          </Show>
          <text>
            <span style={{ fg: theme.textMuted }}>{directory().split("/").slice(0, -1).join("/")}/</span>
            <span style={{ fg: theme.text }}>{directory().split("/").at(-1)}</span>
          </text>
          <text fg={theme.textMuted}>
            <span style={{ fg: theme.success }}>•</span> <b>Open</b>
            <span style={{ fg: theme.text }}>
              <b>Code</b>
            </span>{" "}
            <span>{Installation.VERSION}</span>
          </text>
        </box>
      </box>
    </Show>
  )
}
