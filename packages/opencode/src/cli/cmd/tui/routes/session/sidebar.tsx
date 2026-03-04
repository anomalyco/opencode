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
import { MouseButton, type MouseEvent } from "@opentui/core"
import { useToast } from "../../ui/toast"
import { Filesystem } from "@/util/filesystem"
import { Glob } from "@/util/glob"
import open from "open"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { Clipboard } from "../../util/clipboard"
import { rm } from "fs/promises"
import { usePromptRef } from "../../context/prompt"

type PromptDoc = {
  version?: string
  category?: string
  categoryIcon?: string
  prompts?: {
    id: string
    name: string
    summary?: string
    description?: string
    template: string
    tags?: string[]
  }[]
}

type PromptItem = {
  id: string
  name: string
  summary?: string
  description?: string
  category: string
  icon?: string
  template: string
  tags: string[]
  file: string
}

const FALLBACK_PACKS: PromptDoc[] = [
  {
    version: "2.0",
    category: "code-review",
    categoryIcon: "🔍",
    prompts: [
      {
        id: "quick-code-review",
        name: "Quick Code Review",
        summary: "Fast, high-signal review with prioritized fixes",
        template:
          "Act as a senior reviewer. Do a fast, risk-focused review of the code I am currently working on.\n\nOutput:\n1) Verdict\n2) Critical findings\n3) Quick wins\n4) Suggested patches\n5) What looks good",
        tags: ["review", "quality", "fast"],
      },
      {
        id: "deep-code-review",
        name: "Deep Code Review",
        summary: "Thorough review for correctness and design",
        template:
          "Perform a deep review of the code I am currently working on as if it is production-critical. Evaluate correctness, edge cases, API design, maintainability, and testing gaps.",
        tags: ["review", "architecture", "quality"],
      },
    ],
  },
  {
    version: "2.0",
    category: "engineering",
    categoryIcon: "🛠",
    prompts: [
      {
        id: "bug-root-cause",
        name: "Root Cause Analysis",
        summary: "Reproduce, isolate, and propose a safe fix",
        template:
          "Help debug the issue I am currently working on with a root-cause-first approach.\n\nOutput:\n1) Most likely cause\n2) Alternate hypotheses\n3) Minimal repro\n4) Safe fix plan\n5) Regression tests",
        tags: ["debug", "rca", "incident"],
      },
      {
        id: "implementation-plan",
        name: "Implementation Plan",
        summary: "Turn a goal into an executable plan",
        template:
          "Create an implementation plan for the feature I am currently working on, including constraints, phased execution, validation, and rollback strategy.",
        tags: ["planning", "implementation", "architecture"],
      },
    ],
  },
  {
    version: "2.0",
    category: "qa",
    categoryIcon: "🧪",
    prompts: [
      {
        id: "qa-test-strategy",
        name: "Test Strategy",
        summary: "Design layered tests by risk and confidence",
        template:
          "Design a practical test strategy for the changes I am currently working on. Include risk map, unit/integration/e2e scope, and release exit criteria.",
        tags: ["qa", "testing", "strategy"],
      },
      {
        id: "qa-regression-matrix",
        name: "Regression Matrix",
        summary: "Build a concise matrix of what can break",
        template:
          "Create a regression matrix for my current changes with user journeys, environments, state transitions, negative paths, and must-pass smoke checks.",
        tags: ["qa", "regression", "matrix"],
      },
    ],
  },
  {
    version: "2.0",
    category: "troubleshooting",
    categoryIcon: "🧭",
    prompts: [
      {
        id: "incident-triage",
        name: "Incident Triage",
        summary: "Prioritize impact and stabilize quickly",
        template:
          "Help me triage an active issue quickly and safely. Include blast radius, immediate actions, next investigations, and communication draft.",
        tags: ["incident", "triage", "operations"],
      },
      {
        id: "postmortem-draft",
        name: "Postmortem Draft",
        summary: "Create a blameless incident postmortem",
        template:
          "Draft a blameless postmortem for a resolved issue including timeline, contributing factors, and concrete follow-up actions.",
        tags: ["postmortem", "incident", "learning"],
      },
    ],
  },
  {
    version: "2.0",
    category: "performance",
    categoryIcon: "⚡",
    prompts: [
      {
        id: "performance-triage",
        name: "Performance Triage",
        summary: "Find likely bottlenecks and prioritize fixes",
        template:
          "Review the code I am currently working on for performance bottlenecks. Provide top bottlenecks, quick wins, structural improvements, and measurement plan.",
        tags: ["performance", "profiling", "optimization"],
      },
    ],
  },
  {
    version: "2.0",
    category: "web-design",
    categoryIcon: "🎨",
    prompts: [
      {
        id: "ui-critique",
        name: "UI Critique",
        summary: "Evaluate hierarchy and interaction clarity",
        template:
          "Review the UI I am currently building. Identify clarity issues, interaction friction, and highest-impact design improvements.",
        tags: ["ui", "design", "ux"],
      },
    ],
  },
  {
    version: "2.0",
    category: "documentation",
    categoryIcon: "📝",
    prompts: [
      {
        id: "doc-architecture-overview",
        name: "Architecture Overview",
        summary: "Write a clear system architecture narrative",
        template:
          "Draft an architecture overview for the code I am currently working on, covering boundaries, components, flows, tradeoffs, and known limits.",
        tags: ["docs", "architecture", "overview"],
      },
    ],
  },
  {
    version: "2.0",
    category: "delivery",
    categoryIcon: "🚀",
    prompts: [
      {
        id: "pr-summary",
        name: "PR Summary",
        summary: "Produce a reviewer-friendly pull request description",
        template:
          "Draft a PR description with sections: Why, What changed, How to review, Validation, Risks, and Rollout/follow-ups.",
        tags: ["git", "pr", "communication"],
      },
      {
        id: "release-risk-checklist",
        name: "Release Risk Checklist",
        summary: "Pre-merge and pre-release risk gate",
        template: "Build a release readiness checklist for my current work grouped by Must/Should/Nice-to-have.",
        tags: ["release", "risk", "checklist"],
      },
    ],
  },
]

