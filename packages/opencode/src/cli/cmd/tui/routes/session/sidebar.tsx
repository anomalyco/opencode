import { useSync } from "@tui/context/sync"
import { createEffect, createMemo, createSignal, For, Show, Switch, Match } from "solid-js"
import { createStore } from "solid-js/store"
import { useTheme } from "../../context/theme"
import path from "path"
import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import { Installation } from "@/installation"
import { useDirectory } from "../../context/directory"
import { useKV } from "../../context/kv"
import { DialogSelect } from "../../ui/dialog-select"
import { useDialog } from "../../ui/dialog"
import { MouseButton, type MouseEvent } from "@opentui/core"
import { useToast } from "../../ui/toast"
import open from "open"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { Clipboard } from "../../util/clipboard"
import { usePromptRef } from "../../context/prompt"
import { useLocal } from "../../context/local"

type CommandItem = {
  name: string
  title?: string
  template: string
  summary?: string
  description?: string
  category: string
  icon?: string
  tags: string[]
}

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

function leaf(name: string) {
  return name.split("/").filter(Boolean).at(-1) ?? name
}

function matchCommand(item: CommandItem, query: string) {
  if (!query) return true
  const q = query.toLowerCase()
  if (item.name.toLowerCase().includes(q)) return true
  if (leaf(item.name).toLowerCase().includes(q)) return true
  if (item.summary?.toLowerCase().includes(q)) return true
  if (item.description?.toLowerCase().includes(q)) return true
  if (item.category.toLowerCase().includes(q)) return true
  if (item.tags.some((tag) => tag.toLowerCase().includes(q))) return true
  return item.template.toLowerCase().includes(q)
}

function renderTemplate(template: string, input: { selection: string; clipboard: string }) {
  return template.replaceAll("{{selection}}", input.selection || "").replaceAll("{{clipboard}}", input.clipboard || "")
}

