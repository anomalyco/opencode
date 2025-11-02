import { useSync } from "@tui/context/sync"
import { createMemo, createSignal, For, Show, Switch, Match } from "solid-js"
import { useTheme } from "../../context/theme"
import { Locale } from "@/util/locale"
import path from "path"
import type { AssistantMessage } from "@opencode-ai/sdk"
import { TextAttributes } from "@opentui/core"
import { ContextUsageBar } from "../../component/context-usage-bar"
import { useLocal } from "../../context/local"
import { useKeyboard, useRenderer } from "@opentui/solid"
import { $ } from "bun"
type TabType = "files" | "todos" | "tools"

export function Sidebar(props: { sessionID: string; onToggle: () => void }) {
  const sync = useSync()
  const { theme } = useTheme()
  const local = useLocal()
  const renderer = useRenderer()
  const [activeTab, setActiveTab] = createSignal<TabType>("tools")
  const [expandedMcpServers, setExpandedMcpServers] = createSignal<Set<string>>(new Set())
  const [mcpTools, setMcpTools] = createSignal<Record<string, Record<string, any>>>({})
  const [selectedFiles, setSelectedFiles] = createSignal<Set<string>>(new Set())
  const [commitMessage, setCommitMessage] = createSignal("")
  const [isCommitting, setIsCommitting] = createSignal(false)
  const [committedFiles, setCommittedFiles] = createSignal<Set<string>>(new Set())
  const session = createMemo(() => sync.session.get(props.sessionID)!)
  const todo = createMemo(() => sync.data.todo[props.sessionID] ?? [])
  const messages = createMemo(() => sync.data.message[props.sessionID] ?? [])

  // Check which files are committed
  const checkCommittedFiles = async () => {
    try {
      const diffs = session().summary?.diffs || []
      if (diffs.length === 0) return

      const { $ } = await import("bun")
      const result = await $`git status --short`.text().catch(() => "")
      const uncommittedSet = new Set(
        result
          .split("\n")
          .filter(Boolean)
          .map((line) => line.substring(3).trim()),
      )

      const committed = new Set<string>()
      for (const diff of diffs) {
        if (!uncommittedSet.has(diff.file)) {
          committed.add(diff.file)
        }
      }
      setCommittedFiles(committed)
    } catch (error) {
      console.error("Failed to check git status", error)
    }
  }

  // Check committed files when tab switches to files
  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab)
    if (tab === "files") {
      checkCommittedFiles()
    }
  }

  const uncommittedFiles = createMemo(() => {
    const diffs = session().summary?.diffs || []
    return diffs.filter((d) => !committedFiles().has(d.file))
  })

  // Add keyboard shortcuts for tab switching
  useKeyboard((evt) => {
    if (evt.name === "1") handleTabChange("tools")
    if (evt.name === "2") handleTabChange("todos")
    if (evt.name === "3") handleTabChange("files")
  })

  // Track tools used in this session
  const toolsUsed = createMemo(() => {
    const toolCounts: Record<string, number> = {}

    // Get all parts for messages in this session
    messages().forEach((msg) => {
      const parts = sync.data.part[msg.id] || []
      parts.forEach((part) => {
        if (part.type === "tool" && part.state?.status === "completed") {
          const toolName = part.tool
          toolCounts[toolName] = (toolCounts[toolName] || 0) + 1
        }
      })
    })

    return Object.entries(toolCounts)
      .sort((a, b) => b[1] - a[1]) // Sort by usage count
      .slice(0, 10) // Top 10
  })

  async function handleCommit() {
    if (selectedFiles().size === 0 || !commitMessage() || isCommitting()) return
    setIsCommitting(true)
    try {
      const files = Array.from(selectedFiles())
      const gitAdd = files.map((f) => `git add "${f}"`).join(" && ")
      const gitCommit = `git commit -m "${commitMessage().replace(/"/g, '\\"')}"`
      const command = `${gitAdd} && ${gitCommit}`

      const response = await fetch("http://localhost:4096/bash/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command, description: "Commit changes" }),
      })

      if (response.ok) {
        setSelectedFiles(new Set<string>())
        setCommitMessage("")
      }
    } catch (error) {
      console.error("Commit failed:", error)
    } finally {
      setIsCommitting(false)
    }
  }

  async function toggleMcpServer(serverName: string) {
    const expanded = expandedMcpServers()
    const newExpanded = new Set(expanded)

    if (expanded.has(serverName)) {
      newExpanded.delete(serverName)
    } else {
      newExpanded.add(serverName)
      // Load tools if not already loaded
      if (!mcpTools()[serverName]) {
        try {
          const response = await fetch(
            `http://localhost:4096/mcp/${encodeURIComponent(serverName)}/tools`,
          )
          if (response.ok) {
            const tools = await response.json()
            setMcpTools((prev) => ({ ...prev, [serverName]: tools }))
          }
        } catch (error) {
          console.error(`Failed to load tools for ${serverName}:`, error)
          setMcpTools((prev) => ({ ...prev, [serverName]: {} }))
        }
      }
    }

    setExpandedMcpServers(newExpanded)
  }

  const cost = createMemo(() => {
    const total = messages().reduce((sum, x) => sum + (x.role === "assistant" ? x.cost : 0), 0)
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(total)
  })

  const context = createMemo(() => {
    const last = messages().findLast(
      (x) => x.role === "assistant" && x.tokens.output > 0,
    ) as AssistantMessage
    if (!last) return { tokens: 0, tokenLimit: 0, tokensFormatted: "0", percentage: 0 }

    const total =
      last.tokens.input +
      last.tokens.output +
      last.tokens.reasoning +
      last.tokens.cache.read +
      last.tokens.cache.write
    const model = sync.data.provider.find((x) => x.id === last.providerID)?.models[last.modelID]
    const tokenLimit = model?.limit.context || 0

    return {
      tokens: total,
      tokenLimit,
      tokensFormatted: total.toLocaleString(),
      percentage: tokenLimit ? Math.round((total / tokenLimit) * 100) : 0,
    }
  })

  return (
    <Show when={session()}>
      <box flexShrink={0} gap={1} width={40}>
        <box flexDirection="row" justifyContent="space-between" paddingRight={1}>
          <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
            CODESURF
          </text>
          <text
            fg={theme.textMuted}
            onMouseUp={() => {
              if (renderer.getSelection()?.getSelectedText()) return
              props.onToggle()
            }}
          >
            ▶
          </text>
        </box>
        <box>
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
          <ContextUsageBar
            currentTokens={context().tokens}
            tokenLimit={context().tokenLimit}
            agentColor={local.agent.color("assistant")}
            assistantColor={theme.primary}
            toolColor={theme.accent}
            userColor={theme.secondary}
            backgroundColor={theme.backgroundPanel}
            width={40}
          />
          <text fg={theme.textMuted}>{context().tokensFormatted} tokens</text>
          <text fg={theme.textMuted}>{context().percentage}% used</text>
          <text fg={theme.textMuted}>{cost()} spent</text>
        </box>

        {/* Tab Navigation */}
        <box flexDirection="row" gap={2}>
          <text
            style={{
              fg: activeTab() === "tools" ? theme.accent : theme.textMuted,
              attributes: activeTab() === "tools" ? TextAttributes.BOLD : undefined,
            }}
            onMouseUp={() => handleTabChange("tools")}
          >
            {activeTab() === "tools" ? "●" : "○"} Tools(
            {toolsUsed().length + Object.keys(sync.data.mcp).length + sync.data.lsp.length})
          </text>
          <text
            style={{
              fg: activeTab() === "todos" ? theme.accent : theme.textMuted,
              attributes: activeTab() === "todos" ? TextAttributes.BOLD : undefined,
            }}
            onMouseUp={() => handleTabChange("todos")}
          >
            {activeTab() === "todos" ? "●" : "○"} Todos({todo().length})
          </text>
          <text
            style={{
              fg: activeTab() === "files" ? theme.accent : theme.textMuted,
              attributes: activeTab() === "files" ? TextAttributes.BOLD : undefined,
            }}
            onMouseUp={() => handleTabChange("files")}
          >
            {activeTab() === "files" ? "●" : "○"} Files({session().summary?.diffs?.length || 0})
          </text>
        </box>

        {/* Tab Content */}
        <Show when={activeTab() === "tools"}>
          <Show when={toolsUsed().length > 0}>
            <box marginTop={0}>
              <text>
                <b>Tools Used</b>
              </text>
              <For each={toolsUsed()}>
                {([toolName, count]) => {
                  const isClaudeCode = toolName.startsWith("cc_")
                  return (
                    <box flexDirection="row" gap={1} justifyContent="space-between">
                      <text fg={isClaudeCode ? theme.accent : theme.text}>
                        {isClaudeCode ? "⚡" : "⚙"} {toolName}
                      </text>
                      <text fg={theme.textMuted}>×{count}</text>
                    </box>
                  )
                }}
              </For>
            </box>
          </Show>
          <Show when={sync.data.lsp.length > 0}>
            <box marginTop={0}>
              <text>
                <b>LSP</b>
              </text>
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
            </box>
          </Show>
          <Show when={Object.keys(sync.data.mcp).length > 0}>
            <box marginTop={0}>
              <text>
                <b>MCP</b>
              </text>
              <For each={Object.entries(sync.data.mcp)}>
                {([key, item]) => (
                  <box flexDirection="column">
                    <box flexDirection="row" gap={1}>
                      <text
                        flexShrink={0}
                        style={{
                          fg: {
                            connected: theme.success,
                            failed: theme.error,
                            disabled: theme.textMuted,
                          }[item.status],
                        }}
                      >
                        •
                      </text>
                      <text
                        wrapMode="word"
                        fg={theme.accent}
                        attributes={TextAttributes.BOLD}
                        onMouseUp={() => {
                          if (renderer.getSelection()?.getSelectedText()) return
                          toggleMcpServer(key)
                        }}
                      >
                        {expandedMcpServers().has(key) ? "▼" : "▶"} {key}
                      </text>
                      <text fg={theme.textMuted}>
                        <Switch>
                          <Match when={item.status === "connected"}>Connected</Match>
                          <Match when={item.status === "failed" && item}>
                            {(val) => <i>{val().error}</i>}
                          </Match>
                          <Match when={item.status === "disabled"}>Disabled</Match>
                        </Switch>
                      </text>
                    </box>
                    <Show when={expandedMcpServers().has(key) && mcpTools()[key]}>
                      <box marginLeft={3} flexDirection="column">
                        <For each={Object.entries(mcpTools()[key] || {})}>
                          {([toolName, tool]) => <text fg={theme.textMuted}>⚙ {toolName}</text>}
                        </For>
                      </box>
                    </Show>
                  </box>
                )}
              </For>
            </box>
          </Show>
        </Show>

        <Show when={activeTab() === "todos"}>
          <Show when={todo().length > 0}>
            <box marginTop={0}>
              <text>
                <b>Todo</b>
              </text>
              <For each={todo()}>
                {(todo) => (
                  <text
                    style={{ fg: todo.status === "in_progress" ? theme.success : theme.textMuted }}
                  >
                    [{todo.status === "completed" ? "✓" : " "}] {todo.content}
                  </text>
                )}
              </For>
            </box>
          </Show>
        </Show>

        <Show when={activeTab() === "files"}>
          <Show when={session().summary?.diffs}>
            <box marginTop={0} flexDirection="column">
              <box flexDirection="row" justifyContent="space-between">
                <text>
                  <b>Session Files</b>
                </text>
                <Show when={uncommittedFiles().length > 0}>
                  <text
                    fg={theme.accent}
                    onMouseUp={() => {
                      if (renderer.getSelection()?.getSelectedText()) return
                      const uncommitted = uncommittedFiles()
                      if (selectedFiles().size === uncommitted.length) {
                        setSelectedFiles(new Set<string>())
                      } else {
                        setSelectedFiles(new Set<string>(uncommitted.map((d) => d.file)))
                      }
                    }}
                  >
                    {selectedFiles().size === uncommittedFiles().length ? "Desel All" : "Sel All"}
                  </text>
                </Show>
              </box>
              <For each={session().summary?.diffs || []}>
                {(item) => {
                  const file = createMemo(() => {
                    const splits = item.file.split(path.sep).filter(Boolean)
                    const last = splits.at(-1)!
                    const rest = splits.slice(0, -1).join(path.sep)
                    return Locale.truncateMiddle(rest, 30 - last.length) + "/" + last
                  })
                  const isCommitted = createMemo(() => committedFiles().has(item.file))
                  const isSelected = createMemo(() => selectedFiles().has(item.file))
                  return (
                    <box
                      flexDirection="row"
                      gap={1}
                      justifyContent="space-between"
                      onMouseUp={() => {
                        if (renderer.getSelection()?.getSelectedText()) return
                        if (isCommitted()) return
                        setSelectedFiles((prev) => {
                          const newFiles = new Set(prev)
                          if (prev.has(item.file)) {
                            newFiles.delete(item.file)
                          } else {
                            newFiles.add(item.file)
                          }
                          return newFiles
                        })
                      }}
                    >
                      <text
                        fg={
                          isCommitted()
                            ? theme.success
                            : isSelected()
                              ? theme.accent
                              : theme.textMuted
                        }
                      >
                        {isCommitted() ? "[✓]" : isSelected() ? "[✓]" : "[ ]"} {file()}
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
              <Show when={uncommittedFiles().length > 0}>
                <box marginTop={1}>
                  <text fg={theme.textMuted}>
                    {commitMessage() || "Click Auto or type message"}
                  </text>
                </box>
                <box flexDirection="row" gap={2}>
                  <text
                    fg={
                      selectedFiles().size > 0 && !isCommitting() ? theme.success : theme.textMuted
                    }
                    onMouseUp={() => {
                      if (selectedFiles().size === 0 || isCommitting()) return
                      const count = selectedFiles().size
                      setCommitMessage(`Update ${count} file${count > 1 ? "s" : ""}`)
                    }}
                  >
                    [Auto]
                  </text>
                  <text
                    fg={
                      selectedFiles().size > 0 && commitMessage() && !isCommitting()
                        ? theme.success
                        : theme.textMuted
                    }
                    onMouseUp={() => {
                      if (!isCommitting()) handleCommit()
                    }}
                  >
                    {isCommitting() ? "[Committing...]" : "[Commit]"}
                  </text>
                </box>
                <text fg={theme.textMuted}>{selectedFiles().size} selected</text>
              </Show>
              <Show
                when={
                  uncommittedFiles().length === 0 && (session().summary?.diffs?.length || 0) > 0
                }
              >
                <text fg={theme.success}>All files committed ✓</text>
              </Show>
            </box>
          </Show>
        </Show>
      </box>
    </Show>
  )
}