function normalizeCategory(text?: string) {
  if (!text) return "General"
  if (text.toLowerCase() === "qa") return "QA"
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
  if (item.summary?.toLowerCase().includes(q)) return true
  if (item.description?.toLowerCase().includes(q)) return true
  if (item.category.toLowerCase().includes(q)) return true
  if (item.tags.some((tag) => tag.toLowerCase().includes(q))) return true
  return item.template.toLowerCase().includes(q)
}

function builtInPromptItems() {
  return FALLBACK_PACKS.flatMap((pack) =>
    (pack.prompts ?? []).map((item) => ({
      id: item.id,
      name: item.name,
      summary: item.summary ?? item.description,
      description: item.description,
      category: normalizeCategory(pack.category),
      icon: pack.categoryIcon,
      template: item.template,
      tags: item.tags ?? [],
      file: "builtin",
    })),
  )
}

async function ensurePromptFolder(directory: string) {
  const root = path.join(directory, ".opencode", "prompts")
  const custom = path.join(root, "custom")
  const gitignore = path.join(directory, ".opencode", ".gitignore")
  await Filesystem.write(path.join(custom, ".keep"), "")
  const ignored = await Filesystem.readText(gitignore).catch(() => "")
  const hasIgnore = ignored.includes("prompts/custom/*") && ignored.includes("!prompts/custom/.gitkeep")
  if (!hasIgnore) {
    const lines = ignored
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
    if (!lines.includes("prompts/custom/*")) lines.push("prompts/custom/*")
    if (!lines.includes("!prompts/custom/.gitkeep")) lines.push("!prompts/custom/.gitkeep")
    await Filesystem.write(gitignore, lines.join("\n") + "\n")
  }
  return root
}

async function findPromptRoots(directory: string) {
  const roots = await Filesystem.findUp(path.join(".opencode", "prompts"), directory)
  return roots
}