export function Sidebar(props: { sessionID: string; overlay?: boolean }) {
  const sync = useSync()
  const { theme } = useTheme()
  const session = createMemo(() => sync.session.get(props.sessionID)!)
  const diff = createMemo(() => sync.data.session_diff[props.sessionID] ?? [])
  const messages = createMemo(() => sync.data.message[props.sessionID] ?? [])

  const [expanded, setExpanded] = createStore({
    mcp: true,
    diff: true,
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
  const promptRef = usePromptRef()
  const toast = useToast()
  const renderer = useRenderer()
  const terminal = useTerminalDimensions()

  const [split, setSplit] = kv.signal("sidebar_library_split", 0.6)
  const [dragging, setDragging] = createSignal(false)
  const [dragY, setDragY] = createSignal<number>()
  const [dragTop, setDragTop] = createSignal<number>()
  const [query, setQuery] = createSignal("")
  const [active, setActive] = createSignal(false)
  const [selected, setSelected] = createSignal(0)
  const [mode, setMode] = kv.signal<"commands" | "agents">("library_mode", "commands")
  const [expandedCommand, setExpandedCommand] = kv.signal<Record<string, boolean>>("command_category_expanded", {})
  const [expandedAgent, setExpandedAgent] = kv.signal<Record<string, boolean>>("agent_category_expanded", {})
  const [fav, setFav] = kv.signal<string[]>("command_favorite", [])
  const [recent, setRecent] = kv.signal<string[]>("command_recent", [])
  const [usage, setUsage] = kv.signal<Record<string, number>>("command_usage", {})

  const root = createMemo(() => sync.data.path.directory || process.cwd())

  const commands = createMemo<CommandItem[]>(() =>
    sync.data.command
      .filter((item): item is typeof item & { template: string } => typeof item?.template === "string")
      .map((item) => ({
        name: item.name,
        title: (item as any).title,
        summary: (item as any).summary,
        description: item.description,
        category: normalizeCategory((item as any).category),
        icon: (item as any).icon,
        template: item.template,
        tags: ((item as any).tags ?? []) as string[],
      })),
  )

  const agents = createMemo(() =>
    sync.data.agent
      .filter((item) => item.mode !== "subagent" && !item.hidden)
      .map((item) => ({
        name: item.name,
        title: (item as any).title,
        summary: (item as any).summary,
        description: item.description,
        category: normalizeCategory((item as any).category),
        icon: (item as any).icon,
        tags: ((item as any).tags ?? []) as string[],
      })),
  )

  const filtered = createMemo(() => commands().filter((item) => matchCommand(item, query())))
  const grouped = createMemo(() => {
    const map = new Map<string, CommandItem[]>()
    for (const item of filtered()) {
      const arr = map.get(item.category) ?? []
      arr.push(item)
      map.set(item.category, arr)
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  })
  const ordered = createMemo(() =>
    filtered().toSorted((a, b) => {
      const category = a.category.localeCompare(b.category)
      if (category !== 0) return category
      return leaf(a.name).localeCompare(leaf(b.name))
    }),
  )

  const selectedCommand = createMemo(() => ordered()[selected()])
  const agentFiltered = createMemo(() => {
    const q = query().trim().toLowerCase()
    if (!q) return agents()
    return agents().filter((item) => {
      if (item.name.toLowerCase().includes(q)) return true
      if (leaf(item.name).toLowerCase().includes(q)) return true
      if (item.summary?.toLowerCase().includes(q)) return true
      if (item.description?.toLowerCase().includes(q)) return true
      if (item.category.toLowerCase().includes(q)) return true
      return item.tags.some((tag) => tag.toLowerCase().includes(q))
    })
  })
  const agentGrouped = createMemo(() => {
    const map = new Map<string, ReturnType<typeof agents>[number][]>()
    for (const item of agentFiltered()) {
      const arr = map.get(item.category) ?? []
      arr.push(item)
      map.set(item.category, arr)
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  })
  const agentOrdered = createMemo(() =>
    agentFiltered().toSorted((a, b) => {
      const category = a.category.localeCompare(b.category)
      if (category !== 0) return category
      return leaf(a.name).localeCompare(leaf(b.name))
    }),
  )

  createEffect(() => {
    const max = (mode() === "commands" ? ordered() : agentOrdered()).length - 1
    if (max < 0) {
      setSelected(0)
      return
    }
    if (selected() > max) setSelected(max)
  })

  const favoriteItems = createMemo(() => {
    const ids = new Set(fav())
    return filtered().filter((item) => ids.has(item.name))
  })

  const recentItems = createMemo(() => {
    const items = new Map(commands().map((item) => [item.name, item]))
    return recent()
      .map((id: string) => items.get(id))
      .filter((item: CommandItem | undefined): item is CommandItem => !!item)
      .filter((item: CommandItem) => matchCommand(item, query()))
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

  async function openLibraryFolder() {
    const folder = path.join(root(), ".opencode", mode() === "commands" ? "command" : "agent")
    await open(folder).catch(() => {
      toast.show({ message: `Failed to open ${mode() === "commands" ? "command" : "agent"} folder`, variant: "error" })
    })
  }

  function isExpanded(category: string) {
    if (query()) return true
    return (mode() === "commands" ? expandedCommand() : expandedAgent())[category] ?? true
  }

  function toggleCategory(category: string) {
    const map = mode() === "commands" ? expandedCommand() : expandedAgent()
    const next = {
      ...map,
      [category]: !(map[category] ?? true),
    }
    if (mode() === "commands") setExpandedCommand(() => next)
    else setExpandedAgent(() => next)
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

  async function insertCommand(item: CommandItem) {
    const prompt = promptRef.current
    if (!prompt) {
      toast.show({ message: "Composer input is unavailable", variant: "error" })
      return
    }
    const selection = renderer.getSelection()?.getSelectedText() ?? ""
    const clipboard = (await Clipboard.read().catch(() => undefined))?.data ?? ""
    const text = renderTemplate(item.template, { selection, clipboard })
    prompt.set({ input: text, parts: [] })
    prompt.focus()
    updateRecent(item.name)
    updateUsage(item.name)
  }

  function commandMenu(item: CommandItem) {
    const favorite = fav().includes(item.name)
    dialog.replace(() => (
      <DialogSelect
        title={leaf(item.name)}
        options={[
          {
            value: "run",
            title: "Insert Command",
            onSelect: () => insertCommand(item),
          },
          {
            value: "favorite",
            title: favorite ? "Remove Favorite" : "Add Favorite",
            onSelect: () => toggleFavorite(item.name),
          },
          {
            value: "copy",
            title: "Copy Template",
            onSelect: () => Clipboard.copy(item.template).catch(() => {}),
          },
        ]}
      />
    ))
  }

  function openLibrarySearch() {
    dialog.replace(() => (
      <DialogSelect
        title={mode() === "commands" ? "Command Search" : "Agent Search"}
        options={(mode() === "commands" ? commands() : agents()).map((item) => ({
          value: item.name,
          title: leaf(item.name),
          description: item.summary ?? item.description,
          category: item.category,
          onSelect: () => (mode() === "commands" ? insertCommand(item as CommandItem) : local.agent.set(item.name)),
        }))}
      />
    ))
  }

  useKeyboard((evt) => {
    if (!active()) return
    if (dialog.stack.length > 0) return
    if (evt.name === "/") {
      evt.preventDefault()
      openLibrarySearch()
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
      const item = selectedCommand()
      if (!item) return
      evt.preventDefault()
      insertCommand(item)
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
                openLibrarySearch()
              }}
            >
              <text fg={theme.textMuted}>Search {mode() === "commands" ? "commands" : "agents"} (/)</text>
            </box>
            <box
              backgroundColor={theme.backgroundElement}
              paddingLeft={1}
              paddingRight={1}
              onMouseUp={() => setMode((x) => (x === "commands" ? "agents" : "commands"))}
            >
              <text fg={theme.textMuted}>{mode() === "commands" ? "Commands" : "Agents"}</text>
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
              <Show when={query() && mode() === "commands" && filtered().length === 0}>
                <box
                  backgroundColor={theme.backgroundElement}
                  paddingLeft={1}
                  paddingRight={1}
                  paddingTop={1}
                  paddingBottom={1}
                >
                  <text fg={theme.textMuted}>No commands found.</text>
                </box>
              </Show>
              <Show when={query() && mode() === "agents" && agentFiltered().length === 0}>
                <box
                  backgroundColor={theme.backgroundElement}
                  paddingLeft={1}
                  paddingRight={1}
                  paddingTop={1}
                  paddingBottom={1}
                >
                  <text fg={theme.textMuted}>No agents found.</text>
                </box>
              </Show>

              <Show when={mode() === "commands" && favoriteItems().length > 0}>
                <box>
                  <text fg={theme.text}>
                    <b>Favorites</b>
                  </text>
                  <For each={favoriteItems()}>
                    {(item) => (
                      <box
                        flexDirection="row"
                        backgroundColor={selectedCommand()?.name === item.name ? theme.backgroundElement : undefined}
                        justifyContent="space-between"
                        onMouseUp={(evt: MouseEvent) => {
                          if (evt.button === MouseButton.RIGHT) return
                          const index = ordered().findIndex((entry) => entry.name === item.name)
                          if (index >= 0) setSelected(index)
                          insertCommand(item)
                        }}
                        onMouseDown={(evt: MouseEvent) => {
                          if (evt.button !== MouseButton.RIGHT) return
                          evt.preventDefault()
                          commandMenu(item)
                        }}
                      >
                        <box flexDirection="column" flexGrow={1}>
                          <text fg={theme.text}>★ {item.title ?? leaf(item.name)}</text>
                          <Show when={item.summary ?? item.description}>
                            <text fg={theme.textMuted}>{item.summary ?? item.description}</text>
                          </Show>
                        </box>
                        <Show when={(usage()[item.name] ?? 0) > 0}>
                          <text fg={theme.textMuted}>{usage()[item.name]}</text>
                        </Show>
                      </box>
                    )}
                  </For>
                </box>
              </Show>

              <Show when={mode() === "commands" && recentItems().length > 0}>
                <box>
                  <text fg={theme.text}>
                    <b>Recent</b>
                  </text>
                  <For each={recentItems()}>
                    {(item) => (
                      <box
                        flexDirection="row"
                        backgroundColor={selectedCommand()?.name === item.name ? theme.backgroundElement : undefined}
                        justifyContent="space-between"
                        onMouseUp={(evt: MouseEvent) => {
                          if (evt.button === MouseButton.RIGHT) return
                          const index = ordered().findIndex((entry) => entry.name === item.name)
                          if (index >= 0) setSelected(index)
                          insertCommand(item)
                        }}
                        onMouseDown={(evt: MouseEvent) => {
                          if (evt.button !== MouseButton.RIGHT) return
                          evt.preventDefault()
                          commandMenu(item)
                        }}
                      >
                        <box flexDirection="column" flexGrow={1}>
                          <text fg={theme.textMuted}>{item.title ?? leaf(item.name)}</text>
                          <Show when={item.summary ?? item.description}>
                            <text fg={theme.textMuted}>{item.summary ?? item.description}</text>
                          </Show>
                        </box>
                        <Show when={(usage()[item.name] ?? 0) > 0}>
                          <text fg={theme.textMuted}>{usage()[item.name]}</text>
                        </Show>
                      </box>
                    )}
                  </For>
                </box>
              </Show>

              <Show when={mode() === "commands"}>
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
                              backgroundColor={
                                selectedCommand()?.name === item.name ? theme.backgroundElement : undefined
                              }
                              justifyContent="space-between"
                              onMouseUp={(evt: MouseEvent) => {
                                if (evt.button === MouseButton.RIGHT) return
                                const index = ordered().findIndex((entry) => entry.name === item.name)
                                if (index >= 0) setSelected(index)
                                insertCommand(item)
                              }}
                              onMouseDown={(evt: MouseEvent) => {
                                if (evt.button !== MouseButton.RIGHT) return
                                evt.preventDefault()
                                commandMenu(item)
                              }}
                            >
                              <box flexDirection="column" flexGrow={1}>
                                <text fg={theme.text}>• {item.title ?? leaf(item.name)}</text>
                                <Show when={item.summary ?? item.description}>
                                  <text fg={theme.textMuted}>{item.summary ?? item.description}</text>
                                </Show>
                              </box>
                              <Show when={(usage()[item.name] ?? 0) > 0}>
                                <text fg={theme.textMuted}>{usage()[item.name]}</text>
                              </Show>
                            </box>
                          )}
                        </For>
                      </Show>
                    </box>
                  )}
                </For>
              </Show>

              <Show when={mode() === "agents"}>
                <For each={agentGrouped()}>
                  {([name, items]) => (
                    <box>
                      <box flexDirection="row" gap={1} onMouseUp={() => toggleCategory(name)}>
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
                              justifyContent="space-between"
                              onMouseUp={(evt: MouseEvent) => {
                                if (evt.button === MouseButton.RIGHT) return
                                local.agent.set(item.name)
                              }}
                            >
                              <box flexDirection="column" flexGrow={1}>
                                <text fg={theme.text}>• {item.title ?? leaf(item.name)}</text>
                                <Show when={item.summary ?? item.description}>
                                  <text fg={theme.textMuted}>{item.summary ?? item.description}</text>
                                </Show>
                              </box>
                              <Show when={local.agent.current().name === item.name}>
                                <text fg={theme.success}>active</text>
                              </Show>
                            </box>
                          )}
                        </For>
                      </Show>
                    </box>
                  )}
                </For>
              </Show>
            </box>
          </scrollbox>
          <box flexShrink={0} paddingTop={1}>
            <box
              backgroundColor={theme.backgroundElement}
              paddingLeft={1}
              paddingRight={1}
              onMouseUp={() => {
                openLibraryFolder().catch(() => {})
              }}
            >
              <text fg={theme.text}>Open {mode() === "commands" ? "commands" : "agents"} folder</text>
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
