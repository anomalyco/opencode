import type { Component } from "solid-js"
import { createSignal, createMemo, For, Show } from "solid-js"
import { useSync } from "../context/sync"

interface SidebarProps {
  sessionID: string
  onNavigateToSession?: (sessionID: string) => void
  class?: string
}

type TabType = "tools" | "todos" | "files"

export const Sidebar: Component<SidebarProps> = (props) => {
  const sync = useSync()
  const [activeTab, setActiveTab] = createSignal<TabType>("tools")
  const [expandedSections, setExpandedSections] = createSignal<Set<string>>(new Set(["toolsUsed"]))
  const [expandedTodos, setExpandedTodos] = createSignal<Set<string>>(new Set())

  const session = createMemo(() => sync.session.get(props.sessionID))
  const todos = createMemo(() => sync.data.todo[props.sessionID] ?? [])
  const diffs = createMemo(() => sync.data.session_diff[props.sessionID] ?? [])
  const messages = createMemo(() => sync.data.message[props.sessionID] ?? [])

  const todoCount = createMemo(() => todos().length)
  const filesCount = createMemo(() => diffs().length)

  // Get child sessions (subagents)
  const childSessions = createMemo(() =>
    sync.data.session.filter((x) => x.parentID === props.sessionID).sort((a, b) => b.time.created - a.time.created),
  )

  // Get MCP/LSP/Plugin counts
  const mcpCount = createMemo(() => 0) // MCP not yet in sync data
  const lspCount = createMemo(() => 0) // LSP not yet in sync data
  const pluginCount = createMemo(() => 0) // Plugin not yet in sync data

  // Get tools used in this session
  const toolsUsed = createMemo(() => {
    const parts = messages().flatMap((m) => sync.data.part[m.id] || [])
    const toolNames = new Set<string>()
    parts.forEach((part) => {
      if (part.type === "tool") {
        toolNames.add(part.tool)
      }
    })
    return Array.from(toolNames).sort()
  })

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(section)) {
        newSet.delete(section)
      } else {
        newSet.add(section)
      }
      return newSet
    })
  }

  const cost = createMemo(() => {
    const total = messages().reduce((sum, x) => sum + (x.role === "assistant" ? x.cost : 0), 0)
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(total)
  })

  const context = createMemo(() => {
    const last = messages().findLast((x) => x.role === "assistant" && "tokens" in x && x.tokens.output > 0)
    if (!last || last.role !== "assistant") return { tokens: 0, tokenLimit: 0, tokensFormatted: "0", percentage: 0 }

    const total =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    const model = sync.data.provider.find((x) => x.id === last.providerID)?.models[last.modelID]
    const tokenLimit = model?.limit.context || 0

    return {
      tokens: total,
      tokenLimit,
      tokensFormatted: total.toLocaleString(),
      percentage: tokenLimit ? Math.round((total / tokenLimit) * 100) : 0,
    }
  })

  const tabs = createMemo(() => [
    {
      id: "tools" as TabType,
      label: `Tools`,
      count: toolsUsed().length,
    },
    {
      id: "todos" as TabType,
      label: `Todos`,
      count: todoCount(),
    },
    {
      id: "files" as TabType,
      label: `Files`,
      count: filesCount(),
    },
  ])

  const statusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "#4ec9b0"
      case "in_progress":
        return "#dcdcaa"
      case "cancelled":
        return "#f48771"
      default:
        return "#858585"
    }
  }

  const statusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return "✓"
      case "in_progress":
        return "⟳"
      case "cancelled":
        return "✗"
      default:
        return "◯"
    }
  }

  return (
    <Show when={session()}>
      <div
        class={props.class}
        style={{
          width: "320px",
          background: "#1a1a1a",
          "border-left": "1px solid #3e3e3e",
          display: "flex",
          "flex-direction": "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "1rem",
            "border-bottom": "1px solid #3e3e3e",
          }}
        >
          {/* CODESURF branding */}
          <div
            style={{
              "text-align": "right",
              color: "#858585",
              "font-weight": "600",
              "letter-spacing": "0.1em",
              "margin-bottom": "0.5rem",
            }}
          >
            CODESURF
          </div>

          {/* Session title */}
          <h3
            style={{
              margin: 0,
              color: "#d4d4d4",
              overflow: "hidden",
              "text-overflow": "ellipsis",
              "white-space": "nowrap",
              "margin-bottom": "1rem",
              "font-weight": "normal",
            }}
            title={session()?.title}
          >
            {session()?.title}
          </h3>

          {/* Context bar with colored segments */}
          <div style={{ "margin-bottom": "0.5rem" }}>
            <div
              style={{
                width: "100%",
                height: "6px",
                background: "#252525",
                "border-radius": "3px",
                overflow: "hidden",
                display: "flex",
              }}
            >
              {/* System (gray) - 10% */}
              <div style={{ width: "10%", height: "100%", background: "#6a6a6a" }} />
              {/* AI (blue) - 50% */}
              <div style={{ width: "50%", height: "100%", background: "#4ec9b0" }} />
              {/* User (purple) - 20% */}
              <div style={{ width: "20%", height: "100%", background: "#c586c0" }} />
              {/* Tool (yellow/orange) - remaining */}
              <div style={{ flex: 1, height: "100%", background: "#dcdcaa" }} />
            </div>
          </div>

          {/* Context stats */}
          <div
            style={{
              display: "flex",
              "justify-content": "space-between",
              color: "#858585",
              "margin-bottom": "0.25rem",
            }}
          >
            <span>{context().tokensFormatted} tokens (99% cached)</span>
            <span>{context().percentage}% used</span>
          </div>

          <div style={{ color: "#858585" }}>
            <span>{cost()} spent</span>
          </div>
        </div>

        {/* Tabs with circles */}
        <div
          style={{
            display: "flex",
            "border-bottom": "1px solid #3e3e3e",
            padding: "0 0.5rem",
          }}
        >
          <For each={tabs()}>
            {(tab) => (
              <button
                onClick={() => setActiveTab(tab.id)}
                style={{
                  flex: 1,
                  padding: "0.75rem 0.25rem",
                  border: "none",
                  background: "transparent",
                  color: activeTab() === tab.id ? "#4ec9b0" : "#858585",
                  cursor: "pointer",
                  "font-family": '"Berkeley Mono", monospace',
                  transition: "color 0.15s",
                  display: "flex",
                  "align-items": "center",
                  "justify-content": "center",
                  gap: "0.25rem",
                }}
                onMouseEnter={(e) => {
                  if (activeTab() !== tab.id) {
                    e.currentTarget.style.color = "#d4d4d4"
                  }
                }}
                onMouseLeave={(e) => {
                  if (activeTab() !== tab.id) {
                    e.currentTarget.style.color = "#858585"
                  }
                }}
              >
                <span>{activeTab() === tab.id ? "●" : "○"}</span>
                <span>
                  {tab.label}({tab.count})
                </span>
              </button>
            )}
          </For>
        </div>

        {/* Tab Content */}
        <div style={{ flex: 1, "overflow-y": "auto", "overflow-x": "hidden" }}>
          {/* Tools Tab */}
          <Show when={activeTab() === "tools"}>
            <div style={{ padding: "1rem" }}>
              {/* Tools Used */}
              <Show when={toolsUsed().length > 0}>
                <div style={{ "margin-bottom": "0.5rem" }}>
                  <button
                    onClick={() => toggleSection("toolsUsed")}
                    style={{
                      width: "100%",
                      padding: "0.5rem 0",
                      border: "none",
                      background: "transparent",
                      color: "#d4d4d4",
                      "text-align": "left",
                      cursor: "pointer",
                      "font-family": '"Berkeley Mono", monospace',

                      display: "flex",
                      "align-items": "center",
                      gap: "0.5rem",
                    }}
                  >
                    <span style={{ "font-size": "0.7rem" }}>{expandedSections().has("toolsUsed") ? "▼" : "▶"}</span>
                    <span>Tools Used ({toolsUsed().length})</span>
                  </button>
                  <Show when={expandedSections().has("toolsUsed")}>
                    <div style={{ "margin-left": "1rem", "margin-top": "0.25rem" }}>
                      <For each={toolsUsed()}>
                        {(tool) => (
                          <div
                            style={{
                              padding: "0.4rem 0.5rem",
                              "margin-bottom": "0.25rem",
                              background: "#252525",
                              border: "1px solid #3e3e3e",
                              "border-radius": "2px",
                              "font-size": "0.75rem",
                              color: "#4ec9b0",
                              "font-family": '"Berkeley Mono", monospace',
                            }}
                          >
                            {tool}
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              </Show>

              {/* MCP Servers */}
              <Show when={mcpCount() > 0}>
                <div style={{ "margin-bottom": "1rem" }}>
                  <button
                    onClick={() => toggleSection("mcp")}
                    style={{
                      width: "100%",
                      padding: "0.5rem 0",
                      border: "none",
                      background: "transparent",
                      color: "#d4d4d4",
                      "text-align": "left",
                      cursor: "pointer",
                      "font-family": "monospace",
                      "font-size": "0.85rem",
                      "font-weight": "bold",
                      display: "flex",
                      "align-items": "center",
                      gap: "0.5rem",
                    }}
                  >
                    <span>{expandedSections().has("mcp") ? "▼" : "▶"}</span>
                    <span>MCP ({mcpCount()})</span>
                  </button>
                  <Show when={expandedSections().has("mcp")}>
                    <div
                      style={{ "margin-left": "1rem", "margin-top": "0.5rem", color: "#858585", "font-size": "0.8rem" }}
                    >
                      {mcpCount()} MCP server(s) connected
                    </div>
                  </Show>
                </div>
              </Show>

              {/* LSP Servers */}
              <Show when={lspCount() > 0}>
                <div style={{ "margin-bottom": "1rem" }}>
                  <button
                    onClick={() => toggleSection("lsp")}
                    style={{
                      width: "100%",
                      padding: "0.5rem 0",
                      border: "none",
                      background: "transparent",
                      color: "#d4d4d4",
                      "text-align": "left",
                      cursor: "pointer",
                      "font-family": "monospace",
                      "font-size": "0.85rem",
                      "font-weight": "bold",
                      display: "flex",
                      "align-items": "center",
                      gap: "0.5rem",
                    }}
                  >
                    <span>{expandedSections().has("lsp") ? "▼" : "▶"}</span>
                    <span>LSP ({lspCount()})</span>
                  </button>
                  <Show when={expandedSections().has("lsp")}>
                    <div
                      style={{ "margin-left": "1rem", "margin-top": "0.5rem", color: "#858585", "font-size": "0.8rem" }}
                    >
                      {lspCount()} LSP server(s) connected
                    </div>
                  </Show>
                </div>
              </Show>

              {/* Plugins */}
              <Show when={pluginCount() > 0}>
                <div style={{ "margin-bottom": "1rem" }}>
                  <button
                    onClick={() => toggleSection("plugins")}
                    style={{
                      width: "100%",
                      padding: "0.5rem 0",
                      border: "none",
                      background: "transparent",
                      color: "#d4d4d4",
                      "text-align": "left",
                      cursor: "pointer",
                      "font-family": "monospace",
                      "font-size": "0.85rem",
                      "font-weight": "bold",
                      display: "flex",
                      "align-items": "center",
                      gap: "0.5rem",
                    }}
                  >
                    <span>{expandedSections().has("plugins") ? "▼" : "▶"}</span>
                    <span>Plugins ({pluginCount()})</span>
                  </button>
                  <Show when={expandedSections().has("plugins")}>
                    <div
                      style={{ "margin-left": "1rem", "margin-top": "0.5rem", color: "#858585", "font-size": "0.8rem" }}
                    >
                      {pluginCount()} plugin(s) loaded
                    </div>
                  </Show>
                </div>
              </Show>

              <Show when={toolsUsed().length === 0 && mcpCount() === 0 && lspCount() === 0 && pluginCount() === 0}>
                <div style={{ "text-align": "center", padding: "2rem", color: "#858585" }}>
                  <div style={{ "font-size": "0.8rem" }}>No tools used yet</div>
                </div>
              </Show>
            </div>
          </Show>

          {/* Todos Tab */}
          <Show when={activeTab() === "todos"}>
            <div style={{ padding: "1rem" }}>
              <Show when={todoCount() > 0}>
                <div style={{ display: "flex", "flex-direction": "column", gap: "0.5rem" }}>
                  <For each={todos()}>
                    {(todo) => (
                      <div
                        style={{
                          padding: "0.75rem",
                          background: "#252525",
                          border: `1px solid ${statusColor(todo.status)}`,
                          "border-radius": "4px",
                        }}
                      >
                        <div style={{ display: "flex", gap: "0.5rem", "align-items": "flex-start" }}>
                          <span style={{ color: statusColor(todo.status), "font-weight": "bold", "font-size": "1rem" }}>
                            {statusIcon(todo.status)}
                          </span>
                          <div style={{ flex: 1 }}>
                            <div style={{ color: "#d4d4d4", "font-size": "0.85rem", "margin-bottom": "0.25rem" }}>
                              {todo.content}
                            </div>
                            <div style={{ color: "#858585", "font-size": "0.75rem" }}>Priority: {todo.priority}</div>
                          </div>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </Show>

              <Show when={todoCount() === 0}>
                <div style={{ "text-align": "center", padding: "2rem", color: "#858585" }}>
                  <div style={{ "font-size": "0.8rem" }}>No todos</div>
                </div>
              </Show>
            </div>
          </Show>

          {/* Files Tab */}
          <Show when={activeTab() === "files"}>
            <div style={{ padding: "1rem" }}>
              <Show when={filesCount() > 0}>
                <div style={{ display: "flex", "flex-direction": "column", gap: "0.5rem" }}>
                  <For each={diffs()}>
                    {(diff) => (
                      <div
                        style={{
                          padding: "0.75rem",
                          background: "#252525",
                          border: "1px solid #3e3e3e",
                          "border-radius": "4px",
                        }}
                      >
                        <div
                          style={{
                            color: "#4ec9b0",
                            "font-size": "0.85rem",
                            "margin-bottom": "0.5rem",
                            "word-break": "break-all",
                            "font-family": "monospace",
                          }}
                        >
                          {diff.file}
                        </div>
                        <div style={{ display: "flex", gap: "1rem", "font-size": "0.75rem" }}>
                          <Show when={diff.additions}>
                            <span style={{ color: "#4ec9b0" }}>+{diff.additions}</span>
                          </Show>
                          <Show when={diff.deletions}>
                            <span style={{ color: "#f48771" }}>-{diff.deletions}</span>
                          </Show>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </Show>

              <Show when={filesCount() === 0}>
                <div style={{ "text-align": "center", padding: "2rem", color: "#858585" }}>
                  <div style={{ "font-size": "0.8rem" }}>No modified files</div>
                </div>
              </Show>
            </div>
          </Show>

          {/* Subagents Section - Always visible below tabs */}
          <div style={{ padding: "1rem", "border-top": "1px solid #3e3e3e" }}>
            <button
              onClick={() => toggleSection("subagents")}
              style={{
                width: "100%",
                padding: "0.5rem 0",
                border: "none",
                background: "transparent",
                color: "#d4d4d4",
                "text-align": "left",
                cursor: "pointer",
                "font-family": '"Berkeley Mono", monospace',
                "font-size": "0.8rem",
                display: "flex",
                "align-items": "center",
                gap: "0.5rem",
              }}
            >
              <span style={{ "font-size": "0.7rem" }}>{expandedSections().has("subagents") ? "▼" : "▶"}</span>
              <span>Subagents ({childSessions().length})</span>
            </button>
            <Show when={expandedSections().has("subagents") && childSessions().length > 0}>
              <div style={{ "margin-top": "0.5rem", display: "flex", "flex-direction": "column", gap: "0.5rem" }}>
                <For each={childSessions()}>
                  {(child) => {
                    const orchestration = (child as any).orchestration
                    const status = orchestration?.status || "unknown"
                    const statusColor =
                      status === "active"
                        ? "#4ec9b0"
                        : status === "completed"
                          ? "#858585"
                          : status === "paused"
                            ? "#dcdcaa"
                            : "#858585"

                    return (
                      <button
                        onClick={() => props.onNavigateToSession?.(child.id)}
                        style={{
                          width: "100%",
                          padding: "0.75rem",
                          background: "#252525",
                          border: `1px solid ${statusColor}`,
                          "border-radius": "4px",
                          cursor: "pointer",
                          "text-align": "left",
                          "font-family": "monospace",
                          transition: "all 0.15s",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = "#2e2e2e"
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "#252525"
                        }}
                      >
                        <div style={{ display: "flex", "align-items": "center", gap: "0.5rem" }}>
                          <span style={{ color: statusColor, "font-size": "1rem" }}>●</span>
                          <div style={{ flex: 1 }}>
                            <div
                              style={{
                                color: "#d4d4d4",
                                "font-size": "0.85rem",
                                "margin-bottom": "0.25rem",
                                overflow: "hidden",
                                "text-overflow": "ellipsis",
                                "white-space": "nowrap",
                              }}
                              title={child.title}
                            >
                              {child.title.length > 35 ? child.title.substring(0, 32) + "..." : child.title}
                            </div>
                            <div style={{ color: "#858585", "font-size": "0.75rem" }}>
                              {status} {orchestration?.depth ? `· depth ${orchestration.depth}` : ""}
                            </div>
                          </div>
                        </div>
                      </button>
                    )
                  }}
                </For>
              </div>
            </Show>
          </div>

          {/* Plugins Section - Always visible below subagents */}
          <Show when={pluginCount() > 0}>
            <div style={{ padding: "1rem", "border-top": "1px solid #3e3e3e" }}>
              <button
                onClick={() => toggleSection("pluginsSection")}
                style={{
                  width: "100%",
                  padding: "0.5rem 0",
                  border: "none",
                  background: "transparent",
                  color: "#d4d4d4",
                  "text-align": "left",
                  cursor: "pointer",
                  "font-family": '"Berkeley Mono", monospace',
                  "font-size": "0.8rem",
                  display: "flex",
                  "align-items": "center",
                  gap: "0.5rem",
                }}
              >
                <span style={{ "font-size": "0.7rem" }}>{expandedSections().has("pluginsSection") ? "▼" : "▶"}</span>
                <span>Plugins ({pluginCount()})</span>
              </button>
              <Show when={expandedSections().has("pluginsSection")}>
                <div style={{ "margin-top": "0.5rem", color: "#858585", "font-size": "0.75rem" }}>
                  {pluginCount()} plugin(s) loaded
                </div>
              </Show>
            </div>
          </Show>
        </div>
      </div>
    </Show>
  )
}