async function readPromptFolder(directory: string) {
  const roots = await findPromptRoots(directory)
  if (roots.length === 0) return [] as PromptItem[]

  const files = (
    await Promise.all(roots.map((cwd) => Glob.scan("**/*.json", { cwd, absolute: true, dot: true })))
  ).flat()

  const uniqueFiles = Array.from(new Set(files))
  const result = (
    await Promise.all(
      uniqueFiles.map(async (file) => {
        const parsed = await Filesystem.readJson<PromptDoc>(file).catch(() => undefined)
        if (!parsed?.prompts?.length) return [] as PromptItem[]
        return parsed.prompts
          .filter((item) => item.id && item.name && item.template)
          .map((item) => ({
            id: item.id,
            name: item.name,
            summary: item.summary ?? item.description,
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

async function resolvePromptRoot(directory: string) {
  const roots = await findPromptRoots(directory)
  if (roots.length > 0) return roots[roots.length - 1]!
  return ensurePromptFolder(directory)
}

function renderTemplate(template: string, input: { selection: string; clipboard: string }) {
  return template.replaceAll("{{selection}}", input.selection || "").replaceAll("{{clipboard}}", input.clipboard || "")
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
  const promptRef = usePromptRef()
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

  const root = createMemo(() => sync.data.path.directory || process.cwd())

  async function reloadPrompts() {
    const user = await readPromptFolder(root()).catch(() => [] as PromptItem[])
    const legacy = user.length > 0 && user.every((item) => item.category === "Starter")
    setPrompts(user.length > 0 && !legacy ? user : builtInPromptItems())
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
    const folder = await resolvePromptRoot(root()).catch(() => undefined)
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
    const folder = await resolvePromptRoot(root()).catch(() => undefined)
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
          summary: "Custom prompt",
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
    const folder = await resolvePromptRoot(root()).catch(() => undefined)
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
          summary: item.summary ?? item.description,
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
    const prompt = promptRef.current
    if (!prompt) {
      toast.show({ message: "Prompt input is unavailable", variant: "error" })
      return
    }
    const selection = renderer.getSelection()?.getSelectedText() ?? ""
    const clipboard = (await Clipboard.read().catch(() => undefined))?.data ?? ""
    const text = renderTemplate(item.template, { selection, clipboard })
    prompt.set({ input: text, parts: [] })
    prompt.focus()
    updateRecent(item.id)
    updateUsage(item.id)
  }

  function promptMenu(item: PromptItem) {
    const favorite = fav().includes(item.id)
    dialog.replace(() => (
      <DialogSelect
        title={item.name}
        options={[
          {
            value: "run",
            title: "Insert into Prompt",
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

  function openPromptSearch() {
    dialog.replace(() => (
      <DialogSelect
        title="Prompt Search"
        options={prompts().map((item) => ({
          value: item.id,
          title: item.name,
          description: item.summary ?? item.description,
          category: item.category,
          onSelect: () => executePrompt(item),
        }))}
      />
    ))
  }

  useKeyboard((evt) => {
    if (!active()) return
    if (dialog.stack.length > 0) return
    if (evt.name === "/") {
      evt.preventDefault()
      openPromptSearch()
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
      setSelected((x) => Math.max(0, x - 1))
      return
    }
    if (evt.name === "down" || (evt.ctrl && evt.name === "n")) {
      evt.preventDefault()
      setSelected((x) => Math.min(Math.max(ordered().length - 1, 0), x + 1))
      return
    }
    if (evt.name === "return") {
      const item = selectedPrompt()
      if (!item) return
      evt.preventDefault()
      executePrompt(item)
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
          <text fg={dragging() ? theme.background : theme.textMuted}>
            {dragging() ? "════════════════════════════" : "────────────────────────────"}
          </text>
        </box>

        <box
          height={bottomHeight()}
          flexDirection="column"
          onMouseOver={() => setActive(true)}
          onMouseOut={() => setActive(false)}
        >
          <box flexShrink={0} paddingTop={1} paddingBottom={1} flexDirection="row" gap={1}>
            <box
              flexGrow={1}
              backgroundColor={theme.backgroundElement}
              paddingLeft={1}
              paddingRight={1}
              onMouseUp={() => {
                openPromptSearch()
              }}
            >
              <text fg={theme.textMuted}>Search prompts (/)</text>
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
                        <box flexDirection="column" flexGrow={1}>
                          <text fg={theme.text}>★ {item.name}</text>
                          <Show when={item.summary ?? item.description}>
                            <text fg={theme.textMuted}>{item.summary ?? item.description}</text>
                          </Show>
                        </box>
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
                        <box flexDirection="column" flexGrow={1}>
                          <text fg={theme.textMuted}>{item.name}</text>
                          <Show when={item.summary ?? item.description}>
                            <text fg={theme.textMuted}>{item.summary ?? item.description}</text>
                          </Show>
                        </box>
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
                        <b>
                          {items[0]?.icon ? `${items[0].icon} ` : ""}
                          {name}
                        </b>
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
                            <box flexDirection="column" flexGrow={1}>
                              <text fg={theme.text}>• {item.name}</text>
                              <Show when={item.summary ?? item.description}>
                                <text fg={theme.textMuted}>{item.summary ?? item.description}</text>
                              </Show>
                            </box>
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
